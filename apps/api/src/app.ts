import { existsSync } from "node:fs";
import path from "node:path";
import cookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import type { Clock } from "./clock.js";
import type { Config } from "./config.js";
import type { CaseContent } from "./content.js";
import type { Db } from "./db.js";
import { registerAdminRoutes } from "./routes/admin.js";
import { registerCaseRoutes } from "./routes/case.js";
import { registerNotesRoutes } from "./routes/notes.js";
import { registerPracticeRoutes } from "./routes/practice.js";
import { registerPublicRoutes } from "./routes/public.js";
import { registerTeamRoutes } from "./routes/team.js";
import { ADMIN_COOKIE, RateLimiter, SESSION_COOKIE, SESSION_TTL_SECONDS, sha256 } from "./security.js";
import { type AppContext, type MemberRow, type TeamRow, ensureEvent, getTeam, iso, refreshTeam } from "./state.js";

declare module "fastify" {
  interface FastifyRequest {
    member?: MemberRow;
    team?: TeamRow;
  }
}

export type BuildOptions = { db: Db; clock: Clock; config: Config; content: CaseContent; logger?: boolean };

export function sendError(reply: FastifyReply, status: number, error: string, message: string, extra: Record<string, unknown> = {}) {
  return reply.code(status).send({ error, message, ...extra });
}

export function setSessionCookie(ctx: AppContext, reply: FastifyReply, name: string, token: string) {
  reply.setCookie(name, token, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: ctx.config.production,
    maxAge: SESSION_TTL_SECONDS,
  });
}

/** preHandler: resolves the team member from the session cookie and applies timer expiry. */
export function teamAuth(ctx: AppContext) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (!token) return sendError(reply, 401, "no_session", "Join or create a team first.");
    const member = ctx.db
      .prepare("SELECT * FROM team_members WHERE session_token_hash = ? AND revoked = 0")
      .get(sha256(token)) as MemberRow | undefined;
    if (!member) return sendError(reply, 401, "no_session", "Your team session has ended. Rejoin with your team code.");
    const now = ctx.clock.now();
    if (!member.last_seen_at || now.getTime() - Date.parse(member.last_seen_at) > 5000) {
      ctx.db.prepare("UPDATE team_members SET last_seen_at = ? WHERE id = ?").run(iso(now), member.id);
      member.last_seen_at = iso(now);
    }
    const team = getTeam(ctx, member.team_id);
    if (!team) return sendError(reply, 401, "no_session", "Team not found.");
    req.member = member;
    req.team = refreshTeam(ctx, team);
  };
}

export function adminAuth(ctx: AppContext) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const token = req.cookies[ADMIN_COOKIE];
    if (!token) return sendError(reply, 401, "admin_required", "Organizer sign-in required.");
    const row = ctx.db.prepare("SELECT expires_at FROM admin_sessions WHERE token_hash = ?").get(sha256(token)) as { expires_at: string } | undefined;
    if (!row || Date.parse(row.expires_at) < ctx.clock.now().getTime()) {
      return sendError(reply, 401, "admin_required", "Organizer sign-in required.");
    }
  };
}

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Content-Security-Policy":
    "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};

export async function buildApp(opts: BuildOptions): Promise<FastifyInstance> {
  const ctx: AppContext = { db: opts.db, clock: opts.clock, config: opts.config, content: opts.content, limiter: new RateLimiter() };
  ensureEvent(ctx);

  const app = Fastify({
    logger: opts.logger ? { level: "info" } : false,
    bodyLimit: 64 * 1024,
    trustProxy: opts.config.trustProxy,
  });
  // Only JSON bodies are accepted. Dropping the text/plain parser closes the "simple request" CSRF route.
  app.removeContentTypeParser("text/plain");
  await app.register(cookie);

  app.addHook("onRequest", async (req, reply) => {
    if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method) && req.url.startsWith("/api/")) {
      const origin = req.headers.origin;
      if (origin) {
        let originHost = "";
        try {
          originHost = new URL(origin).host;
        } catch {
          /* invalid origin → rejected below */
        }
        if (originHost !== req.host) return sendError(reply, 403, "bad_origin", "Cross-site request rejected.");
      }
    }
  });
  app.addHook("onSend", async (req, reply, payload) => {
    // Routes may set a stricter (or file-specific) header first; only fill in what's missing.
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) if (!reply.hasHeader(k)) reply.header(k, v);
    if (req.url.startsWith("/api/") && !reply.getHeader("cache-control")) reply.header("Cache-Control", "no-store");
    if (String(reply.getHeader("content-type") ?? "").includes("text/html")) reply.header("Cache-Control", "no-cache");
    return payload;
  });

  registerPublicRoutes(app, ctx);
  registerTeamRoutes(app, ctx);
  registerCaseRoutes(app, ctx);
  registerNotesRoutes(app, ctx);
  registerPracticeRoutes(app, ctx);
  registerAdminRoutes(app, ctx);

  // Serve the built web client (never the content/ or private/ directories).
  const webDist = opts.config.webDist;
  const indexHtml = path.join(webDist, "index.html");
  if (existsSync(indexHtml)) {
    await app.register(fastifyStatic, { root: webDist, prefix: "/", wildcard: false, index: false });
    app.get("/", (_req, reply) => reply.sendFile("index.html"));
  }
  app.setNotFoundHandler((req, reply) => {
    if (req.method === "GET" && !req.url.startsWith("/api/") && existsSync(indexHtml)) {
      return reply.type("text/html").sendFile("index.html");
    }
    return sendError(reply, 404, "not_found", "Not found.");
  });

  return app;
}
