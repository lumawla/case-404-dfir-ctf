import { CheckCircle2, Info, Megaphone, X } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

type Toast = { id: number; kind: "info" | "success" | "announce"; text: string; title?: string };
type Ctx = { push: (t: Omit<Toast, "id">) => void; announce: (text: string) => void };

const ToastContext = createContext<Ctx>({ push: () => {}, announce: () => {} });

/**
 * Visual toasts plus one polite live region. Toasts never move focus; announcements are
 * complete phrases so screen-reader users hear the change in context.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [liveText, setLiveText] = useState("");
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setToasts((all) => all.filter((t) => t.id !== id)), []);

  const announce = useCallback((text: string) => {
    setLiveText("");
    window.setTimeout(() => setLiveText(text), 50);
  }, []);

  const push = useCallback(
    (t: Omit<Toast, "id">) => {
      const id = nextId.current++;
      setToasts((all) => [...all.slice(-3), { ...t, id }]);
      announce(t.title ? `${t.title}. ${t.text}` : t.text);
      window.setTimeout(() => dismiss(id), t.kind === "announce" ? 12000 : 6000);
    },
    [announce, dismiss],
  );

  const value = useMemo(() => ({ push, announce }), [push, announce]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {liveText}
      </div>
      <div className="toasts" aria-hidden="true">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.kind === "success" ? <CheckCircle2 /> : t.kind === "announce" ? <Megaphone /> : <Info />}
            <div style={{ flex: 1 }}>
              {t.title && <p><strong>{t.title}</strong></p>}
              <p>{t.text}</p>
            </div>
            <button className="icon-btn" style={{ width: 32, height: 32 }} onClick={() => dismiss(t.id)} tabIndex={-1}>
              <X />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToasts = () => useContext(ToastContext);
