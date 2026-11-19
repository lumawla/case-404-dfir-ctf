import type { FastifyInstance } from "fastify";
import type { LeaderboardRow } from "@case404/shared";
import { ADMIN_COOKIE, sha256 } from "../security.js";
import { type AppContext, type TeamRow, getEvent, refreshTeam, scoreFor, solvedIds } from "../state.js";

type Row = LeaderboardRow & { teamId: string; startedAt: string | null; completedAt: string | null };

/**
 * Ranking: score desc → whoever reached that score first (HTB-style) → team name.
 * All times come from server timestamps.
 */
export function leaderboard(ctx: AppContext): Row[] {
  const teams = (ctx.db.prepare("SELECT * FROM teams ORDER BY created_at").all() as TeamRow[]).map((t) => refreshTeam(ctx, t));
  const rows = teams.map((t) => {
    const done = t.case_status === "SOLVED" || t.case_status === "WRONG_VERDICT" || t.case_status === "TIME_EXPIRED";
    const lastSolve = (ctx.db.prepare("SELECT MAX(solved_at) AS at FROM team_solved WHERE team_id = ?").get(t.id) as { at: string | null }).at;
    const lastScoreAt = t.case_status === "SOLVED" && t.completed_at && (!lastSolve || t.completed_at > lastSolve) ? t.completed_at : lastSolve;
    return {
      teamId: t.id,
      rank: 0,
      teamName: t.name,
      score: scoreFor(ctx, t).total,
      status: t.case_status,
      solvedCount: solvedIds(ctx, t.id).length,
      elapsedSeconds: t.started_at && done && t.completed_at ? Math.round((Date.parse(t.completed_at) - Date.parse(t.started_at)) / 1000) : null,
      lastScoreAt,
      startedAt: t.started_at,
      completedAt: t.completed_at,
    };
  });
  rows.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.lastScoreAt && b.lastScoreAt && a.lastScoreAt !== b.lastScoreAt) return a.lastScoreAt < b.lastScoreAt ? -1 : 1;
    if (!!a.lastScoreAt !== !!b.lastScoreAt) return a.lastScoreAt ? -1 : 1;
    return a.teamName.localeCompare(b.teamName);
  });
  rows.forEach((r, i) => (r.rank = i + 1));
  return rows;
}

export function registerPublicRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get("/api/health", async () => ({ ok: true, serverNow: ctx.clock.now().toISOString() }));

  app.get("/api/event", async () => {
    const e = getEvent(ctx);
    return {
      title: e.title,
      durationSeconds: e.duration_seconds,
      registrationOpen: !!e.registration_open,
      createTeamEnabled: !!e.create_team_enabled,
      requiresRegistrationCode: !!e.registration_code,
      minTeamSize: e.min_team_size,
      maxTeamSize: e.max_team_size,
      leaderboardPublic: !!e.leaderboard_public,
      paused: !!e.paused_at,
      serverNow: ctx.clock.now().toISOString(),
    };
  });

  app.get("/api/leaderboard", async (req, reply) => {
    const e = getEvent(ctx);
    const adminToken = req.cookies[ADMIN_COOKIE];
    const isAdmin =
      !!adminToken && !!ctx.db.prepare("SELECT 1 FROM admin_sessions WHERE token_hash = ? AND expires_at > ?").get(sha256(adminToken), ctx.clock.now().toISOString());
    if (!e.leaderboard_public && !isAdmin) {
      return reply.code(403).send({ error: "leaderboard_hidden", message: "The organizers have hidden the leaderboard for now." });
    }
    return {
      rows: leaderboard(ctx).map(({ teamId: _t, startedAt: _s, completedAt: _c, ...row }) => row),
      serverNow: ctx.clock.now().toISOString(),
    };
  });
}
