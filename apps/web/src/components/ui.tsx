import { AlertTriangle, CameraOff } from "lucide-react";
import type { ReactNode } from "react";

export function PageHead({ eyebrow, title, children }: { eyebrow?: string; title: string; children?: ReactNode }) {
  return (
    <header>
      {eyebrow && <p className="eyebrow">{eyebrow}</p>}
      <h1 style={{ marginBottom: children ? 8 : 0 }}>{title}</h1>
      {children && <div className="muted">{children}</div>}
    </header>
  );
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="stack-sm">
      <span className="visually-hidden">{label}…</span>
      <div className="skeleton" />
      <div className="skeleton" style={{ minHeight: 160 }} />
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <div className="alert" role="alert">
      <AlertTriangle aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
}

export function formatDuration(seconds: number | null) {
  if (seconds === null) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

export function clockTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** Act numbers as the board and dialogs show them. */
export const ROMAN = { 1: "I", 2: "II", 3: "III" } as const;

/** A portrait, or an empty frame when there is no photo on file. */
export function Portrait({ src, alt, note, lazy = false }: { src: string | null; alt?: string; note?: string; lazy?: boolean }) {
  if (src) return <img src={src} alt={alt ?? ""} width={600} height={800} loading={lazy ? "lazy" : undefined} />;
  return (
    <span className="portrait-empty" role={alt === "" ? undefined : "img"} aria-label={alt === "" ? undefined : (note ?? "No photo on file")}>
      <CameraOff aria-hidden="true" />
      <span aria-hidden="true">{note ?? "No photo on file"}</span>
    </span>
  );
}
