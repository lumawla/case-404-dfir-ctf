import {
  ACTS,
  ACT_UNLOCK,
  CHALLENGE_IDS,
  DEFAULT_DURATION_SECONDS,
  VERDICT_ATTEMPTS,
  VERDICT_POINTS,
  computeScore,
  earnedAct,
  type ActNumber,
  type ActivityItem,
  type ActsView,
  type ChallengeId,
  type ClockState,
  type EventView,
  type ScoreBreakdown,
  type SuspectId,
  type TeamCaseStatus,
  type TeamState,
} from "@case404/shared";
import type { Clock } from "./clock.js";
import type { Config } from "./config.js";
import type { CaseContent, FileRecord } from "./content.js";
import { type Db, tx } from "./db.js";
import type { RateLimiter } from "./security.js";

export const EVENT_ID = "case-404";
export const CONNECTED_WINDOW_MS = 20_000;

export type AppContext = {
  db: Db;
  clock: Clock;
  config: Config;
  content: CaseContent;
  limiter: RateLimiter;
};

export type EventRow = {
  id: string;
  title: string;
  duration_seconds: number;
  registration_open: number;
  create_team_enabled: number;
  registration_code: string | null;
  min_team_size: number;
  max_team_size: number;
  start_open: number;
  leaderboard_public: number;
  reveal_at: string | null;
  paused_at: string | null;
  created_at: string;
};

export type TeamRow = {
  id: string;
  event_id: string;
  name: string;
  name_key: string;
  join_code_hash: string;
  started_at: string | null;
  deadline_at: string | null;
  completed_at: string | null;
  case_status: TeamCaseStatus;
  ending: string | null;
  act2_opened_at: string | null;
  act3_opened_at: string | null;
  notes_rev: number;
  created_at: string;
};

export type MemberRow = {
  id: string;
  team_id: string;
  nickname: string;
  nickname_key: string;
  session_token_hash: string | null;
  role: "captain" | "member";
  ready: number;
  revoked: number;
  joined_at: string;
  last_seen_at: string | null;
};

export const iso = (d: Date) => d.toISOString();

export function ensureEvent(ctx: AppContext): void {
  const existing = ctx.db.prepare("SELECT id FROM events WHERE id = ?").get(EVENT_ID);
  if (existing) return;
  ctx.db
    .prepare(
      `INSERT INTO events (id, title, duration_seconds, registration_open, create_team_enabled, registration_code,
        min_team_size, max_team_size, start_open, leaderboard_public, reveal_at, paused_at, created_at)
       VALUES (?, ?, ?, 1, 1, NULL, 2, 3, 0, 1, NULL, NULL, ?)`,
    )
    .run(EVENT_ID, "CASE 404 — The Last Photograph", DEFAULT_DURATION_SECONDS, iso(ctx.clock.now()));
}

export function getEvent(ctx: AppContext): EventRow {
  return ctx.db.prepare("SELECT * FROM events WHERE id = ?").get(EVENT_ID) as EventRow;
}

export function isRevealed(event: EventRow, now: Date): boolean {
  return !!event.reveal_at && now.getTime() >= Date.parse(event.reveal_at);
}

export function eventView(ctx: AppContext, event = getEvent(ctx)): EventView {
  return {
    id: event.id,
    title: event.title,
    durationSeconds: event.duration_seconds,
    minTeamSize: event.min_team_size,
    maxTeamSize: event.max_team_size,
    paused: !!event.paused_at,
    leaderboardPublic: !!event.leaderboard_public,
    revealed: isRevealed(event, ctx.clock.now()),
    startOpen: !!event.start_open,
  };
}

export function getTeam(ctx: AppContext, teamId: string): TeamRow | undefined {
  return ctx.db.prepare("SELECT * FROM teams WHERE id = ?").get(teamId) as TeamRow | undefined;
}

/** Applies server-side expiry. The effective "now" is frozen while the event is paused. */
export function refreshTeam(ctx: AppContext, team: TeamRow): TeamRow {
  if (team.case_status !== "ACTIVE" || !team.deadline_at) return team;
  const event = getEvent(ctx);
  const effectiveNow = event.paused_at ? Date.parse(event.paused_at) : ctx.clock.now().getTime();
  if (effectiveNow <= Date.parse(team.deadline_at)) return team;
  tx(ctx.db, () => {
    const res = ctx.db
      .prepare("UPDATE teams SET case_status = 'TIME_EXPIRED', completed_at = deadline_at WHERE id = ? AND case_status = 'ACTIVE'")
      .run(team.id);
    if (res.changes) addActivity(ctx, team.id, null, "expired", "Time expired. Submissions are closed; evidence remains readable.");
  });
  return getTeam(ctx, team.id)!;
}

export function solvedIds(ctx: AppContext, teamId: string): ChallengeId[] {
  const rows = ctx.db.prepare("SELECT challenge_id FROM team_solved WHERE team_id = ?").all(teamId) as { challenge_id: ChallengeId }[];
  const set = new Set(rows.map((r) => r.challenge_id));
  return CHALLENGE_IDS.filter((id) => set.has(id));
}

export function scoreFor(ctx: AppContext, team: TeamRow): ScoreBreakdown {
  const db = ctx.db;
  const flagPoints = (db.prepare("SELECT COALESCE(SUM(awarded_points), 0) AS s FROM team_solved WHERE team_id = ?").get(team.id) as { s: number }).s;
  const penalties = (db.prepare("SELECT COALESCE(SUM(penalty), 0) AS s FROM verdict_attempts WHERE team_id = ?").get(team.id) as { s: number }).s;
  const bonusPoints = (db.prepare("SELECT COALESCE(SUM(bonus), 0) AS s FROM verdict_attempts WHERE team_id = ? AND correct = 1").get(team.id) as { s: number }).s;
  const verdictPoints = team.case_status === "SOLVED" ? VERDICT_POINTS : 0;
  return { flagPoints, verdictPoints, bonusPoints, penalties, total: computeScore(flagPoints + verdictPoints + bonusPoints, penalties) };
}

export function currentAct(team: TeamRow): ActNumber {
  return team.act3_opened_at ? 3 : team.act2_opened_at ? 2 : 1;
}

/**
 * Opens every act up to `target` that isn't open yet and posts it to the team's activity.
 * Call inside a transaction. Returns the highest act newly opened, if any.
 */
export function openActs(ctx: AppContext, team: TeamRow, target: ActNumber, by: "solve" | "organizers"): ActNumber | null {
  const from = currentAct(getTeam(ctx, team.id)!);
  if (target <= from) return null;
  const now = iso(ctx.clock.now());
  for (const n of ACTS.filter((a) => a > from && a <= target)) {
    ctx.db.prepare(`UPDATE teams SET act${n}_opened_at = ? WHERE id = ? AND act${n}_opened_at IS NULL`).run(now, team.id);
    const act = ctx.content.acts.find((a) => a.n === n)!;
    const roman = n === 2 ? "II" : "III";
    addActivity(ctx, team.id, null, "act", `${by === "organizers" ? "Organizers opened " : ""}Act ${roman}: ${act.title}. New evidence is mounted.`);
  }
  return target;
}

/** Opens the next act when the team's solves earn it. Call inside the transaction that recorded the solve. */
export function advanceActs(ctx: AppContext, team: TeamRow): ActNumber | null {
  const fresh = getTeam(ctx, team.id)!;
  return openActs(ctx, fresh, earnedAct(solvedIds(ctx, team.id), currentAct(fresh)), "solve");
}

export function actsView(ctx: AppContext, team: TeamRow): ActsView {
  const current = currentAct(team);
  return {
    current,
    list: ctx.content.acts.map((a) => {
      const open = a.n <= current;
      return {
        n: a.n,
        open,
        openedAt: a.n === 1 ? team.started_at : a.n === 2 ? team.act2_opened_at : team.act3_opened_at,
        title: open ? a.title : null,
        intro: open ? a.intro : null,
        unlock: ACT_UNLOCK[a.n].text,
      };
    }),
  };
}

/** Whether a team can see an evidence file: its act is open and, for files tied to a challenge, that challenge is owned. */
export function fileVisible(file: FileRecord, act: ActNumber, solved: ReadonlySet<ChallengeId>): boolean {
  return file.unlock.act <= act && (!file.unlock.solved || solved.has(file.unlock.solved));
}

export function visibleFiles(ctx: AppContext, team: TeamRow): FileRecord[] {
  const act = currentAct(team);
  const solved = new Set(solvedIds(ctx, team.id));
  return [...ctx.content.files.values()].filter((f) => fileVisible(f, act, solved));
}

/** Event-wide count of solves. Clients refetch the challenge board when it changes (solve counts, first bloods). */
export function solveRevision(ctx: AppContext): number {
  return (ctx.db.prepare("SELECT COUNT(*) AS n FROM team_solved").get() as { n: number }).n;
}

export function verdictAttempts(ctx: AppContext, teamId: string) {
  return ctx.db
    .prepare("SELECT * FROM verdict_attempts WHERE team_id = ? ORDER BY attempt_no")
    .all(teamId) as {
    attempt_no: number;
    suspect_id: SuspectId;
    motive_id: string;
    accomplice_id: SuspectId | null;
    files: string;
    correct: number;
    penalty: number;
    bonus: number;
    member_id: string | null;
    submitted_at: string;
  }[];
}

export function addActivity(ctx: AppContext, teamId: string, memberId: string | null, kind: ActivityItem["kind"], text: string) {
  ctx.db
    .prepare("INSERT INTO team_activity (team_id, member_id, kind, text, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(teamId, memberId, kind, text, iso(ctx.clock.now()));
}

export function clockState(ctx: AppContext, team: TeamRow, event = getEvent(ctx)): ClockState {
  return {
    serverNow: iso(ctx.clock.now()),
    startedAt: team.started_at,
    deadlineAt: team.deadline_at,
    completedAt: team.completed_at,
    status: team.case_status,
    paused: !!event.paused_at,
  };
}

export function membersOf(ctx: AppContext, teamId: string): MemberRow[] {
  return ctx.db.prepare("SELECT * FROM team_members WHERE team_id = ? AND revoked = 0 ORDER BY joined_at").all(teamId) as MemberRow[];
}

export function buildTeamState(ctx: AppContext, team: TeamRow, me: MemberRow): TeamState {
  const event = getEvent(ctx);
  const nowMs = ctx.clock.now().getTime();
  const nicknames = new Map((ctx.db.prepare("SELECT id, nickname FROM team_members WHERE team_id = ?").all(team.id) as { id: string; nickname: string }[]).map((m) => [m.id, m.nickname]));

  const activity = (ctx.db.prepare("SELECT * FROM team_activity WHERE team_id = ? ORDER BY id DESC LIMIT 30").all(team.id) as { id: number; member_id: string | null; kind: ActivityItem["kind"]; text: string; created_at: string }[]).map((a) => ({
    id: a.id,
    at: a.created_at,
    nickname: a.member_id ? (nicknames.get(a.member_id) ?? null) : null,
    kind: a.kind,
    text: a.text,
  }));

  const announcements = (ctx.db.prepare("SELECT * FROM announcements WHERE event_id = ? ORDER BY id DESC LIMIT 10").all(event.id) as { id: number; body: string; created_at: string }[]).map((a) => ({ id: a.id, at: a.created_at, body: a.body }));

  return {
    team: {
      id: team.id,
      name: team.name,
      status: team.case_status,
      startedAt: team.started_at,
      deadlineAt: team.deadline_at,
      completedAt: team.completed_at,
      score: scoreFor(ctx, team),
    },
    me: { memberId: me.id, nickname: me.nickname, role: me.role },
    members: membersOf(ctx, team.id).map((m) => ({
      id: m.id,
      nickname: m.nickname,
      role: m.role,
      ready: !!m.ready,
      connected: !!m.last_seen_at && nowMs - Date.parse(m.last_seen_at) < CONNECTED_WINDOW_MS,
      isMe: m.id === me.id,
    })),
    event: eventView(ctx, event),
    clock: clockState(ctx, team, event),
    solvedIds: solvedIds(ctx, team.id),
    verdict: { attemptsUsed: verdictAttempts(ctx, team.id).length, attemptsMax: VERDICT_ATTEMPTS },
    activity,
    announcements,
    acts: actsView(ctx, team),
    revisions: { notes: team.notes_rev, solves: solveRevision(ctx) },
  };
}
