import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  variant?: "drawer" | "dialog";
  footer?: ReactNode;
};

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Modal dialog / side drawer: traps focus, closes on Escape, and returns focus to the opener. */
export function Dialog({ open, onClose, title, children, variant = "dialog", footer }: Props) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const node = panel.current;
    const first = node?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? node)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
      if (e.key === "Tab" && node) {
        const items = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
        if (!items.length) return;
        const firstEl = items[0];
        const lastEl = items[items.length - 1];
        if (e.shiftKey && document.activeElement === firstEl) {
          e.preventDefault();
          lastEl.focus();
        } else if (!e.shiftKey && document.activeElement === lastEl) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      opener?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div className={`overlay ${variant === "dialog" ? "center" : ""}`} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={panel} className={variant} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        {variant === "drawer" ? (
          <>
            <div className="drawer-head">
              <h2 id={titleId}>{title}</h2>
              <button className="icon-btn" onClick={onClose} aria-label={`Close ${title}`}>
                <X />
              </button>
            </div>
            <div className="drawer-body">{children}</div>
            {footer && <div className="drawer-head" style={{ borderTop: "1px solid var(--border)", borderBottom: 0 }}>{footer}</div>}
          </>
        ) : (
          <>
            <div className="spread" style={{ marginBottom: "var(--space-4)" }}>
              <h2 id={titleId} style={{ margin: 0, fontSize: "var(--text-xl)" }}>
                {title}
              </h2>
              <button className="icon-btn" onClick={onClose} aria-label={`Close ${title}`}>
                <X />
              </button>
            </div>
            {children}
            {footer && <div className="row" style={{ justifyContent: "flex-end", marginTop: "var(--space-5)" }}>{footer}</div>}
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
