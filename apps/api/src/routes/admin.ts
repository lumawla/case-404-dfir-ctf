import type { FastifyInstance } from "fastify";
import { adminAuth, sendError, setSessionCookie } from "../app.js";
import { tx } from "../db.js";
import { ADMIN_COOKIE, SESSION_TTL_SECONDS, keyedHash, newJoinCode, newToken, normalizeJoinCode, safeEqual, sha256 } from "../security.js";
import {
  type AppContext,
  type EventRow,
  type MemberRow,
  type TeamRow,
  CONNECTED_WINDOW_MS,
  EVENT_ID,
  addActivity,
  currentAct,
  getEvent,
  getTeam,
  iso,
  openActs,
  refreshTeam,
  scoreFor,
  solvedIds,
  verdictAttempts,
} from "../state.js";
import { leaderboard } from "./public.js";

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  // Neutralize spreadsheet formula injection and quote when needed.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function registerAdminRoutes(app: FastifyInstance, ctx: AppContext) {
  const auth = adminAuth(ctx);
  const audit = (action: string, payload: Record<string, unknown>) =>
    ctx.db.prepare("INSERT INTO admin_audit (event_id, actor, action, payload, occurred_at) VALUES (?, 'organizer', ?, ?, ?)").run(EVENT_ID, action, JSON.stringify(payload), iso(ctx.clock.now()));

  app.post<{ Body: { token: string } }>(
    "/api/admin/login",
    { schema: { body: { type: "object", required: ["token"], properties: { token: { type: "string", maxLength: 500 } } } } },
    async (req, reply) => {
      const rl = ctx.limiter.hit(`admin:${req.ip}`, 10, 60_000, ctx.clock.now().getTime());
      if (!rl.ok) return sendError(reply, 429, "rate_limited", "Too many attempts. Wait a minute.", { retryAfterSeconds: rl.retryAfterSeconds });
      if (!ctx.config.adminToken || !safeEqual(req.body.token, ctx.config.adminToken)) return sendError(reply, 401, "bad_token", "That organizer token is not valid.");
      const token = newToken();
      const now = ctx.clock.now();
      ctx.db.prepare("INSERT INTO admin_sessions (token_hash, created_at, expires_at) VALUES (?, ?, ?)").run(sha256(token), iso(now), iso(new Date(now.getTime() + SESSION_TTL_SECONDS * 1000)));
      setSessionCookie(ctx, reply, ADMIN_COOKIE, token);
      audit("login", { ip: req.ip });
      return { ok: true };
    },
  );

  app.post("/api/admin/logout", { preHandler: auth }, async (req, reply) => {
    const token = req.cookies[ADMIN_COOKIE];
    if (token) ctx.db.prepare("DELETE FROM admin_sessions WHERE token_hash = ?").run(sha256(token));
    reply.clearCookie(ADMIN_COOKIE, { path: "/" });
    return { ok: true };
  });

  const eventConfig = (e: EventRow) => ({
    title: e.title,
    durationSeconds: e.duration_seconds,
    registrationOpen: !!e.registration_open,
    createTeamEnabled: !!e.create_team_enabled,
    registrationCode: e.registration_code,
    minTeamSize: e.min_team_size,
    maxTeamSize: e.max_team_size,
    startOpen: !!e.start_open,
    leaderboardPublic: !!e.leaderboard_public,
    revealAt: e.reveal_at,
    pausedAt: e.paused_at,
  });

  const teamSummary = (t: TeamRow) => {
    const team = refreshTeam(ctx, t);
    const now = ctx.clock.now().getTime();
    const members = ctx.db.prepare("SELECT * FROM team_members WHERE team_id = ? AND revoked = 0").all(team.id) as MemberRow[];
    const event = getEvent(ctx);
    const effectiveNow = event.paused_at ? Date.parse(event.paused_at) : now;
    return {
      id: team.id,
      name: team.name,
      status: team.case_status,
      startedAt: team.started_at,
      deadlineAt: team.deadline_at,
      completedAt: team.completed_at,
      remainingSeconds: team.case_status === "ACTIVE" && team.deadline_at ? Math.max(0, Math.round((Date.parse(team.deadline_at) - effectiveNow) / 1000)) : null,
      elapsedSeconds: team.started_at ? Math.round(((team.completed_at ? Date.parse(team.completed_at) : now) - Date.parse(team.started_at)) / 1000) : null,
      score: scoreFor(ctx, team).total,
      act: currentAct(team),
      solvedIds: solvedIds(ctx, team.id),
      verdictAttempts: verdictAttempts(ctx, team.id).length,
      members: members.map((m) => ({ id: m.id, nickname: m.nickname, role: m.role, connected: !!m.last_seen_at && now - Date.parse(m.last_seen_at) < CONNECTED_WINDOW_MS })),
    };
  };

  app.get("/api/admin/overview", { preHandler: auth }, async () => {
    const event = getEvent(ctx);
    const teams = ctx.db.prepare("SELECT * FROM teams ORDER BY created_at").all() as TeamRow[];
    return {
      serverNow: iso(ctx.clock.now()),
      event: eventConfig(event),
      teams: teams.map(teamSummary),
      announcements: ctx.db.prepare("SELECT id, body, created_at AS at FROM announcements ORDER BY id DESC LIMIT 20").all(),
      audit: (ctx.db.prepare("SELECT id, action, payload, occurred_at AS at FROM admin_audit ORDER BY id DESC LIMIT 50").all() as { payload: string }[]).map((a) => ({
        ...a,
        payload: JSON.parse(a.payload),
      })),
    };
  });

  app.put<{ Body: Partial<ReturnType<typeof eventConfig>> }>(
    "/api/admin/event",
    {
      preHandler: auth,
      schema: {
        body: {
          type: "object",
          properties: {
            title: { type: "string", minLength: 1, maxLength: 120 },
            durationSeconds: { type: "integer", minimum: 300, maximum: 14400 },
            registrationOpen: { type: "boolean" },
            createTeamEnabled: { type: "boolean" },
            registrationCode: { type: ["string", "null"], maxLength: 40 },
            minTeamSize: { type: "integer", minimum: 1, maximum: 4 },
            maxTeamSize: { type: "integer", minimum: 1, maximum: 4 },
            startOpen: { type: "boolean" },
            leaderboardPublic: { type: "boolean" },
            revealAt: { type: ["string", "null"], format: "date-time" },
          },
        },
      },
    },
    async (req, reply) => {
      const current = eventConfig(getEvent(ctx));
      const next = { ...current, ...req.body };
      if (next.minTeamSize > next.maxTeamSize) return sendError(reply, 400, "invalid_sizes", "Minimum team size cannot exceed the maximum.");
      const code = next.registrationCode ? next.registrationCode.trim() : null;
      ctx.db
        .prepare(
          `UPDATE events SET title = ?, duration_seconds = ?, registration_open = ?, create_team_enabled = ?, registration_code = ?,
           min_team_size = ?, max_team_size = ?, start_open = ?, leaderboard_public = ?, reveal_at = ? WHERE id = ?`,
        )
        .run(
          next.title,
          next.durationSeconds,
          next.registrationOpen ? 1 : 0,
          next.createTeamEnabled ? 1 : 0,
          code || null,
          next.minTeamSize,
          next.maxTeamSize,
          next.startOpen ? 1 : 0,
          next.leaderboardPublic ? 1 : 0,
          next.revealAt ? iso(new Date(next.revealAt)) : null,
          EVENT_ID,
        );
      audit("update_event", { changes: req.body });
      return eventConfig(getEvent(ctx));
    },
  );

  app.post<{ Body: { reason?: string } }>("/api/admin/event/pause", { preHandler: auth }, async (req, reply) => {
    const event = getEvent(ctx);
    if (event.paused_at) return sendError(reply, 409, "already_paused", "The event is already paused.");
    for (const t of ctx.db.prepare("SELECT * FROM teams WHERE case_status = 'ACTIVE'").all() as TeamRow[]) refreshTeam(ctx, t);
    const now = iso(ctx.clock.now());
    tx(ctx.db, () => {
      ctx.db.prepare("UPDATE events SET paused_at = ? WHERE id = ?").run(now, EVENT_ID);
      audit("pause_event", { at: now, reason: req.body?.reason ?? "" });
    });
    return eventConfig(getEvent(ctx));
  });

  /** Resuming shifts every active team's deadline by the paused duration, so nobody loses time. */
  app.post<{ Body: { reason?: string } }>("/api/admin/event/resume", { preHandler: auth }, async (req, reply) => {
    const event = getEvent(ctx);
    if (!event.paused_at) return sendError(reply, 409, "not_paused", "The event is not paused.");
    const now = ctx.clock.now();
    const pausedMs = now.getTime() - Date.parse(event.paused_at);
    tx(ctx.db, () => {
      const active = ctx.db.prepare("SELECT * FROM teams WHERE case_status = 'ACTIVE' AND deadline_at IS NOT NULL").all() as TeamRow[];
      for (const t of active) {
        ctx.db.prepare("UPDATE teams SET deadline_at = ? WHERE id = ?").run(iso(new Date(Date.parse(t.deadline_at!) + pausedMs)), t.id);
      }
      ctx.db.prepare("UPDATE events SET paused_at = NULL WHERE id = ?").run(EVENT_ID);
      audit("resume_event", { pausedSeconds: Math.round(pausedMs / 1000), teamsShifted: active.length, reason: req.body?.reason ?? "" });
    });
    return eventConfig(getEvent(ctx));
  });

  app.post("/api/admin/event/reveal", { preHandler: auth }, async () => {
    const now = iso(ctx.clock.now());
    ctx.db.prepare("UPDATE events SET reveal_at = ? WHERE id = ?").run(now, EVENT_ID);
    audit("reveal_now", { at: now });
    return eventConfig(getEvent(ctx));
  });

  app.post<{ Body: { body: string } }>(
    "/api/admin/announce",
    { preHandler: auth, schema: { body: { type: "object", required: ["body"], properties: { body: { type: "string", minLength: 1, maxLength: 500 } } } } },
    async (req) => {
      const body = req.body.body.trim();
      ctx.db.prepare("INSERT INTO announcements (event_id, body, created_at) VALUES (?, ?, ?)").run(EVENT_ID, body, iso(ctx.clock.now()));
      audit("announce", { body });
      return { ok: true };
    },
  );

  app.get<{ Params: { id: string } }>("/api/admin/teams/:id", { preHandler: auth }, async (req, reply) => {
    const team = getTeam(ctx, req.params.id);
    if (!team) return sendError(reply, 404, "not_found", "Team not found.");
    const submissions = ctx.db.prepare("SELECT challenge_id, SUM(correct) AS correct, COUNT(*) AS total FROM submissions WHERE team_id = ? GROUP BY challenge_id").all(team.id);
    const names = new Map((ctx.db.prepare("SELECT id, nickname FROM team_members WHERE team_id = ?").all(team.id) as { id: string; nickname: string }[]).map((m) => [m.id, m.nickname]));
    const verdicts = (ctx.db.prepare("SELECT * FROM verdict_attempts WHERE team_id = ? ORDER BY attempt_no").all(team.id) as Record<string, unknown>[]).map((v) => ({
      attemptNo: v.attempt_no,
      suspectId: v.suspect_id,
      motiveId: v.motive_id,
      accompliceId: v.accomplice_id,
      files: JSON.parse(v.files as string),
      correct: !!v.correct,
      penalty: v.penalty,
      bonus: v.bonus,
      by: names.get(v.member_id as string) ?? null,
      at: v.submitted_at,
    }));
    return { ...teamSummary(team), submissions, verdicts };
  });

  /** Staff-granted extension. Re-opens a team that expired during an incident if the new deadline is in the future. */
  app.post<{ Params: { id: string }; Body: { minutes: number; reason: string } }>(
    "/api/admin/teams/:id/extend",
    {
      preHandler: auth,
      schema: {
        body: {
          type: "object",
          required: ["minutes", "reason"],
          properties: { minutes: { type: "integer", minimum: 1, maximum: 60 }, reason: { type: "string", minLength: 3, maxLength: 300 } },
        },
      },
    },
    async (req, reply) => {
      const team = getTeam(ctx, req.params.id);
      if (!team) return sendError(reply, 404, "not_found", "Team not found.");
      if (!team.deadline_at || (team.case_status !== "ACTIVE" && team.case_status !== "TIME_EXPIRED")) {
        return sendError(reply, 409, "not_extendable", "Only started teams that are active or timed out can be extended.");
      }
      const newDeadline = new Date(Date.parse(team.deadline_at) + req.body.minutes * 60_000);
      const reopen = team.case_status === "TIME_EXPIRED" && newDeadline.getTime() > (getEvent(ctx).paused_at ? Date.parse(getEvent(ctx).paused_at!) : ctx.clock.now().getTime());
      tx(ctx.db, () => {
        ctx.db
          .prepare(`UPDATE teams SET deadline_at = ?${reopen ? ", case_status = 'ACTIVE', completed_at = NULL" : ""} WHERE id = ?`)
          .run(iso(newDeadline), team.id);
        addActivity(ctx, team.id, null, "admin", `Organizers added ${req.body.minutes} minute(s) to your clock.`);
        audit("extend_team", { teamId: team.id, team: team.name, minutes: req.body.minutes, reason: req.body.reason, reopened: reopen, newDeadline: iso(newDeadline) });
      });
      return teamSummary(getTeam(ctx, team.id)!);
    },
  );

  /** Opens an act early for a team that is stuck. Opening Act III also opens Act II. Acts never close again. */
  app.post<{ Params: { id: string }; Body: { act: 2 | 3; reason: string } }>(
    "/api/admin/teams/:id/open-act",
    {
      preHandler: auth,
      schema: {
        body: {
          type: "object",
          required: ["act", "reason"],
          properties: { act: { type: "integer", enum: [2, 3] }, reason: { type: "string", minLength: 3, maxLength: 300 } },
        },
      },
    },
    async (req, reply) => {
      const team = getTeam(ctx, req.params.id);
      if (!team) return sendError(reply, 404, "not_found", "Team not found.");
      if (team.case_status === "NOT_STARTED") return sendError(reply, 409, "not_started", "The team hasn't begun the investigation.");
      if (currentAct(team) >= req.body.act) return sendError(reply, 409, "already_open", "That act is already open for this team.");
      tx(ctx.db, () => {
        openActs(ctx, team, req.body.act, "organizers");
        audit("open_act", { teamId: team.id, team: team.name, act: req.body.act, reason: req.body.reason });
      });
      return teamSummary(getTeam(ctx, team.id)!);
    },
  );

  /** Destructive: wipes a team's progress. Requires the exact team name as confirmation. */
  app.post<{ Params: { id: string }; Body: { confirmTeamName: string; reason: string } }>(
    "/api/admin/teams/:id/reset",
    {
      preHandler: auth,
      schema: {
        body: {
          type: "object",
          required: ["confirmTeamName", "reason"],
          properties: { confirmTeamName: { type: "string" }, reason: { type: "string", minLength: 3, maxLength: 300 } },
        },
      },
    },
    async (req, reply) => {
      const team = getTeam(ctx, req.params.id);
      if (!team) return sendError(reply, 404, "not_found", "Team not found.");
      if (req.body.confirmTeamName !== team.name) return sendError(reply, 400, "confirm_mismatch", "Type the team name exactly to confirm the reset.");
      tx(ctx.db, () => {
        for (const table of ["submissions", "team_solved", "verdict_attempts"]) {
          ctx.db.prepare(`DELETE FROM ${table} WHERE team_id = ?`).run(team.id);
        }
        ctx.db
          .prepare(
            "UPDATE teams SET started_at = NULL, deadline_at = NULL, completed_at = NULL, case_status = 'NOT_STARTED', ending = NULL, act2_opened_at = NULL, act3_opened_at = NULL WHERE id = ?",
          )
          .run(team.id);
        addActivity(ctx, team.id, null, "admin", "Organizers reset your team's investigation.");
        audit("reset_team", { teamId: team.id, team: team.name, reason: req.body.reason });
      });
      return teamSummary(getTeam(ctx, team.id)!);
    },
  );

  app.post<{ Params: { id: string } }>("/api/admin/teams/:id/regenerate-code", { preHandler: auth }, async (req, reply) => {
    const team = getTeam(ctx, req.params.id);
    if (!team) return sendError(reply, 404, "not_found", "Team not found.");
    const code = newJoinCode();
    ctx.db.prepare("UPDATE teams SET join_code_hash = ? WHERE id = ?").run(keyedHash(ctx.config.appSecret, `join:${normalizeJoinCode(code)}`), team.id);
    audit("regenerate_code", { teamId: team.id, team: team.name });
    return { joinCode: code };
  });

  app.post<{ Params: { id: string; memberId: string } }>("/api/admin/teams/:id/members/:memberId/revoke", { preHandler: auth }, async (req, reply) => {
    const res = ctx.db.prepare("UPDATE team_members SET revoked = 1, session_token_hash = NULL WHERE id = ? AND team_id = ?").run(req.params.memberId, req.params.id);
    if (!res.changes) return sendError(reply, 404, "not_found", "Member not found.");
    audit("revoke_member", { teamId: req.params.id, memberId: req.params.memberId });
    return { ok: true };
  });

  app.get("/api/admin/export", { preHandler: auth }, async (_req, reply) => {
    const header = ["rank", "team", "score", "status", "flags_solved", "elapsed_seconds", "last_score_at_utc", "started_at_utc", "completed_at_utc"];
    const lines = [header.join(",")];
    for (const r of leaderboard(ctx)) {
      lines.push([r.rank, r.teamName, r.score, r.status, r.solvedCount, r.elapsedSeconds, r.lastScoreAt, r.startedAt, r.completedAt].map(csvCell).join(","));
    }
    audit("export_csv", { rows: lines.length - 1 });
    reply.header("Content-Type", "text/csv; charset=utf-8");
    reply.header("Content-Disposition", 'attachment; filename="case404-leaderboard.csv"');
    return `${lines.join("\n")}\n`;
  });
}
