import type { FastifyInstance, FastifyReply } from "fastify";
import {
  ACCOMPLICE_BONUS,
  CHALLENGE_ACT,
  CHALLENGE_IDS,
  CHALLENGE_POINTS,
  FIRST_WRONG_VERDICT_PENALTY,
  VERDICT_ATTEMPTS,
  isWellFormedFlag,
  normalizeFlag,
  type AccusationOptions,
  type AccusationResult,
  type CaseFile,
  type ChallengeId,
  type ChallengeView,
  type FileListing,
  type FlagResult,
  type FlagResultStatus,
  type ResultView,
  type SuspectId,
  type TeamCaseStatus,
  type TimelineEntry,
} from "@case404/shared";
import { sendError, teamAuth } from "../app.js";
import { tx } from "../db.js";
import { keyedHash } from "../security.js";
import {
  type AppContext,
  type TeamRow,
  addActivity,
  advanceActs,
  currentAct,
  fileVisible,
  getEvent,
  getTeam,
  iso,
  isRevealed,
  scoreFor,
  solvedIds,
  verdictAttempts,
  visibleFiles,
} from "../state.js";

const WRONG_FLAG_LIMIT = 6; // wrong answers per challenge per minute

const isChallengeId = (id: string): id is ChallengeId => (CHALLENGE_IDS as string[]).includes(id);

/** Accepts "~/case404/x", "/home/investigator/case404/x", "case404/x" or "x" and returns "x". */
export function casePath(input: string, root: string): string {
  return input
    .trim()
    .replace(/^\/home\/investigator\//, "")
    .replace(/^~\//, "")
    .replace(/^\.\//, "")
    .replace(new RegExp(`^${root}/`), "");
}

/** True when the cited files cover every group of the rule, each group by a different file. */
export function coversGroups(files: string[], groups: Record<string, string[]>): boolean {
  const lists = Object.values(groups);
  const assign = (i: number, used: Set<string>): boolean => {
    if (i === lists.length) return true;
    return lists[i].some((f) => files.includes(f) && !used.has(f) && assign(i + 1, new Set(used).add(f)));
  };
  return assign(0, new Set());
}

export function registerCaseRoutes(app: FastifyInstance, ctx: AppContext) {
  const auth = teamAuth(ctx);
  const content = ctx.content;

  const requireStarted = (team: TeamRow, reply: FastifyReply) => {
    if (team.case_status === "NOT_STARTED") {
      sendError(reply, 409, "not_started", "Begin the investigation to open the case.");
      return false;
    }
    return true;
  };

  /** Shared gate for scored actions: started, not closed, not paused, inside the server deadline. */
  const closedReason = (team: TeamRow): { status: FlagResultStatus; message: string } | null => {
    if (team.case_status === "NOT_STARTED") return { status: "not_started", message: "Begin the investigation first." };
    if (team.case_status === "TIME_EXPIRED") return { status: "time_expired", message: "Time is up. Submissions are closed; the files stay readable." };
    if (team.case_status !== "ACTIVE") return { status: "case_closed", message: "Your case is closed." };
    if (getEvent(ctx).paused_at) return { status: "paused", message: "The organizers have paused the event. Your clock is frozen." };
    if (team.deadline_at && ctx.clock.now().getTime() > Date.parse(team.deadline_at)) return { status: "time_expired", message: "Time is up. Submissions are closed." };
    return null;
  };

  app.get("/api/case/file", { preHandler: auth }, async (req, reply): Promise<CaseFile | void> => {
    if (!requireStarted(req.team!, reply)) return;
    const { $comment: _c, ...caseFile } = content.caseFile;
    return caseFile;
  });

  app.get("/api/case/challenges", { preHandler: auth }, async (req, reply): Promise<ChallengeView[] | void> => {
    const team = req.team!;
    if (!requireStarted(team, reply)) return;
    const mine = new Map(
      (ctx.db.prepare("SELECT s.challenge_id, s.solved_at, m.nickname FROM team_solved s LEFT JOIN team_members m ON m.id = s.member_id WHERE s.team_id = ?").all(team.id) as {
        challenge_id: string;
        solved_at: string;
        nickname: string | null;
      }[]).map((r) => [r.challenge_id, r]),
    );
    const stats = new Map(
      (ctx.db
        .prepare(
          `SELECT s.challenge_id, COUNT(*) AS solves,
             (SELECT t.name FROM team_solved f JOIN teams t ON t.id = f.team_id WHERE f.challenge_id = s.challenge_id ORDER BY f.solved_at, f.rowid LIMIT 1) AS first_blood
           FROM team_solved s GROUP BY s.challenge_id`,
        )
        .all() as { challenge_id: string; solves: number; first_blood: string | null }[]).map((r) => [r.challenge_id, r]),
    );
    const act = currentAct(team);
    return CHALLENGE_IDS.map((id) => {
      const c = content.challenges.get(id)!;
      const own = mine.get(id);
      const locked = CHALLENGE_ACT[id] > act;
      return {
        id,
        act: CHALLENGE_ACT[id],
        locked,
        title: locked ? null : c.title,
        category: c.category,
        difficulty: c.difficulty,
        points: CHALLENGE_POINTS[id],
        description: locked ? null : c.description,
        format: locked ? null : c.format,
        solved: !!own,
        solvedAt: own?.solved_at ?? null,
        solvedBy: own?.nickname ?? null,
        solves: stats.get(id)?.solves ?? 0,
        firstBlood: stats.get(id)?.first_blood ?? null,
      };
    });
  });

  /** A file the team can see, or undefined. Sealed files answer exactly like missing ones. */
  const visibleFile = (team: TeamRow, p: string) => {
    const file = content.files.get(p);
    return file && fileVisible(file, currentAct(team), new Set(solvedIds(ctx, team.id))) ? file : undefined;
  };

  app.get("/api/case/fs", { preHandler: auth }, async (req, reply): Promise<FileListing | void> => {
    const team = req.team!;
    if (!requireStarted(team, reply)) return;
    const files = visibleFiles(ctx, team);
    return {
      root: content.root,
      files: files.map((f) => ({ path: f.path, size: f.bytes.length, modified: f.modified, mime: f.mime })),
      revision: `${currentAct(team)}.${files.length}`,
    };
  });

  app.get<{ Querystring: { path?: string; download?: string } }>("/api/case/fs/raw", { preHandler: auth }, async (req, reply) => {
    if (!requireStarted(req.team!, reply)) return;
    const file = visibleFile(req.team!, req.query.path ?? "");
    if (!file) return sendError(reply, 404, "no_such_file", "No such file.");
    const name = file.path.split("/").pop()!;
    reply.header("Content-Type", file.mime);
    reply.header("Cache-Control", "no-store");
    reply.header("Content-Disposition", `${req.query.download ? "attachment" : "inline"}; filename="${name}"`);
    if (file.mime === "image/svg+xml") reply.header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    // The browser's built-in PDF viewer is a plugin, so the document needs object-src for itself.
    if (file.mime === "application/pdf") reply.header("Content-Security-Policy", "default-src 'none'; object-src 'self'; frame-ancestors 'none'");
    return reply.send(file.bytes);
  });

  /** pdftotext for the terminal: the text layer of a document, prepared at content-authoring time. */
  app.get<{ Querystring: { path?: string } }>("/api/case/fs/text", { preHandler: auth }, async (req, reply) => {
    if (!requireStarted(req.team!, reply)) return;
    const file = visibleFile(req.team!, req.query.path ?? "");
    if (!file) return sendError(reply, 404, "no_such_file", "No such file.");
    if (file.text === null) return sendError(reply, 415, "no_text_layer", "Not a PDF document.");
    reply.header("Content-Type", "text/plain; charset=utf-8");
    reply.header("Cache-Control", "no-store");
    return file.text;
  });

  app.post<{ Params: { id: string }; Body: { answer: string } }>(
    "/api/case/challenges/:id/submit",
    { preHandler: auth, schema: { body: { type: "object", required: ["answer"], properties: { answer: { type: "string", maxLength: 200 } } } } },
    async (req, reply): Promise<FlagResult | void> => {
      const id = req.params.id;
      if (!isChallengeId(id)) return sendError(reply, 404, "unknown_challenge", "Unknown challenge.");
      const team = getTeam(ctx, req.team!.id)!;
      const result = (status: FlagResultStatus, message: string, extra: Partial<FlagResult> = {}): FlagResult => ({
        status,
        challengeId: id,
        message,
        awardedPoints: 0,
        totalScore: scoreFor(ctx, getTeam(ctx, team.id)!).total,
        firstBlood: false,
        ...extra,
      });
      const closed = closedReason(team);
      if (closed) return result(closed.status, closed.message);
      if (CHALLENGE_ACT[id] > currentAct(team)) return result("locked", "That act isn't open yet.");
      if (solvedIds(ctx, team.id).includes(id)) return result("already_solved", "Already owned by your team.");

      const normalized = normalizeFlag(req.body.answer);
      if (!isWellFormedFlag(normalized)) return result("format_error", "Flags look like FLAG{...}: capitals, digits and underscores inside the braces.");

      const now = ctx.clock.now();
      const recentWrong = ctx.db
        .prepare("SELECT submitted_at FROM submissions WHERE team_id = ? AND challenge_id = ? AND correct = 0 AND submitted_at > ? ORDER BY submitted_at")
        .all(team.id, id, iso(new Date(now.getTime() - 60_000))) as { submitted_at: string }[];
      if (recentWrong.length >= WRONG_FLAG_LIMIT) {
        const retry = Math.max(1, Math.ceil((Date.parse(recentWrong[0].submitted_at) + 60_000 - now.getTime()) / 1000));
        return result("rate_limited", `Too many wrong flags. Try again in ${retry} s.`, { retryAfterSeconds: retry });
      }

      const correct = normalized === content.answers.flags[id];
      const member = req.member!;
      const outcome = tx(ctx.db, () => {
        ctx.db
          .prepare("INSERT INTO submissions (team_id, challenge_id, member_id, submitted_at, correct, normalized_answer_hash) VALUES (?, ?, ?, ?, ?, ?)")
          .run(team.id, id, member.id, iso(now), correct ? 1 : 0, keyedHash(ctx.config.appSecret, `flag:${id}:${normalized}`));
        if (!correct) return { awarded: 0, firstBlood: false, actOpened: null };
        const firstBlood = !ctx.db.prepare("SELECT 1 FROM team_solved WHERE challenge_id = ?").get(id);
        const ins = ctx.db
          .prepare("INSERT OR IGNORE INTO team_solved (team_id, challenge_id, solved_at, awarded_points, member_id) VALUES (?, ?, ?, ?, ?)")
          .run(team.id, id, iso(now), CHALLENGE_POINTS[id], member.id);
        if (!ins.changes) return { awarded: 0, firstBlood: false, actOpened: null };
        const title = content.challenges.get(id)!.title;
        addActivity(ctx, team.id, member.id, "solved", `${member.nickname} owned “${title}” (+${CHALLENGE_POINTS[id]})${firstBlood ? ". First blood!" : "."}`);
        return { awarded: CHALLENGE_POINTS[id], firstBlood, actOpened: advanceActs(ctx, team) };
      });

      if (!correct) return result("incorrect", "Incorrect flag.");
      return outcome.awarded
        ? result("correct", `Correct flag. +${outcome.awarded} points.`, {
            awardedPoints: outcome.awarded,
            firstBlood: outcome.firstBlood,
            ...(outcome.actOpened ? { actOpened: outcome.actOpened } : {}),
          })
        : result("already_solved", "Already owned by your team.");
    },
  );

  /** The case timeline: what was known at 00:41, plus what each owned challenge established. */
  app.get("/api/case/timeline", { preHandler: auth }, async (req, reply): Promise<TimelineEntry[] | void> => {
    const team = req.team!;
    if (!requireStarted(team, reply)) return;
    const solved = solvedIds(ctx, team.id);
    const entries = [
      ...content.timeline.baseline.map((e) => ({ ...e, source: null })),
      ...solved.flatMap((id) => (content.timeline.solved[id] ?? []).map((e) => ({ ...e, source: id }))),
    ];
    const replaced = new Set(entries.flatMap((e) => (e.replaces ? [e.replaces] : [])));
    return entries
      .map(({ replaces: _r, ...e }) => ({ ...e, struck: replaced.has(e.id) }))
      .sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || (a.struck === b.struck ? 0 : a.struck ? -1 : 1));
  });

  const accusationOptions = (team: TeamRow): AccusationOptions => {
    const attempts = verdictAttempts(ctx, team.id);
    return {
      open: currentAct(team) === 3,
      attemptsUsed: attempts.length,
      attemptsMax: VERDICT_ATTEMPTS,
      maxFiles: content.verdict.maxFiles,
      suspects: content.verdict.suspects,
      motives: content.verdict.motives,
      accompliceBonus: ACCOMPLICE_BONUS,
      previous: attempts.map((a) => ({
        attemptNo: a.attempt_no,
        suspectId: a.suspect_id,
        motiveId: a.motive_id,
        accompliceId: a.accomplice_id,
        files: JSON.parse(a.files),
        correct: !!a.correct,
        at: a.submitted_at,
      })),
    };
  };

  app.get("/api/case/accusation", { preHandler: auth }, async (req, reply) => {
    if (!requireStarted(req.team!, reply)) return;
    return accusationOptions(req.team!);
  });

  app.post<{ Body: { suspectId: string; motiveId: string; accompliceId?: string | null; files: string[]; expectedAttempt: number } }>(
    "/api/case/accusation",
    {
      preHandler: auth,
      schema: {
        body: {
          type: "object",
          required: ["suspectId", "motiveId", "files", "expectedAttempt"],
          properties: {
            expectedAttempt: { type: "integer", minimum: 1, maximum: 2 },
            suspectId: { type: "string", maxLength: 40 },
            motiveId: { type: "string", maxLength: 40 },
            accompliceId: { type: ["string", "null"], maxLength: 40 },
            files: { type: "array", items: { type: "string", maxLength: 300 }, maxItems: 10 },
          },
        },
      },
    },
    async (req, reply): Promise<AccusationResult | void> => {
      const team = getTeam(ctx, req.team!.id)!;
      const closed = closedReason(team);
      if (closed) return sendError(reply, 409, closed.status, closed.message);
      const options = accusationOptions(team);
      if (!options.open) return sendError(reply, 409, "accusation_locked", "Accusations open with the final act.");
      if (options.attemptsUsed >= VERDICT_ATTEMPTS) return sendError(reply, 409, "no_attempts", "Your team has used both accusations.");
      if (req.body.expectedAttempt !== options.attemptsUsed + 1) return sendError(reply, 409, "stale_attempt", "An accusation was already filed. Review previous accusations before trying again.");
      const suspectId = req.body.suspectId as SuspectId;
      if (!options.suspects.some((s) => s.id === suspectId)) return sendError(reply, 400, "invalid_suspect", "Choose one of the suspects.");
      if (!options.motives.some((m) => m.id === req.body.motiveId)) return sendError(reply, 400, "invalid_motive", "Choose a motive.");
      const accompliceId = (req.body.accompliceId || null) as SuspectId | null;
      if (accompliceId && (!options.suspects.some((s) => s.id === accompliceId) || accompliceId === suspectId)) {
        return sendError(reply, 400, "invalid_accomplice", "Choose someone other than the accused, or no one.");
      }
      const files = [...new Set(req.body.files.map((f) => casePath(f, content.root)))];
      if (files.length === 0 || files.length > options.maxFiles) return sendError(reply, 400, "invalid_files", `Cite between 1 and ${options.maxFiles} files.`);
      const unknown = files.filter((f) => !visibleFile(team, f));
      if (unknown.length) return sendError(reply, 400, "no_such_file", `No such file: ${unknown.join(", ")}`, { unknown });

      const rule = content.answers.verdict;
      const correct = suspectId === rule.suspect && req.body.motiveId === rule.motive && coversGroups(files, rule.groups);
      const bonus = correct && accompliceId === rule.accomplice ? ACCOMPLICE_BONUS : 0;
      const attemptNo = options.attemptsUsed + 1;
      const isFinal = !correct && attemptNo >= VERDICT_ATTEMPTS;
      const penalty = !correct && attemptNo === 1 ? FIRST_WRONG_VERDICT_PENALTY : 0;
      const member = req.member!;
      const now = iso(ctx.clock.now());
      tx(ctx.db, () => {
        ctx.db
          .prepare(
            "INSERT INTO verdict_attempts (team_id, attempt_no, suspect_id, motive_id, accomplice_id, files, member_id, submitted_at, correct, penalty, bonus) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          )
          .run(team.id, attemptNo, suspectId, req.body.motiveId, accompliceId, JSON.stringify(files), member.id, now, correct ? 1 : 0, penalty, bonus);
        if (correct) {
          ctx.db.prepare("UPDATE teams SET case_status = 'SOLVED', completed_at = ?, ending = ? WHERE id = ?").run(now, bonus ? "solved_accomplice" : "solved", team.id);
          addActivity(ctx, team.id, member.id, "verdict", `${member.nickname} filed the accusation. Case closed${bonus ? `, accomplice named (+${bonus})` : ""}.`);
        } else if (isFinal) {
          ctx.db.prepare("UPDATE teams SET case_status = 'WRONG_VERDICT', completed_at = ?, ending = ? WHERE id = ?").run(now, `wrong_${suspectId}`, team.id);
          addActivity(ctx, team.id, member.id, "verdict", `${member.nickname} filed the final accusation. It didn't hold.`);
        } else {
          addActivity(ctx, team.id, member.id, "verdict", `${member.nickname} filed an accusation. It didn't hold (−${penalty}). One attempt left.`);
        }
      });
      const m = content.verdict.messages;
      return {
        status: correct ? "correct" : isFinal ? "final_incorrect" : "incorrect",
        message: correct ? m.correct : isFinal ? m.finalIncorrect : m.incorrect,
        penalty,
        bonus,
        attemptsUsed: attemptNo,
        totalScore: scoreFor(ctx, getTeam(ctx, team.id)!).total,
      };
    },
  );

  app.get("/api/case/result", { preHandler: auth }, async (req): Promise<ResultView> => {
    const team = req.team!;
    const revealed = isRevealed(getEvent(ctx), ctx.clock.now());
    const status: TeamCaseStatus = team.case_status;
    const endings = content.verdict.endings;
    const ending =
      status === "SOLVED"
        ? (endings[team.ending ?? ""] ?? endings.solved)
        : status === "WRONG_VERDICT"
          ? (endings[team.ending ?? ""] ?? endings.wrong_yasmine)
          : status === "TIME_EXPIRED"
            ? endings.expired
            : endings.active;
    const done = status === "SOLVED" || status === "WRONG_VERDICT" || status === "TIME_EXPIRED";
    const end = done ? team.completed_at : iso(ctx.clock.now());
    return {
      status,
      teamName: team.name,
      score: scoreFor(ctx, team),
      elapsedSeconds: team.started_at && end ? Math.round((Date.parse(end) - Date.parse(team.started_at)) / 1000) : null,
      solvedIds: solvedIds(ctx, team.id),
      wrongAttempts: verdictAttempts(ctx, team.id).filter((a) => !a.correct).length,
      accompliceNamed: status === "SOLVED" ? verdictAttempts(ctx, team.id).some((a) => a.correct && a.bonus > 0) : null,
      ending,
      reconstruction:
        status === "SOLVED" || (revealed && done)
          ? {
              text: content.verdict.reconstruction.text,
              stinger: content.verdict.reconstruction.stinger,
              answers: revealed ? CHALLENGE_IDS.map((id) => ({ challengeId: id, title: content.challenges.get(id)!.title, flag: content.answers.flags[id] })) : [],
            }
          : null,
      revealPending: !revealed,
    };
  });
}
