import type { TeamState } from "@case404/shared";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ApiError, api } from "../api";
import { useChime } from "./settings";
import { useToasts } from "./toasts";

const POLL_VISIBLE_MS = 4000;
const POLL_HIDDEN_MS = 15000;
const CODE_KEY = "c404.joinCode";

type Ctx = {
  state: TeamState | null;
  loading: boolean;
  error: ApiError | null;
  /** serverNow − clientNow, in ms. Used only to animate the countdown; the server decides deadlines. */
  offsetMs: number;
  refresh: () => Promise<TeamState | null>;
  apply: (state: TeamState) => void;
  clear: () => void;
  joinCode: string | null;
  rememberCode: (code: string) => void;
};

const TeamContext = createContext<Ctx | null>(null);

export function TeamProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<TeamState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [offsetMs, setOffsetMs] = useState(0);
  const [joinCode, setJoinCode] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(CODE_KEY) ?? localStorage.getItem(CODE_KEY);
    } catch {
      return null;
    }
  });
  const { push } = useToasts();
  const chime = useChime();
  const lastActivity = useRef<number | null>(null);
  const lastAnnouncement = useRef<number | null>(null);

  const apply = useCallback(
    (next: TeamState) => {
      setOffsetMs(Date.parse(next.clock.serverNow) - Date.now());
      // Surface teammates' actions and organizer announcements that arrived since the last poll.
      if (lastActivity.current !== null) {
        const fresh = next.activity.filter((a) => a.id > lastActivity.current! && a.nickname !== next.me.nickname).reverse();
        for (const a of fresh) {
          const kind = a.kind === "solved" ? "success" : "info";
          push({ kind, text: a.text });
          if (a.kind === "solved") chime("solve");
        }
      }
      lastActivity.current = next.activity[0]?.id ?? 0;
      if (lastAnnouncement.current !== null) {
        for (const a of next.announcements.filter((x) => x.id > lastAnnouncement.current!).reverse()) {
          push({ kind: "announce", title: "Organizer announcement", text: a.body });
        }
      }
      lastAnnouncement.current = next.announcements[0]?.id ?? 0;
      setState(next);
      setError(null);
    },
    [push, chime],
  );

  const authed = useRef(false);
  // Bumped whenever this browser gains or drops a session. A poll that started in an earlier
  // epoch (e.g. a cookie-less request still in flight while the player joins) is ignored,
  // so its late 401 can't wipe the session that was just created.
  const epoch = useRef(0);
  const [pollKey, setPollKey] = useState(0);
  const mounted = useRef(false);
  const initialFetchStarted = useRef(false);
  const inFlight = useRef<Promise<TeamState | null> | null>(null);

  const applyAndPoll = useCallback(
    (next: TeamState) => {
      if (!authed.current) {
        authed.current = true;
        epoch.current++;
        setPollKey((k) => k + 1);
      }
      apply(next);
      setLoading(false);
    },
    [apply],
  );

  // Settings may change the chime callback, but must never restart the polling lifecycle.
  const applyRef = useRef(applyAndPoll);
  useEffect(() => {
    applyRef.current = applyAndPoll;
  }, [applyAndPoll]);

  const refresh = useCallback((): Promise<TeamState | null> => {
    // Manual refreshes, visibility changes and StrictMode replay share one request.
    if (inFlight.current) return inFlight.current;
    if (!mounted.current) return Promise.resolve(null);
    const startedIn = epoch.current;
    const request = (async () => {
      try {
        const next = await api.teamState();
        if (!mounted.current || startedIn !== epoch.current) return null;
        applyRef.current(next);
        return next;
      } catch (err) {
        if (!mounted.current || startedIn !== epoch.current) return null;
        const e = err as ApiError;
        if (e.status === 401) {
          authed.current = false;
          epoch.current++;
          setPollKey((k) => k + 1);
          setState(null);
          lastActivity.current = null;
          lastAnnouncement.current = null;
        }
        setError(e);
        return null;
      }
    })();
    inFlight.current = request;
    void request.finally(() => {
      if (inFlight.current === request) inFlight.current = null;
      if (mounted.current) setLoading(false);
    });
    return request;
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // One initial session check per mount, then a single completion-based timer.
  // Auth transitions reschedule the timer; they do not trigger another immediate GET.
  useEffect(() => {
    let timer: number | undefined;
    let cancelled = false;
    const schedule = () => {
      window.clearTimeout(timer);
      if (cancelled || !authed.current) return;
      timer = window.setTimeout(tick, document.visibilityState === "visible" ? POLL_VISIBLE_MS : POLL_HIDDEN_MS);
    };
    const tick = async () => {
      if (cancelled || !authed.current) return;
      await refresh();
      schedule();
    };
    if (!initialFetchStarted.current) {
      initialFetchStarted.current = true;
      void refresh().then(schedule);
    } else {
      schedule();
    }
    document.addEventListener("visibilitychange", schedule);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", schedule);
    };
  }, [refresh, pollKey]);

  const rememberCode = useCallback((code: string) => {
    setJoinCode(code);
    try {
      sessionStorage.setItem(CODE_KEY, code);
      localStorage.setItem(CODE_KEY, code);
    } catch {
      /* code still shown for this visit */
    }
  }, []);

  const clear = useCallback(() => {
    authed.current = false;
    epoch.current++;
    setPollKey((k) => k + 1);
    setLoading(false);
    setState(null);
    lastActivity.current = null;
    lastAnnouncement.current = null;
    try {
      sessionStorage.removeItem(CODE_KEY);
      localStorage.removeItem(CODE_KEY);
    } catch {
      /* ignore */
    }
    setJoinCode(null);
  }, []);

  const value = useMemo(
    () => ({ state, loading, error, offsetMs, refresh, apply: applyAndPoll, clear, joinCode, rememberCode }),
    [state, loading, error, offsetMs, refresh, applyAndPoll, clear, joinCode, rememberCode],
  );
  return <TeamContext.Provider value={value}>{children}</TeamContext.Provider>;
}

export function useTeam() {
  const ctx = useContext(TeamContext);
  if (!ctx) throw new Error("useTeam outside TeamProvider");
  return ctx;
}
