import { Download, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** Full-screen image viewer. Click the image to toggle 1:1 zoom; Escape closes. */
export function Lightbox({ image, onClose }: { image: { src: string; name: string } | null; onClose: () => void }) {
  const [zoomed, setZoomed] = useState(false);
  const close = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!image) return;
    setZoomed(false);
    const opener = document.activeElement as HTMLElement | null;
    close.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, [image, onClose]);

  if (!image) return null;
  return createPortal(
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={image.name}>
      <div className="lightbox-bar">
        <span>{image.name}</span>
        <span className="row" style={{ gap: 4 }}>
          <a className="icon-btn" href={image.src} download={image.name} aria-label={`Download ${image.name}`}>
            <Download />
          </a>
          <button ref={close} type="button" className="icon-btn" onClick={onClose} aria-label="Close image">
            <X />
          </button>
        </span>
      </div>
      <div className="lightbox-stage" onClick={(e) => e.target === e.currentTarget && onClose()}>
        <img src={image.src} alt={image.name} className={zoomed ? "zoomed" : undefined} style={{ cursor: zoomed ? "zoom-out" : "zoom-in" }} onClick={() => setZoomed((z) => !z)} />
      </div>
    </div>,
    document.body,
  );
}
