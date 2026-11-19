import { Droplet } from "lucide-react";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { ROMAN } from "./ui";

export type OwnedInfo = { title: string; points: number; firstBlood: boolean; actOpened: 1 | 2 | 3 | null };

/** The "you owned it" moment after a correct flag. Click, Escape or a few seconds dismiss it. */
export function OwnedOverlay({ owned, onDone }: { owned: OwnedInfo | null; onDone: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!owned) return;
    const opener = document.activeElement as HTMLElement | null;
    box.current?.focus();
    const t = window.setTimeout(onDone, 3200);
    const onKey = (e: KeyboardEvent) => (e.key === "Escape" || e.key === "Enter") && onDone();
    document.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("keydown", onKey);
      opener?.focus?.({ preventScroll: true });
    };
  }, [owned, onDone]);
  if (!owned) return null;
  return createPortal(
    <div ref={box} className="owned-overlay" onClick={onDone} role="alertdialog" aria-modal="true" aria-label={`Owned: ${owned.title}`} tabIndex={-1}>
      <div className="owned-card">
        <span className="word">Owned</span>
        <span className="what">{owned.title}</span>
        <span className="pts">+{owned.points} pts</span>
        {owned.firstBlood && (
          <span className="badge badge-accent">
            <Droplet aria-hidden="true" /> First blood
          </span>
        )}
        {owned.actOpened && <span className="act-unlocked">Act {ROMAN[owned.actOpened]} unlocked</span>}
      </div>
    </div>,
    document.body,
  );
}
