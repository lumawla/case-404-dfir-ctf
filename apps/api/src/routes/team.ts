import type { FastifyInstance } from "fastify";
import { sendError, setSessionCookie, teamAuth } from "../app.js";
import { tx } from "../db.js";
import { SESSION_COOKIE, cleanName, keyedHash, newId, newJoinCode, newToken, normalizeJoinCode, safeEqual, sha256 } from "../security.js";
import { type AppContext, type MemberRow, type TeamRow, EVENT_ID, addActivity, buildTeamState, clockState, getEvent, getTeam, iso, membersOf } from "../state.js";

// Per-IP limits. A whole event room usually shares one public IP (venue Wi-Fi NAT), so these are
// sized for ~40 teams arriving in the same minute. Join codes carry 60 bits, so this still makes
// guessing them hopeless.
const JOIN_LIMIT = { limit: 150, windowMs: 60_000 };
const CREATE_LIMIT = { limit: 60, windowMs: 60_000 };

export function registerTeamRoutes(app: FastifyInstance, ctx: AppContext) {
  const auth = teamAuth(ctx);
  const codeHash = (code: string) => keyedHash(ctx.config.appSecret, `join:${normalizeJoinCode(code)}`);

  function issueSession(reply: import("fastify").FastifyReply, memberId: string) {
    const token = newToken();
    ctx.db.prepare("UPDATE team_members SET session_token_hash = ?, last_seen_at = ? WHERE id = ?").run(sha256(token), iso(ctx.clock.now()), memberId);
    reply.header("Clear-Site-Data", '"cache"');
    setSessionCookie(ctx, reply, SESSION_COOKIE, token);
  }

  app.post<{ Body: { teamName: string; nickname: string; registrationCode?: string } }>(
    "/api/teams",
    {
      schema: {
        body: {
          type: "object",
          required: ["teamName", "nickname"],
          properties: { teamName: { type: "string" }, nickname: { type: "string" }, registrationCode: { type: "string" } },
        },
      },
    },
    async (req, reply) => {
      const rl = ctx.limiter.hit(`create:${req.ip}`, CREATE_LIMIT.limit, CREATE_LIMIT.windowMs, ctx.clock.now().getTime());
      if (!rl.ok) return sendError(reply, 429, "rate_limited", "Too many attempts. Wait a moment and try again.", { retryAfterSeconds: rl.retryAfterSeconds });
      const event = getEvent(ctx);
      if (!event.registration_open || !event.create_team_enabled) return sendError(reply, 403, "registration_closed", "Team creation is closed. Ask an organizer for a team code.");
      if (event.registration_code && !safeEqual(event.registration_code.toUpperCase(), (req.body.registrationCode ?? "").trim().toUpperCase())) {
        return sendError(reply, 403, "bad_registration_code", "That event code isn't right. Check the code on the screen.");
      }
      const teamName = cleanName(req.body.teamName, 2, 40);
      const nickname = cleanName(req.body.nickname, 1, 24);
      if (!teamName) return sendError(reply, 400, "invalid_team_name", "Team names need 2–40 characters.");
      if (!nickname) return sendError(reply, 400, "invalid_nickname", "Nicknames need 1–24 characters.");
      const nameKey = teamName.toLowerCase();
      if (ctx.db.prepare("SELECT 1 FROM teams WHERE event_id = ? AND name_key = ?").get(EVENT_ID, nameKey)) {
        return sendError(reply, 409, "team_name_taken", "Another team already uses that name.");
      }
      const joinCode = newJoinCode();
      const teamId = newId("team");
      const memberId = newId("mem");
      const now = iso(ctx.clock.now());
      tx(ctx.db, () => {
        ctx.db
          .prepare("INSERT INTO teams (id, event_id, name, name_key, join_code_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)")
          .run(teamId, EVENT_ID, teamName, nameKey, codeHash(joinCode), now);
        ctx.db
          .prepare("INSERT INTO team_members (id, team_id, nickname, nickname_key, role, joined_at) VALUES (?, ?, ?, ?, 'captain', ?)")
          .run(memberId, teamId, nickname, nickname.toLowerCase(), now);
        addActivity(ctx, teamId, memberId, "joined", `${nickname} created the team.`);
      });
      issueSession(reply, memberId);
      const team = getTeam(ctx, teamId)!;
      const member = ctx.db.prepare("SELECT * FROM team_members WHERE id = ?").get(memberId) as MemberRow;
      return { joinCode, state: buildTeamState(ctx, team, member) };
    },
  );

  app.post<{ Body: { code: string; nickname: string; recoveryKey?: string } }>(
    "/api/teams/join",
    {
      schema: {
        body: { type: "object", required: ["code", "nickname"], properties: { code: { type: "string", maxLength: 40 }, nickname: { type: "string" }, recoveryKey: { type: "string", maxLength: 200 } } },
      },
    },
    async (req, reply) => {
      const rl = ctx.limiter.hit(`join:${req.ip}`, JOIN_LIMIT.limit, JOIN_LIMIT.windowMs, ctx.clock.now().getTime());
      if (!rl.ok) return sendError(reply, 429, "rate_limited", "Too many join attempts. Wait a moment and try again.", { retryAfterSeconds: rl.retryAfterSeconds });
      const nickname = cleanName(req.body.nickname, 1, 24);
      if (!nickname) return sendError(reply, 400, "invalid_nickname", "Nicknames need 1–24 characters.");
      const team = ctx.db.prepare("SELECT * FROM teams WHERE join_code_hash = ?").get(codeHash(req.body.code)) as TeamRow | undefined;
      if (!team) return sendError(reply, 404, "bad_code", "No team uses that code. Check it with your teammate.");
      const event = getEvent(ctx);
      const key = nickname.toLowerCase();
      const existing = ctx.db.prepare("SELECT * FROM team_members WHERE team_id = ? AND nickname_key = ?").get(team.id, key) as MemberRow | undefined;
      let memberId: string;
      if (existing) {
        // Recovery proves possession of the member credential; never rotate a live session.
        if (existing.revoked) return sendError(reply, 403, "member_revoked", "This nickname was removed by an organizer.");
        const credential = req.body.recoveryKey || req.cookies[SESSION_COOKIE];
        if (!credential || !existing.session_token_hash || !safeEqual(sha256(credential), existing.session_token_hash)) {
          return sendError(reply, 409, "recovery_required", "That nickname is taken. To recover it, use your private recovery key from the team lobby. Otherwise choose a new nickname or ask an organizer.");
        }
        reply.header("Clear-Site-Data", '"cache"');
        setSessionCookie(ctx, reply, SESSION_COOKIE, credential);
        return { state: buildTeamState(ctx, getTeam(ctx, team.id)!, existing) };
      } else {
        if (!event.registration_open) return sendError(reply, 403, "registration_closed", "Registration is closed to new members.");
        if (membersOf(ctx, team.id).length >= event.max_team_size) {
          return sendError(reply, 409, "team_full", `This team already has ${event.max_team_size} investigators.`);
        }
        memberId = newId("mem");
        tx(ctx.db, () => {
          ctx.db
            .prepare("INSERT INTO team_members (id, team_id, nickname, nickname_key, role, joined_at) VALUES (?, ?, ?, ?, 'member', ?)")
            .run(memberId, team.id, nickname, key, iso(ctx.clock.now()));
          addActivity(ctx, team.id, memberId, "joined", `${nickname} joined the team.`);
        });
      }
      issueSession(reply, memberId);
      const member = ctx.db.prepare("SELECT * FROM team_members WHERE id = ?").get(memberId) as MemberRow;
      return { state: buildTeamState(ctx, getTeam(ctx, team.id)!, member) };
    },
  );

  app.get("/api/me/team-state", { preHandler: auth }, async (req) => buildTeamState(ctx, req.team!, req.member!));

  // The existing bearer credential doubles as a private recovery key. Only expose it on
  // explicit authenticated request, never in shared team state, invitations or URLs.
  app.get("/api/me/recovery-key", { preHandler: auth }, async (req) => ({ recoveryKey: req.cookies[SESSION_COOKIE]! }));

  app.get("/api/clock", { preHandler: auth }, async (req) => clockState(ctx, req.team!));

  app.post<{ Body: { ready: boolean } }>(
    "/api/me/ready",
    { preHandler: auth, schema: { body: { type: "object", required: ["ready"], properties: { ready: { type: "boolean" } } } } },
    async (req) => {
      ctx.db.prepare("UPDATE team_members SET ready = ? WHERE id = ?").run(req.body.ready ? 1 : 0, req.member!.id);
      return buildTeamState(ctx, req.team!, { ...req.member!, ready: req.body.ready ? 1 : 0 });
    },
  );

  app.post("/api/me/logout", { preHandler: auth }, async (req, reply) => {
    ctx.db.prepare("UPDATE team_members SET session_token_hash = NULL WHERE id = ?").run(req.member!.id);
    reply.header("Clear-Site-Data", '"cache"');
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

  /** Idempotently starts the team's clock on server time (the event's duration, 75 minutes by default). Later calls never reset it. */
  app.post("/api/case/start", { preHandler: auth }, async (req, reply) => {
    const team = req.team!;
    if (team.case_status !== "NOT_STARTED") return buildTeamState(ctx, team, req.member!);
    const event = getEvent(ctx);
    if (!event.start_open) return sendError(reply, 403, "start_closed", "The organizers haven't opened the investigation yet.");
    if (event.paused_at) return sendError(reply, 403, "paused", "The event is paused by the organizers.");
    const memberCount = membersOf(ctx, team.id).length;
    if (memberCount < event.min_team_size) {
      return sendError(reply, 409, "team_too_small", `Your team needs at least ${event.min_team_size} investigators to begin.`);
    }
    const now = ctx.clock.now();
    const deadline = new Date(now.getTime() + event.duration_seconds * 1000);
    tx(ctx.db, () => {
      const res = ctx.db
        .prepare("UPDATE teams SET started_at = ?, deadline_at = ?, case_status = 'ACTIVE' WHERE id = ? AND case_status = 'NOT_STARTED'")
        .run(iso(now), iso(deadline), team.id);
      if (res.changes) addActivity(ctx, team.id, req.member!.id, "started", `${req.member!.nickname} began the investigation. The clock is running.`);
    });
    return buildTeamState(ctx, getTeam(ctx, team.id)!, req.member!);
  });
}
