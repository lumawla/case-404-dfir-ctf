#!/usr/bin/env node
// Regenerates CASE 404 artwork, the image and PDF evidence, the practice photo and the intake manifests.
//
//   npm run assets
//
// Photographs (portraits, stage, booth, CCTV, practice cat) come from `python3 scripts/build-photos.py`,
// which writes the portraits and scripts/art/rendered/*.jpg; this script adds their EXIF.
// Output is committed so evidence bytes stay frozen for the event.
// Text and record evidence comes from hand-written files and `npm run evidence`, not from here.
// After regenerating, run `npm test`: content tests check EXIF values and other invariants.

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { crc32 } from "node:zlib";
import { chromium } from "playwright-core";
import { coverHall, resultSolved, resultUnsolved } from "./art/ui-art.mjs";
import { invoiceHtml, leakedChat } from "./art/scenes.mjs";
import { ascii, buildExifApp1, insertApp1, long, rational, short } from "./lib/exif-writer.mjs";
import { writeIntakeManifests } from "./lib/intake-manifest.mjs";
import { venueMapSvg } from "./lib/venue-map.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const caseDir = path.join(root, "content/evidence/fs/case404");
const evidence = (p) => path.join(caseDir, p);
const trainingDir = path.join(root, "content/training/fs/training");
const webPublic = path.join(root, "apps/web/public");
const rendered = (name) => readFile(path.join(root, "scripts/art/rendered", name));
const executablePath = process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium";

await mkdir(path.join(webPublic, "portraits"), { recursive: true });
await mkdir(path.join(webPublic, "art"), { recursive: true });

const venue = JSON.parse(await readFile(path.join(root, "content/public/venue.json"), "utf8"));
await writeFile(evidence("venue/floorplan.svg"), venueMapSvg(venue));

const browser = await chromium.launch({ executablePath });

async function render(svgMarkup, width, height, type = "jpeg", quality = 84) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><html><body style="margin:0;background:#000">${svgMarkup}</body></html>`);
  const buf = await page.screenshot({ type, ...(type === "jpeg" ? { quality } : {}), clip: { x: 0, y: 0, width, height } });
  await page.close();
  return buf;
}

/** Adds tEXt chunks after IHDR, the way screenshot and markup tools label PNGs. */
function withPngText(png, entries) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdrEnd = 8 + 4 + 4 + 13 + 4;
  const text = entries.map(([k, v]) => chunk("tEXt", Buffer.from(`${k}\0${v}`, "latin1")));
  return Buffer.concat([png.subarray(0, ihdrEnd), ...text, png.subarray(ihdrEnd)]);
}

// UI art (public, non-evidence). Portraits come from build-photos.py; Lucien has none: camera shy.
await rm(path.join(webPublic, "portraits", "lucien.jpg"), { force: true });
await writeFile(path.join(webPublic, "art/cover-hall.jpg"), await render(coverHall(), 1600, 900, "jpeg", 80));
await writeFile(path.join(webPublic, "art/result-solved.svg"), resultSolved());
await writeFile(path.join(webPublic, "art/result-unsolved.svg"), resultUnsolved());

// EV07 — stage photo with Canon EXIF: captured 23:28 (+02:00, Asia/Beirut on Oct 31 2026).
// The feed serves a resized rendition without metadata, as social platforms do.
{
  const jpeg = await rendered("stage.jpg");
  const page = await browser.newPage({ viewport: { width: 1080, height: 720 }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><html><body style="margin:0;background:#000"><img src="data:image/jpeg;base64,${jpeg.toString("base64")}" style="display:block;width:1080px;height:720px"></body></html>`);
  await writeFile(evidence("social/cdn/msp-oct31-0442_1080.jpg"), await page.screenshot({ type: "jpeg", quality: 78, clip: { x: 0, y: 0, width: 1080, height: 720 } }));
  await page.close();
  const app1 = buildExifApp1(
    [
      ascii(0x010f, "Canon"),
      ascii(0x0110, "Canon EOS R50"),
      ascii(0x0131, "Firmware Version 1.3.0"),
      ascii(0x0132, "2026:10:31 23:28:00"),
      ascii(0x013b, "Blackthorn Events photo desk"),
    ],
    [
      rational(0x829a, 1, 125),
      rational(0x829d, 28, 10),
      short(0x8827, 3200),
      ascii(0x9003, "2026:10:31 23:28:00"),
      ascii(0x9004, "2026:10:31 23:28:00"),
      ascii(0x9010, "+02:00"),
      ascii(0x9011, "+02:00"),
      ascii(0x9012, "+02:00"),
      rational(0x920a, 50, 1),
      long(0xa002, 1600),
      long(0xa003, 1067),
      ascii(0xa431, "R50-77310"),
      ascii(0xa434, "RF50mm F1.8 STM"),
    ],
  );
  await writeFile(evidence("social/originals/IMG_4471.jpg"), insertApp1(jpeg, app1));
}

// EV04 — the cropped screenshot posted to the staff channel. Taken on Nadia's phone at 23:54:12, then marked up.
await writeFile(
  evidence("staff_channel/attachments/fwd_0003.png"),
  withPngText(await render(leakedChat(), 760, 520, "png"), [
    ["Software", "iOS 19.1 Markup"],
    ["Creation Time", "2026:10:31 23:54:12"],
    ["Description", "Screenshot"],
  ]),
);

// EV03 — booth frame from session S27: two people on the seat, one in the picture. Auto exposure 23:52.
// Salma's print (photographed at her interview) is the same picture without the booth's metadata.
{
  const jpeg = await rendered("booth.jpg");
  await writeFile(evidence("interviews/exhibits/salma_booth_print.jpg"), jpeg);
  const app1 = buildExifApp1(
    [
      ascii(0x010e, "Auto exposure, frame 1 of 1"),
      ascii(0x010f, "MASKED"),
      ascii(0x0110, "PhotoBooth PB-2"),
      ascii(0x0131, "PB-2 booth firmware 4.1"),
      ascii(0x0132, "2026:10:31 23:52:00"),
    ],
    [
      ascii(0x9003, "2026:10:31 23:52:00"),
      ascii(0x9004, "2026:10:31 23:52:00"),
      ascii(0x9011, "+02:00"),
      long(0xa002, 1200),
      long(0xa003, 1600),
    ],
  );
  await writeFile(evidence("photobooth/DCIM/PB2_0027.jpg"), insertApp1(jpeg, app1));
}

// Corridor still from the local recorder, 23:48:07.
{
  const jpeg = await rendered("cctv.jpg");
  const app1 = buildExifApp1(
    [
      ascii(0x010e, "Still exported from local recorder NVR-8"),
      ascii(0x010f, "MASKED"),
      ascii(0x0110, "NVR-8 CAM-03"),
      ascii(0x0132, "2026:10:31 23:48:07"),
    ],
    [ascii(0x9003, "2026:10:31 23:48:07"), ascii(0x9011, "+02:00"), long(0xa002, 1280), long(0xa003, 720)],
  );
  await writeFile(evidence("cctv/nvr8/CAM-03_20261031_234807.jpg"), insertApp1(jpeg, app1));
}

// Vendor invoice PDF from the same transcript shown in-app.
{
  const transcript = await readFile(path.join(root, "content/evidence/sources/BC-104.txt"), "utf8");
  const page = await browser.newPage();
  await page.setContent(invoiceHtml(transcript));
  const pdf = await page.pdf({ format: "A4", printBackground: true });
  await page.close();
  await writeFile(evidence("finance/invoices/BC-104.pdf"), pdf);
}

// Practice folder: a photo whose time is only in its metadata.
{
  const jpeg = await rendered("cat.jpg");
  const app1 = buildExifApp1(
    [ascii(0x010f, "Google"), ascii(0x0110, "Pixel 8"), ascii(0x0132, "2026:10:01 09:15:00")],
    [ascii(0x9003, "2026:10:01 09:15:00"), ascii(0x9004, "2026:10:01 09:15:00"), ascii(0x9011, "+02:00"), long(0xa002, 800), long(0xa003, 600)],
  );
  await writeFile(path.join(trainingDir, "cat.jpg"), insertApp1(jpeg, app1));
}

await browser.close();
writeIntakeManifests(caseDir);
console.log("Assets generated and the intake manifests re-hashed.");
