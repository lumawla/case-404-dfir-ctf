import type { FastifyInstance } from "fastify";
import { isWellFormedFlag, normalizeFlag, type FileListing, type PracticeResult, type PracticeTask } from "@case404/shared";
import { sendError, teamAuth } from "../app.js";
import type { AppContext } from "../state.js";

/** The lobby's practice room: a small folder and four warm-up tasks. Unscored and open before the clock starts. */
export function registerPracticeRoutes(app: FastifyInstance, ctx: AppContext) {
  const auth = teamAuth(ctx);
  const training = ctx.content.training;

  app.get("/api/practice/fs", { preHandler: auth }, async (): Promise<FileListing> => ({
    root: training.root,
    files: [...training.files.values()].map((f) => ({ path: f.path, size: f.bytes.length, modified: f.modified, mime: f.mime })),
    revision: "practice",
  }));

  app.get<{ Querystring: { path?: string; download?: string } }>("/api/practice/fs/raw", { preHandler: auth }, async (req, reply) => {
    const file = training.files.get(req.query.path ?? "");
    if (!file) return sendError(reply, 404, "no_such_file", "No such file.");
    reply.header("Content-Type", file.mime);
    reply.header("Cache-Control", "no-store");
    reply.header("Content-Disposition", `${req.query.download ? "attachment" : "inline"}; filename="${file.path.split("/").pop()}"`);
    return reply.send(file.bytes);
  });

  app.get("/api/practice/tasks", { preHandler: auth }, async (): Promise<PracticeTask[]> => training.tasks);

  app.post<{ Params: { id: string }; Body: { answer: string } }>(
    "/api/practice/tasks/:id/submit",
    { preHandler: auth, schema: { body: { type: "object", required: ["answer"], properties: { answer: { type: "string", maxLength: 200 } } } } },
    async (req, reply): Promise<PracticeResult | void> => {
      const expected = ctx.content.answers.practice[req.params.id];
      if (!expected || !training.tasks.some((t) => t.id === req.params.id)) return sendError(reply, 404, "unknown_task", "Unknown task.");
      const rl = ctx.limiter.hit(`practice:${req.member!.id}`, 30, 60_000, ctx.clock.now().getTime());
      if (!rl.ok) return { status: "rate_limited", message: `Slow down. Try again in ${rl.retryAfterSeconds} s.` };
      const normalized = normalizeFlag(req.body.answer);
      if (!isWellFormedFlag(normalized)) return { status: "format_error", message: "Flags look like FLAG{...}: capitals, digits and underscores inside the braces." };
      return normalized === expected ? { status: "correct", message: "Correct. That's how it's done." } : { status: "incorrect", message: "Not quite." };
    },
  );
}
