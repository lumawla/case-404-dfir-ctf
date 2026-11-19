import type {
  AccusationOptions,
  AccusationResult,
  CaseFile,
  ChallengeView,
  FileListing,
  FlagResult,
  LeaderboardRow,
  Note,
  PracticeResult,
  PracticeTask,
  ResultView,
  TeamState,
  TimelineEntry,
} from "@case404/shared";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public data: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "network", "Can't reach the case server. Check your connection — your progress is saved on the server.");
  }
  const text = await res.text();
  const data = text ? (() => { try { return JSON.parse(text); } catch { return { message: text }; } })() : {};
  if (!res.ok) throw new ApiError(res.status, data.error ?? "error", data.message ?? `Request failed (${res.status}).`, data);
  return data as T;
}

export type PublicEvent = {
  title: string;
  durationSeconds: number;
  registrationOpen: boolean;
  createTeamEnabled: boolean;
  requiresRegistrationCode: boolean;
  minTeamSize: number;
  maxTeamSize: number;
  leaderboardPublic: boolean;
  paused: boolean;
  serverNow: string;
};

/** URL of an evidence file's bytes (path relative to ~/case404). */
export const fileUrl = (path: string, download = false) => `/api/case/fs/raw?path=${encodeURIComponent(path)}${download ? "&download=1" : ""}`;

/** URL of a practice-folder file's bytes (path relative to ~/training). */
export const practiceFileUrl = (path: string, download = false) => `/api/practice/fs/raw?path=${encodeURIComponent(path)}${download ? "&download=1" : ""}`;

export const api = {
  event: () => request<PublicEvent>("GET", "/api/event"),
  createTeam: (teamName: string, nickname: string, registrationCode?: string) =>
    request<{ joinCode: string; state: TeamState }>("POST", "/api/teams", { teamName, nickname, registrationCode }),
  recoveryKey: () => request<{ recoveryKey: string }>("GET", "/api/me/recovery-key"),
  joinTeam: (code: string, nickname: string, recoveryKey?: string) => request<{ state: TeamState }>("POST", "/api/teams/join", { code, nickname, recoveryKey }),
  teamState: () => request<TeamState>("GET", "/api/me/team-state"),
  setReady: (ready: boolean) => request<TeamState>("POST", "/api/me/ready", { ready }),
  logout: () => request<{ ok: true }>("POST", "/api/me/logout", {}),
  start: () => request<TeamState>("POST", "/api/case/start", {}),
  caseFile: () => request<CaseFile>("GET", "/api/case/file"),
  challenges: () => request<ChallengeView[]>("GET", "/api/case/challenges"),
  files: () => request<FileListing>("GET", "/api/case/fs"),
  timeline: () => request<TimelineEntry[]>("GET", "/api/case/timeline"),
  submitFlag: (id: string, answer: string) => request<FlagResult>("POST", `/api/case/challenges/${id}/submit`, { answer }),
  accusation: () => request<AccusationOptions>("GET", "/api/case/accusation"),
  accuse: (suspectId: string, motiveId: string, accompliceId: string | null, files: string[], expectedAttempt: number) =>
    request<AccusationResult>("POST", "/api/case/accusation", { suspectId, motiveId, accompliceId, files, expectedAttempt }),
  result: () => request<ResultView>("GET", "/api/case/result"),
  leaderboard: () => request<{ rows: LeaderboardRow[]; serverNow: string }>("GET", "/api/leaderboard"),
  notes: () => request<{ notes: Note[]; revision: number }>("GET", "/api/notes"),
  createNote: (note: Partial<Note>) => request<Note>("POST", "/api/notes", note),
  updateNote: (id: string, note: Partial<Note> & { version: number }) => request<Note>("PUT", `/api/notes/${id}`, note),
  deleteNote: (id: string, version: number) => request<{ ok: true }>("DELETE", `/api/notes/${id}?version=${version}`),
  practice: {
    files: () => request<FileListing>("GET", "/api/practice/fs"),
    tasks: () => request<PracticeTask[]>("GET", "/api/practice/tasks"),
    submit: (id: string, answer: string) => request<PracticeResult>("POST", `/api/practice/tasks/${id}/submit`, { answer }),
  },
  admin: {
    login: (token: string) => request<{ ok: true }>("POST", "/api/admin/login", { token }),
    logout: () => request<{ ok: true }>("POST", "/api/admin/logout", {}),
    overview: () => request<AdminOverview>("GET", "/api/admin/overview"),
    updateEvent: (patch: Partial<AdminEventConfig>) => request<AdminEventConfig>("PUT", "/api/admin/event", patch),
    pause: (reason: string) => request<AdminEventConfig>("POST", "/api/admin/event/pause", { reason }),
    resume: (reason: string) => request<AdminEventConfig>("POST", "/api/admin/event/resume", { reason }),
    reveal: () => request<AdminEventConfig>("POST", "/api/admin/event/reveal", {}),
    announce: (body: string) => request<{ ok: true }>("POST", "/api/admin/announce", { body }),
    team: (id: string) => request<AdminTeam & { verdicts: AdminVerdict[]; submissions: { challenge_id: string; correct: number; total: number }[] }>("GET", `/api/admin/teams/${id}`),
    extend: (id: string, minutes: number, reason: string) => request<AdminTeam>("POST", `/api/admin/teams/${id}/extend`, { minutes, reason }),
    openAct: (id: string, act: 2 | 3, reason: string) => request<AdminTeam>("POST", `/api/admin/teams/${id}/open-act`, { act, reason }),
    reset: (id: string, confirmTeamName: string, reason: string) => request<AdminTeam>("POST", `/api/admin/teams/${id}/reset`, { confirmTeamName, reason }),
    regenerateCode: (id: string) => request<{ joinCode: string }>("POST", `/api/admin/teams/${id}/regenerate-code`, {}),
    revokeMember: (id: string, memberId: string) => request<{ ok: true }>("POST", `/api/admin/teams/${id}/members/${memberId}/revoke`, {}),
  },
};

export type AdminEventConfig = {
  title: string;
  durationSeconds: number;
  registrationOpen: boolean;
  createTeamEnabled: boolean;
  registrationCode: string | null;
  minTeamSize: number;
  maxTeamSize: number;
  startOpen: boolean;
  leaderboardPublic: boolean;
  revealAt: string | null;
  pausedAt: string | null;
};

export type AdminTeam = {
  id: string;
  name: string;
  status: string;
  startedAt: string | null;
  deadlineAt: string | null;
  completedAt: string | null;
  remainingSeconds: number | null;
  elapsedSeconds: number | null;
  score: number;
  act: 1 | 2 | 3;
  solvedIds: string[];
  verdictAttempts: number;
  members: { id: string; nickname: string; role: string; connected: boolean }[];
};

export type AdminVerdict = {
  attemptNo: number;
  suspectId: string;
  motiveId: string;
  accompliceId: string | null;
  files: string[];
  correct: boolean;
  penalty: number;
  bonus: number;
  by: string | null;
  at: string;
};

export type AdminOverview = {
  serverNow: string;
  event: AdminEventConfig;
  teams: AdminTeam[];
  announcements: { id: number; body: string; at: string }[];
  audit: { id: number; action: string; payload: Record<string, unknown>; at: string }[];
};
