#!/usr/bin/env python3
"""Builds the CASE 404 photographs from the source photos in scripts/art/photos/.

    python3 scripts/build-photos.py        (Python 3 with Pillow and numpy)

- Character portraits: cropped to 3:4, graded to one shared "flash camera at a party" look,
  written to apps/web/public/portraits/ with no metadata.
- Evidence scenes (stage photo, booth frame, corridor CCTV still): made from the *-src.jpg photos,
  graded to the same tone, with the recorder overlay on the CCTV still. The practice cat is a sample
  photo. All are written to scripts/art/rendered/. The asset
  generator (npm run assets) then adds the story's EXIF to them. Camera metadata from the source
  photos is never carried over (it can hold real dates and GPS).

Output is deterministic (fixed seeds) and committed.
"""
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "scripts/art/photos")
OUT = os.path.join(ROOT, "scripts/art/rendered")
PORTRAITS = os.path.join(ROOT, "apps/web/public/portraits")
MONO = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf"

# Source photo and crop (left, top, right, bottom) per character. Crops are 3:4 and keep the costume.
# The sources are AI-generated pictures of fictional people.
CAST = {
    "nadia": ("nadia.jpg", (0, 0, 1200, 1600)),
    "yasmine": ("yasmine.jpg", (0, 0, 1200, 1600)),
    "karim": ("karim.jpg", (0, 0, 1200, 1600)),
    "tara": ("tara.jpg", (0, 0, 1200, 1600)),
    "salma": ("salma.jpg", (0, 0, 1200, 1600)),
}


def arr(im):
    return np.asarray(im.convert("RGB"), dtype=np.float32) / 255.0


def img(a):
    return Image.fromarray((np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8))


def luma(a):
    return a[..., 0] * 0.299 + a[..., 1] * 0.587 + a[..., 2] * 0.114


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def vignette(h, w, strength=0.55, power=2.2):
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    d = np.sqrt(((x - w / 2) / (w / 2)) ** 2 + ((y - h / 2) / (h / 2)) ** 2) / np.sqrt(2)
    return 1 - strength * d ** power


def grain(a, amount, seed):
    rng = np.random.default_rng(seed)
    n = rng.normal(0, 1, a.shape[:2]).astype(np.float32)
    n = np.asarray(img(np.repeat((n[..., None] * 0.18 + 0.5), 3, axis=2)).filter(ImageFilter.GaussianBlur(0.6)), dtype=np.float32)[..., 0] / 255.0 - 0.5
    return a + n[..., None] * amount * 2


def party_grade(a, seed, target=0.34):
    """One shared look: neutral white balance, matched exposure, deep oxblood shadows, warm highlights, flash falloff, grain."""
    # partial grey-world white balance, so warm bulbs and office fluorescents end up alike
    mean = a.reshape(-1, 3).mean(axis=0)
    a = a * (1 + 0.65 * (mean.mean() / np.maximum(mean, 1e-3) - 1))
    # match brightness on the subject (centre of the frame), not the background
    h, w = a.shape[:2]
    med = np.median(luma(a[h // 6: h * 2 // 3, w // 4: w * 3 // 4]))
    a = np.clip(a, 0, 1) ** (np.log(target) / np.log(max(min(med, 0.95), 0.02)))
    # low-key party look: darker surroundings, a little more contrast
    a = a * (0.55 + 0.45 * vignette(h, w, 1.0, 1.6))[..., None]
    a = a ** 1.12
    # gentle S-curve and lifted blacks
    a = a + 0.32 * (a - 0.5) * (1 - np.abs(2 * a - 1))
    a = 0.012 + a * 0.98
    # split tone: oxblood in the shadows, warm skin in the highlights; slightly muted colour
    y = luma(a)[..., None]
    a = y + (a - y) * 0.8
    sh = (1 - smoothstep(0.0, 0.45, y))
    hi = smoothstep(0.55, 1.0, y)
    a = a + sh * np.array([0.065, -0.014, -0.006]) + hi * np.array([0.03, 0.012, -0.02])
    h, w = a.shape[:2]
    a = a * vignette(h, w, 0.62)[..., None]
    return np.clip(grain(a, 0.035, seed), 0, 1)


def save(a_or_im, path, q=88):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    im = a_or_im if isinstance(a_or_im, Image.Image) else img(a_or_im)
    im.save(path, "JPEG", quality=q, optimize=True)  # no exif= argument: no metadata is written


def portraits():
    for i, (cid, (name, box)) in enumerate(CAST.items()):
        im = Image.open(os.path.join(SRC, name)).convert("RGB").crop(box).resize((900, 1200), Image.LANCZOS)
        a = party_grade(arr(im), seed=10 + i)
        save(a, os.path.join(PORTRAITS, f"{cid}.jpg"))


def scene_grade(a, seed, mute=0.86, shadow=1.0, vig=0.3, grain_amount=0.025):
    """The portraits' tone without their exposure and white-balance matching (that would flatten stage lights):
    S-curve, muted colour, oxblood shadows, warm highlights, vignette and grain."""
    a = a + 0.14 * (a - 0.5) * (1 - np.abs(2 * a - 1))
    y = luma(a)[..., None]
    a = y + (a - y) * mute
    sh = 1 - smoothstep(0.0, 0.45, y)
    hi = smoothstep(0.55, 1.0, y)
    a = a + shadow * sh * np.array([0.045, -0.012, -0.004]) + hi * np.array([0.025, 0.01, -0.018])
    a = 0.02 + a * 0.97
    h, w = a.shape[:2]
    return np.clip(grain(a * vignette(h, w, vig)[..., None], grain_amount, seed), 0, 1)


def stage_photo():
    """IMG_4471: Yasmine onstage at the run-through, shot from the floor. 1600x1067."""
    im = Image.open(os.path.join(SRC, "stage-src.jpg")).convert("RGB").resize((1600, 1067), Image.LANCZOS)
    a = arr(im) ** 1.25 * 0.92  # darker, to sit with the portraits' low-key look
    return scene_grade(a, 4472, mute=0.82, vig=0.45)


def booth_photo():
    """PB2_0027: the booth's own camera, flash on. Salma alone, with an empty seat beside her. 1200x1600."""
    im = Image.open(os.path.join(SRC, "booth-src.jpg")).convert("RGB").resize((1200, 1600), Image.LANCZOS)
    return scene_grade(arr(im), 27, mute=0.9, vig=0.4, grain_amount=0.03)


def cctv_still():
    """CAM-03 at 23:48:07: the angel walking to the projection room door. 1280x720, recorder overlay added here."""
    import io
    W, H = 1280, 720
    im = Image.open(os.path.join(SRC, "cctv-src.jpg")).convert("RGB").resize((W, H), Image.LANCZOS)
    a = arr(im)
    y = luma(a)[..., None]
    a = y + (a - y) * 0.55  # recorders wash colour out
    a = np.clip(a * 0.9, 0, 1) ** 1.12  # a little darker: an old corridor camera at night
    a = scene_grade(a, 3, mute=1.0, shadow=0.5, vig=0.2, grain_amount=0.045)
    small = img(a).resize((960, 540), Image.BILINEAR).resize((W, H), Image.BILINEAR)
    buf = io.BytesIO()
    small.save(buf, "JPEG", quality=45)
    out = Image.open(io.BytesIO(buf.getvalue())).convert("RGB")
    d = ImageDraw.Draw(out)
    f = ImageFont.truetype(MONO, 24)
    small_f = ImageFont.truetype(MONO, 18)

    def label(xy, txt, font, fill=(235, 235, 235)):
        for ox, oy in ((-2, 0), (2, 0), (0, -2), (0, 2)):
            d.text((xy[0] + ox, xy[1] + oy), txt, font=font, fill=(0, 0, 0))
        d.text(xy, txt, font=font, fill=fill)

    label((24, 20), "CAM-03  2F CORRIDOR E", f)
    label((24, 52), "PROJ-EAST WING", small_f, (200, 200, 200))
    d.ellipse([W - 122, 26, W - 104, 44], fill=(235, 60, 60), outline=(0, 0, 0), width=2)
    label((W - 92, 20), "REC", f, (235, 60, 60))
    label((24, H - 46), "NVR-8  CH03  15 FPS", small_f, (200, 200, 200))
    label((W - 330, H - 46), "2026-10-31 23:48:07", f)
    return out


def cat_photo():
    """Practice folder: an ordinary phone photo of a cat. 800x600."""
    from skimage import data  # the "chelsea" sample photo bundled with scikit-image (public domain)
    im = Image.fromarray(data.chelsea()).resize((800, 532), Image.LANCZOS)
    canvas = Image.new("RGB", (800, 600))
    canvas.paste(im.resize((902, 600), Image.LANCZOS).crop((51, 0, 851, 600)))
    a = arr(canvas)
    return np.clip(grain(a * vignette(600, 800, 0.25)[..., None], 0.02, 9), 0, 1)


if __name__ == "__main__":
    portraits()
    save(stage_photo(), os.path.join(OUT, "stage.jpg"), 92)
    save(booth_photo(), os.path.join(OUT, "booth.jpg"), 90)
    save(cctv_still(), os.path.join(OUT, "cctv.jpg"), 85)
    save(cat_photo(), os.path.join(OUT, "cat.jpg"), 88)
    print("Photos built: portraits in apps/web/public/portraits, scenes in scripts/art/rendered")
