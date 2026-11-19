import type { ChallengeView, FileListing } from "@case404/shared";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ApiError, api, fileUrl } from "../api";
import type { TermSession } from "../terminal/Terminal";
import { useTermSession } from "../terminal/session";
import type { Out } from "../terminal/shell";
import { useTeam } from "./team";

type Ctx = {
  challenges: ChallengeView[] | null;
  reloadChallenges: () => Promise<void>;
  listing: FileListing | null;
  terminal: TermSession;
  lightbox: { src: string; name: string } | null;
  showImage: (img: { src: string; name: string } | null) => void;
  /** True while a full-screen moment (the Owned overlay) is showing, so other dialogs wait. */
  overlayBusy: boolean;
  setOverlayBusy: (busy: boolean) => void;
  error: string | null;
};

const CaseDataContext = createContext<Ctx | null>(null);

const MOTD: Out[] = [
  {
    kind: "rich",
    lines: [
      [{ t: "Digital Evidence Response", c: "bold" }, { t: " · forensic workstation der-forensics", c: "muted" }],
      [{ t: "Case 404 evidence is mounted read-only at " }, { t: "~/case404", c: "dir" }, { t: ". Scratch space: /tmp." }],
      [{ t: "Type " }, { t: "help", c: "bold" }, { t: " to list the tools, or open the Cheat sheet tab." }],
      [],
    ],
  },
];

const CASE_URLS = { raw: fileUrl, text: (path: string) => `/api/case/fs/text?path=${encodeURIComponent(path)}` };

/** "[DER] New evidence mounted" with the folders that received files. */
function mountNotice(added: string[]): Out[] {
  const dirs = new Map<string, number>();
  for (const p of added) {
    const d = p.includes("/") ? `${p.slice(0, p.lastIndexOf("/"))}/` : p;
    dirs.set(d, (dirs.get(d) ?? 0) + 1);
  }
  return [
    {
      kind: "rich",
      lines: [
        [{ t: "[DER] ", c: "accent" }, { t: `New evidence mounted under ~/case404 (${added.length} file${added.length === 1 ? "" : "s"}):`, c: "bold" }],
        ...[...dirs].sort(([a], [b]) => a.localeCompare(b)).map(([d, n]) => [{ t: `  ${d}`, c: d.endsWith("/") ? ("dir" as const) : undefined }, { t: n > 1 || d.endsWith("/") ? `  ${n} file${n === 1 ? "" : "s"}` : "", c: "muted" as const }]),
        [],
      ],
    },
  ];
}

export function CaseDataProvider({ children }: { children: ReactNode }) {
  const { state } = useTeam();
  const teamId = state?.team.id ?? null;
  const started = !!state && state.team.status !== "NOT_STARTED";
  const [challenges, setChallenges] = useState<ChallengeView[] | null>(null);
  const [listing, setListing] = useState<FileListing | null>(null);
  const [lightbox, setLightbox] = useState<{ src: string; name: string } | null>(null);
  const [overlayBusy, setOverlayBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reloadChallenges = useCallback(async () => {
    try {
      setChallenges(await api.challenges());
    } catch (e) {
      setError((e as ApiError).message);
    }
  }, []);

  // Refresh the board whenever anyone in the event solves something (solve counts, first bloods) or an act opens.
  const solveRev = state?.revisions.solves;
  const solvedKey = state?.solvedIds.join(",");
  const act = state?.acts.current;
  useEffect(() => {
    if (started) reloadChallenges();
  }, [started, solveRev, solvedKey, act, reloadChallenges]);

  // New evidence appears when an act opens or a challenge unlocks a file.
  useEffect(() => {
    if (!started) return;
    api
      .files()
      .then((next) => setListing((prev) => (prev && prev.revision === next.revision ? prev : next)))
      .catch((e: ApiError) => setError(e.message));
  }, [started, act, solvedKey]);

  const terminal = useTermSession({
    listing,
    urls: CASE_URLS,
    storageKey: teamId ? `c404.term.${teamId}` : null,
    motd: MOTD,
    onMount: mountNotice,
    showImage: setLightbox,
  });

  const value = useMemo(
    () => ({ challenges, reloadChallenges, listing, terminal, lightbox, showImage: setLightbox, overlayBusy, setOverlayBusy, error }),
    [challenges, reloadChallenges, listing, terminal, lightbox, overlayBusy, error],
  );
  return <CaseDataContext.Provider value={value}>{children}</CaseDataContext.Provider>;
}

export function useCaseData() {
  const ctx = useContext(CaseDataContext);
  if (!ctx) throw new Error("useCaseData outside CaseDataProvider");
  return ctx;
}
