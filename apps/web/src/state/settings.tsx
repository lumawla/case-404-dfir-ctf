import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type Settings = {
  textScale: "base" | "lg" | "xl";
  motion: "system" | "reduce" | "full";
  contrast: "normal" | "high";
  sound: boolean;
};

const DEFAULTS: Settings = { textScale: "base", motion: "system", contrast: "normal", sound: false };
const KEY = "c404.settings";

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

type Ctx = { settings: Settings; update: (patch: Partial<Settings>) => void };
const SettingsContext = createContext<Ctx>({ settings: DEFAULTS, update: () => {} });

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(load);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.textScale = settings.textScale;
    root.dataset.contrast = settings.contrast;
    if (settings.motion === "system") delete root.dataset.motion;
    else root.dataset.motion = settings.motion;
    try {
      localStorage.setItem(KEY, JSON.stringify(settings));
    } catch {
      /* storage unavailable: settings last for this visit only */
    }
  }, [settings]);

  const value = useMemo(() => ({ settings, update: (patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch })) }), [settings]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export const useSettings = () => useContext(SettingsContext);

/** Quiet, optional UI chimes. Off by default; never carries game information. */
export function useChime() {
  const { settings } = useSettings();
  return useCallback((kind: "solve" | "warn") => {
    if (!settings.sound) return;
    try {
      const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      const notes = kind === "solve" ? [523.25, 659.25, 783.99] : [330, 330];
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        const t = ctx.currentTime + i * 0.12;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.06, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.3);
      });
      setTimeout(() => ctx.close(), 1000);
    } catch {
      /* audio unavailable */
    }
  }, [settings.sound]);
}
