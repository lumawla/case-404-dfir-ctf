import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../apps/api/src/app";
import { manualClock } from "../../apps/api/src/clock";
import { loadConfig } from "../../apps/api/src/config";
import { loadContent } from "../../apps/api/src/content";
import { openDb } from "../../apps/api/src/db";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const content = loadContent(path.join(root, "content"), path.join(root, "private/organizer/answers.json"));
const FLAGS = content.answers.flags;
const ADMIN_TOKEN = "test-admin-token-123456";

type Ctx = { app: FastifyInstance; clock: ReturnType<typeof manualClock> };

async function setup(): Promise<Ctx> {
  const clock = manualClock("2026-11-05T16:30:00Z");
  const config = { ...loadConfig({}), adminToken: ADMIN_TOKEN, appSecret: "test-secret-abcdef", webDist: "/nonexistent", databasePath: ":memory:" };
  const app = await buildApp({ db: openDb(":memory:"), clock, config, content });
  await app.inject({ method: "POST", url: "/api/admin/login", payload: { token: ADMIN_TOKEN } }).then(async (r) => {
    await app.inject({ method: "PUT", url: "/api/admin/event", cookies: { c404_admin: r.cookies[0].value }, payload: { startOpen: true } });
  });
  return { app, clock };
}

async function call(ctx: Ctx, method: string, url: string, opts: { sid?: string; admin?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const cookies: Record<string, string> = {};
  if (opts.sid) cookies.c404_sid = opts.sid;
  if (opts.admin) cookies.c404_admin = opts.admin;
  const res = await ctx.app.inject({
    method: method as "GET",
    url,
    cookies,
    headers: { ...(opts.body !== undefined ? { "content-type": "application/json" } : {}), ...opts.headers },
    payload: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  let json: any = null;
  try {
    json = res.json();
  } catch {
    json = null;
  }
  const setCookie = res.cookies.find((c) => c.name === "c404_sid" || c.name === "c404_admin");
  return { status: res.statusCode, json, body: res.body, cookie: setCookie?.value, headers: res.headers };
}

async function adminLogin(ctx: Ctx) {
  const r = await call(ctx, "POST", "/api/admin/login", { body: { token: ADMIN_TOKEN } });
  expect(r.status).toBe(200);
  return r.cookie!;
}

async function makeTeam(ctx: Ctx, name = "Night Owls", members = 2) {
  const created = await call(ctx, "POST", "/api/teams", { body: { teamName: name, nickname: "ana" } });
  expect(created.status).toBe(200);
  const sids = [created.cookie!];
  for (let i = 1; i < members; i++) {
    const joined = await call(ctx, "POST", "/api/teams/join", { body: { code: created.json.joinCode, nickname: `mate${i}` } });
    expect(joined.status).toBe(200);
    sids.push(joined.cookie!);
  }
  return { sids, code: created.json.joinCode as string, teamId: created.json.state.team.id as string };
}

const submit = (ctx: Ctx, sid: string, id: string, answer: string) => call(ctx, "POST", `/api/case/challenges/${id}/submit`, { sid, body: { answer } });
const accuse = async (ctx: Ctx, sid: string, suspectId: string, motiveId: string, files: string[], accompliceId: string | null = null) =>
  call(ctx, "POST", "/api/case/accusation", { sid, body: { suspectId, motiveId, accompliceId, files, expectedAttempt: (await call(ctx, "GET", "/api/case/accusation", { sid })).json.attemptsUsed + 1 } });

async function startedTeam(ctx: Ctx, name?: string) {
  const t = await makeTeam(ctx, name);
  expect((await call(ctx, "POST", "/api/case/start", { sid: t.sids[0], body: {} })).status).toBe(200);
  return t;
}

const solve = async (ctx: Ctx, sid: string, ids: (keyof typeof FLAGS)[]) => {
  for (const id of ids) expect((await submit(ctx, sid, id, FLAGS[id])).json.status, id).toBe("correct");
};
const ALL = ["EV01", "EV02", "EV03", "EV04", "EV05", "EV06", "EV07", "EV08"] as const;
/** Both Act I flags and two Act II flags: Act III is open. */
const toAct3 = (ctx: Ctx, sid: string) => solve(ctx, sid, ["EV01", "EV02", "EV03", "EV05"]);
const paths = async (ctx: Ctx, sid: string): Promise<string[]> => (await call(ctx, "GET", "/api/case/fs", { sid })).json.files.map((f: { path: string }) => f.path);

let ctx: Ctx;
beforeEach(async () => {
  ctx = await setup();
});

describe("teams and the authoritative timer", () => {
  it("creates a team with an unguessable code and lets teammates join", async () => {
    const t = await makeTeam(ctx);
    expect(t.code).toMatch(/^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/);
    const state = await call(ctx, "GET", "/api/me/team-state", { sid: t.sids[1] });
    expect(state.json.members.map((m: { nickname: string }) => m.nickname)).toEqual(["ana", "mate1"]);
    expect(state.json.team.status).toBe("NOT_STARTED");
    expect((await call(ctx, "GET", "/api/case/fs", { sid: t.sids[0] })).json.error).toBe("not_started");
    expect((await call(ctx, "GET", "/api/case/challenges", { sid: t.sids[0] })).json.error).toBe("not_started");
  });

  it("rejects bad codes and full teams", async () => {
    expect((await call(ctx, "POST", "/api/teams/join", { body: { code: "AAAA-AAAA-AAAA", nickname: "x" } })).status).toBe(404);
    const t = await makeTeam(ctx, "Full", 3);
    const res = await call(ctx, "POST", "/api/teams/join", { body: { code: t.code, nickname: "fourth" } });
    expect(res.status).toBe(409);
    // Recovery requires the private member credential even when the team is full
    const reclaim = await call(ctx, "POST", "/api/teams/join", { body: { code: t.code, nickname: "MATE1", recoveryKey: t.sids[1] } });
    expect(reclaim.status).toBe(200);
    expect(reclaim.json.state.members).toHaveLength(3);
  });

  it("starts the 75-minute clock only on Begin Investigation, once, for the whole team", async () => {
    const solo = await makeTeam(ctx, "Solo", 1);
    expect((await call(ctx, "POST", "/api/case/start", { sid: solo.sids[0], body: {} })).json.error).toBe("team_too_small");

    const t = await makeTeam(ctx);
    ctx.clock.advance(5 * 60_000); // time in the lobby is free
    const first = await call(ctx, "POST", "/api/case/start", { sid: t.sids[0], body: {} });
    expect(first.json.team.status).toBe("ACTIVE");
    expect(Date.parse(first.json.team.deadlineAt) - Date.parse(first.json.team.startedAt)).toBe(75 * 60_000);
    expect(first.json.acts.current).toBe(1);
    ctx.clock.advance(10 * 60_000);
    const second = await call(ctx, "POST", "/api/case/start", { sid: t.sids[1], body: {} });
    expect(second.json.team.startedAt).toBe(first.json.team.startedAt);
    expect(second.json.team.deadlineAt).toBe(first.json.team.deadlineAt);
  });

  it("expires on the server clock and keeps the files readable afterwards", async () => {
    const t = await startedTeam(ctx);
    ctx.clock.advance(75 * 60_000 + 1000);
    expect((await submit(ctx, t.sids[0], "EV01", FLAGS.EV01)).json.status).toBe("time_expired");
    const state = await call(ctx, "GET", "/api/me/team-state", { sid: t.sids[0] });
    expect(state.json.team.status).toBe("TIME_EXPIRED");
    expect((await call(ctx, "GET", "/api/case/fs/raw?path=maskmail/archive_export.txt", { sid: t.sids[0] })).status).toBe(200);
  });
});

describe("acts", () => {
  it("opens Act I only: two challenges, the Act I files, Acts II and III sealed without titles", async () => {
    const t = await startedTeam(ctx);
    const state = (await call(ctx, "GET", "/api/me/team-state", { sid: t.sids[0] })).json;
    expect(state.acts.current).toBe(1);
    expect(state.acts.list.map((a: { n: number; open: boolean; title: string | null }) => [a.n, a.open, a.title])).toEqual([
      [1, true, "The Meeting"],
      [2, false, null],
      [3, false, null],
    ]);
    expect(state.acts.list[1]).toMatchObject({ intro: null, unlock: "Opens when both Act I challenges are owned" });
    const list = (await call(ctx, "GET", "/api/case/challenges", { sid: t.sids[0] })).json;
    expect(list.filter((c: { locked: boolean }) => !c.locked).map((c: { id: string }) => c.id)).toEqual(["EV01", "EV02"]);
    expect(list.find((c: { id: string }) => c.id === "EV06")).toMatchObject({ act: 3, locked: true, title: null, description: null, format: null, points: 20 });
    const files = await paths(ctx, t.sids[0]);
    expect(files).toContain("staff_channel/attachments/door_log.csv");
    expect(files.some((p) => /^(photobooth|phones|access_control|finance|network|cctv)\//.test(p))).toBe(false);
  });

  it("answers sealed files and sealed challenges as if they didn't exist", async () => {
    const t = await startedTeam(ctx);
    expect((await call(ctx, "GET", "/api/case/fs/raw?path=photobooth/device.log", { sid: t.sids[0] })).json.error).toBe("no_such_file");
    expect((await call(ctx, "GET", "/api/case/fs/text?path=finance/invoices/BC-104.pdf", { sid: t.sids[0] })).status).toBe(404);
    expect((await submit(ctx, t.sids[0], "EV03", FLAGS.EV03)).json.status).toBe("locked");
    const bodies = (
      await Promise.all(["/api/me/team-state", "/api/case/challenges", "/api/case/fs", "/api/case/timeline"].map((u) => call(ctx, "GET", u, { sid: t.sids[0] })))
    ).map((r) => r.body);
    const all = bodies.join("\n");
    for (const act of content.acts.filter((a) => a.n > 1)) {
      expect(all).not.toContain(act.title);
      expect(all).not.toContain(act.intro);
    }
    for (const c of [...content.challenges.values()].filter((c) => c.act > 1)) {
      expect(all).not.toContain(c.title);
      expect(all).not.toContain(c.description);
    }
  });

  it("opens Act II with both Act I flags and mounts its evidence for every teammate", async () => {
    const t = await startedTeam(ctx);
    expect((await submit(ctx, t.sids[0], "EV01", FLAGS.EV01)).json.actOpened).toBeUndefined();
    const second = await submit(ctx, t.sids[1], "EV02", FLAGS.EV02);
    expect(second.json).toMatchObject({ status: "correct", actOpened: 2 });
    const state = (await call(ctx, "GET", "/api/me/team-state", { sid: t.sids[0] })).json;
    expect(state.acts.current).toBe(2);
    expect(state.acts.list[1]).toMatchObject({ open: true, title: "The Booth" });
    expect(state.acts.list[1].intro).toMatch(/Salma/);
    expect(state.activity[0]).toMatchObject({ kind: "act", text: "Act II: The Booth. New evidence is mounted." });
    const files = await paths(ctx, t.sids[0]);
    expect(files).toContain("photobooth/device.log");
    expect(files).toContain("access_control/exports/ACS-EXP-7731.csv");
    expect(files).not.toContain("interviews/lucien_moreau_2.txt");
    expect(files).not.toContain("phones/salma_nasser/sms.db");
    expect((await call(ctx, "GET", "/api/case/accusation", { sid: t.sids[0] })).json.open).toBe(false);
  });

  it("unlocks Lucien's second interview with EV03 and Act III with any two Act II flags", async () => {
    const t = await startedTeam(ctx);
    await solve(ctx, t.sids[0], ["EV01", "EV02", "EV03"]);
    expect(await paths(ctx, t.sids[0])).toContain("interviews/lucien_moreau_2.txt");
    const res = await submit(ctx, t.sids[0], "EV04", FLAGS.EV04);
    expect(res.json.actOpened).toBe(3);
    const files = await paths(ctx, t.sids[0]);
    expect(files).toContain("phones/salma_nasser/sms.db");
    expect(files).toContain("finance/.backup/ledger_2026-10-30.csv");
    expect(files).not.toContain("interviews/salma_nasser_2.txt");
    await solve(ctx, t.sids[0], ["EV06"]);
    expect(await paths(ctx, t.sids[0])).toContain("interviews/salma_nasser_2.txt");
    expect((await call(ctx, "GET", "/api/case/fs", { sid: t.sids[0] })).json.files).toHaveLength(content.files.size);
  });

  it("builds the timeline from owned challenges, striking the forged door entry once the real one is found", async () => {
    const t = await startedTeam(ctx);
    const base = (await call(ctx, "GET", "/api/case/timeline", { sid: t.sids[0] })).json;
    expect(base.map((e: { id: string }) => e.id)).toEqual(["b-stream", "b-window", "b-forward", "b-found"]);
    await solve(ctx, t.sids[0], ["EV01", "EV02"]);
    let tl = (await call(ctx, "GET", "/api/case/timeline", { sid: t.sids[0] })).json;
    expect(tl.find((e: { id: string }) => e.id === "t-door-l07")).toMatchObject({ source: "EV02", struck: false });
    await solve(ctx, t.sids[0], ["EV05"]);
    tl = (await call(ctx, "GET", "/api/case/timeline", { sid: t.sids[0] })).json;
    expect(tl.find((e: { id: string }) => e.id === "t-door-l07").struck).toBe(true);
    expect(tl.find((e: { id: string }) => e.id === "t-door-a14")).toMatchObject({ source: "EV05", struck: false });
    expect(tl.map((e: { at: string }) => Date.parse(e.at))).toEqual([...tl.map((e: { at: string }) => Date.parse(e.at))].sort((a, b) => a - b));
    expect(JSON.stringify(tl)).not.toContain("replaces");
  });
});

describe("evidence file system", () => {
  it("lists files with in-world names and no descriptions; hidden ones arrive with their act", async () => {
    const t = await startedTeam(ctx);
    await toAct3(ctx, t.sids[0]);
    const fs = (await call(ctx, "GET", "/api/case/fs", { sid: t.sids[0] })).json;
    expect(fs.root).toBe("case404");
    expect(fs.revision).toBe(`3.${fs.files.length}`);
    const list = fs.files.map((f: { path: string }) => f.path);
    expect(list).toContain("finance/.backup/ledger_2026-10-30.csv");
    expect(list.every((p: string) => !/EV0\d|PUB_|REC_/.test(p))).toBe(true);
    expect(Object.keys(fs.files[0]).sort()).toEqual(["mime", "modified", "path", "size"]);
  });

  it("serves exact bytes inline or as a download under the file's own name", async () => {
    const t = await startedTeam(ctx);
    const raw = await call(ctx, "GET", "/api/case/fs/raw?path=staff_channel/attachments/door_log.csv", { sid: t.sids[0] });
    expect(raw.body).toBe(content.files.get("staff_channel/attachments/door_log.csv")!.bytes.toString("utf8"));
    expect(raw.headers["content-disposition"]).toBe('inline; filename="door_log.csv"');
    await toAct3(ctx, t.sids[0]);
    const dl = await call(ctx, "GET", "/api/case/fs/raw?path=finance/invoices/BC-104.pdf&download=1", { sid: t.sids[0] });
    expect(dl.headers["content-type"]).toBe("application/pdf");
    expect(dl.headers["content-disposition"]).toBe('attachment; filename="BC-104.pdf"');
    const db = await call(ctx, "GET", "/api/case/fs/raw?path=phones/salma_nasser/sms.db", { sid: t.sids[0] });
    expect(db.headers["content-type"]).toBe("application/vnd.sqlite3");
  });

  it("refuses unknown and traversal paths, and only PDFs have a text layer", async () => {
    const t = await startedTeam(ctx);
    await toAct3(ctx, t.sids[0]);
    for (const p of ["../../private/organizer/answers.json", "/etc/passwd", "finance", "nope.txt"]) {
      expect((await call(ctx, "GET", `/api/case/fs/raw?path=${encodeURIComponent(p)}`, { sid: t.sids[0] })).status).toBe(404);
    }
    const text = await call(ctx, "GET", "/api/case/fs/text?path=finance/invoices/BC-104.pdf", { sid: t.sids[0] });
    expect(text.body).toContain("INVOICE BC-104");
    expect((await call(ctx, "GET", "/api/case/fs/text?path=incident_report.txt", { sid: t.sids[0] })).status).toBe(415);
  });
});

describe("challenges and flags", () => {
  it("shows all eight challenges with categories, difficulty and points, and no answers", async () => {
    const t = await startedTeam(ctx);
    const list = (await call(ctx, "GET", "/api/case/challenges", { sid: t.sids[0] })).json;
    expect(list.map((c: { id: string }) => c.id)).toEqual([...ALL]);
    expect(list.map((c: { act: number }) => c.act)).toEqual([1, 1, 2, 2, 2, 3, 3, 3]);
    expect(list.reduce((n: number, c: { points: number }) => n + c.points, 0)).toBe(130);
    expect(list[0]).toMatchObject({ title: "Moth", category: "Crypto", difficulty: "Easy", locked: false, solved: false, solves: 0, firstBlood: null });
    expect(Object.keys(list[0]).sort()).toEqual(["act", "category", "description", "difficulty", "firstBlood", "format", "id", "locked", "points", "solved", "solvedAt", "solvedBy", "solves", "title"]);
  });

  it("validates format, gives no near-miss feedback and awards points exactly once", async () => {
    const t = await startedTeam(ctx);
    expect((await submit(ctx, t.sids[0], "EV01", "PROJECTION_ROOM_2350")).json.status).toBe("format_error");
    const near = await submit(ctx, t.sids[0], "EV01", "FLAG{PROJECTION_ROOM_2349}");
    expect(near.json).toMatchObject({ status: "incorrect", message: "Incorrect flag." });
    const ok = await submit(ctx, t.sids[0], "EV01", "  flag{projection_room_2350} ");
    expect(ok.json).toMatchObject({ status: "correct", awardedPoints: 10, totalScore: 10, firstBlood: true });
    const again = await submit(ctx, t.sids[1], "EV01", FLAGS.EV01);
    expect(again.json).toMatchObject({ status: "already_solved", awardedPoints: 0, totalScore: 10 });
  });

  it("awards once under simultaneous correct submissions from two devices, and opens the act once", async () => {
    const t = await startedTeam(ctx);
    await solve(ctx, t.sids[0], ["EV01"]);
    const results = await Promise.all(t.sids.map((sid) => submit(ctx, sid, "EV02", FLAGS.EV02)));
    expect(results.filter((r) => r.json.awardedPoints === 10)).toHaveLength(1);
    const state = (await call(ctx, "GET", "/api/me/team-state", { sid: t.sids[0] })).json;
    expect(state.team.score.total).toBe(20);
    expect(state.activity.filter((a: { kind: string }) => a.kind === "act")).toHaveLength(1);
  });

  it("tracks solves and first blood across teams", async () => {
    const a = await startedTeam(ctx, "Alpha");
    const b = await startedTeam(ctx, "Bravo");
    await solve(ctx, b.sids[0], ["EV01"]);
    const second = await submit(ctx, a.sids[0], "EV01", FLAGS.EV01);
    expect(second.json.firstBlood).toBe(false);
    const ev01 = (await call(ctx, "GET", "/api/case/challenges", { sid: a.sids[0] })).json.find((c: { id: string }) => c.id === "EV01");
    expect(ev01).toMatchObject({ solved: true, solvedBy: "ana", solves: 2, firstBlood: "Bravo" });
    expect((await call(ctx, "GET", "/api/me/team-state", { sid: a.sids[0] })).json.revisions.solves).toBe(2);
  });

  it("rate-limits repeated wrong answers per challenge", async () => {
    const t = await startedTeam(ctx);
    for (let i = 0; i < 6; i++) expect((await submit(ctx, t.sids[0], "EV01", `FLAG{000${i}}`)).json.status).toBe("incorrect");
    expect((await submit(ctx, t.sids[0], "EV01", FLAGS.EV01)).json.status).toBe("rate_limited");
    expect((await submit(ctx, t.sids[0], "EV02", FLAGS.EV02)).json.status).toBe("correct");
    ctx.clock.advance(61_000);
    expect((await submit(ctx, t.sids[0], "EV01", FLAGS.EV01)).json.status).toBe("correct");
  });
});

describe("accusation", () => {
  const RIGHT = ["finance/.backup/ledger_2026-10-30.csv", "access_control/exports/ACS-EXP-7731.csv"];

  it("opens with Act III", async () => {
    const t = await startedTeam(ctx);
    expect((await call(ctx, "GET", "/api/case/accusation", { sid: t.sids[0] })).json).toMatchObject({ open: false, attemptsUsed: 0 });
    expect((await accuse(ctx, t.sids[0], "yasmine", "report", ["maskmail/archive_export.txt"])).json.error).toBe("accusation_locked");
    await toAct3(ctx, t.sids[0]);
    expect((await call(ctx, "GET", "/api/case/accusation", { sid: t.sids[0] })).json.open).toBe(true);
  });

  it("validates suspect, motive, accomplice and cited files without using an attempt", async () => {
    const t = await startedTeam(ctx);
    await toAct3(ctx, t.sids[0]);
    const opts = (await call(ctx, "GET", "/api/case/accusation", { sid: t.sids[0] })).json;
    expect(opts).toMatchObject({ attemptsUsed: 0, attemptsMax: 2, maxFiles: 3, accompliceBonus: 15 });
    expect(opts.suspects.map((s: { id: string }) => s.id)).toEqual(["yasmine", "lucien", "karim", "tara", "salma"]);
    expect(opts.suspects.find((s: { id: string }) => s.id === "lucien").portrait).toBeNull();
    expect(opts.motives.length).toBeGreaterThanOrEqual(5);
    expect((await accuse(ctx, t.sids[0], "nobody", "report", RIGHT)).json.error).toBe("invalid_suspect");
    expect((await accuse(ctx, t.sids[0], "yasmine", "greed", RIGHT)).json.error).toBe("invalid_motive");
    expect((await accuse(ctx, t.sids[0], "yasmine", "report", RIGHT, "yasmine")).json.error).toBe("invalid_accomplice");
    expect((await accuse(ctx, t.sids[0], "yasmine", "report", RIGHT, "ghost")).json.error).toBe("invalid_accomplice");
    expect((await accuse(ctx, t.sids[0], "yasmine", "report", [])).json.error).toBe("invalid_files");
    expect((await accuse(ctx, t.sids[0], "yasmine", "report", ["a.txt", "b.txt", "c.txt", "d.txt"])).json.error).toBe("invalid_files");
    expect((await accuse(ctx, t.sids[0], "yasmine", "report", ["finance/secret.csv"])).json.unknown).toEqual(["finance/secret.csv"]);
    expect((await accuse(ctx, t.sids[0], "yasmine", "report", ["interviews/salma_nasser_2.txt"])).json.unknown).toEqual(["interviews/salma_nasser_2.txt"]);
    expect((await call(ctx, "GET", "/api/case/accusation", { sid: t.sids[0] })).json.attemptsUsed).toBe(0);
  });

  it("penalizes the first wrong accusation without saying why, and closes the case on the second", async () => {
    const t = await startedTeam(ctx);
    await solve(ctx, t.sids[0], ["EV01", "EV02", "EV03", "EV04", "EV05"]);
    const first = await accuse(ctx, t.sids[0], "lucien", "secret", ["staff_channel/attachments/fwd_0003.png", "staff_channel/attachments/door_log.csv"]);
    expect(first.json).toMatchObject({ status: "incorrect", penalty: 10, bonus: 0, attemptsUsed: 1, totalScore: 70 - 10 });
    expect(first.body).not.toMatch(/yasmine|salma|report|motive|suspect|accomplice/i);
    // the right name and motive with files that don't place her at the scene is still unsupported
    const second = await accuse(ctx, t.sids[1], "yasmine", "report", ["finance/.backup/ledger_2026-10-30.csv", "interviews/yasmine_mansour.txt"], "salma");
    expect(second.json).toMatchObject({ status: "final_incorrect", penalty: 0, bonus: 0, attemptsUsed: 2 });
    const result = await call(ctx, "GET", "/api/case/result", { sid: t.sids[0] });
    expect(result.json).toMatchObject({ status: "WRONG_VERDICT", wrongAttempts: 2, reconstruction: null, accompliceNamed: null });
    expect(result.json.ending.title).toBe("Unsupported accusation");
    expect(result.json.score.total).toBe(60);
    expect((await submit(ctx, t.sids[0], "EV06", FLAGS.EV06)).json.status).toBe("case_closed");
  });

  it("accusing Salma, who lied and helped, is still the wrong accusation", async () => {
    const t = await startedTeam(ctx);
    await toAct3(ctx, t.sids[0]);
    await accuse(ctx, t.sids[0], "salma", "report", RIGHT);
    await accuse(ctx, t.sids[0], "salma", "report", RIGHT, "yasmine");
    expect((await call(ctx, "GET", "/api/case/result", { sid: t.sids[0] })).json.ending.title).toBe("Wrong accusation");
  });

  it("needs one file for the money and a different one for the scene", async () => {
    const t = await startedTeam(ctx);
    await toAct3(ctx, t.sids[0]);
    // the dashboard audit counts for either group, but not for both at once
    expect((await accuse(ctx, t.sids[0], "yasmine", "report", ["logs/staff_dashboard_audit.csv"])).json.status).toBe("incorrect");
    const ok = await accuse(ctx, t.sids[0], "yasmine", "report", ["~/case404/logs/staff_dashboard_audit.csv", "/home/investigator/case404/phones/salma_nasser/sms.db"]);
    expect(ok.json).toMatchObject({ status: "correct", bonus: 0 });
    const result = (await call(ctx, "GET", "/api/case/result", { sid: t.sids[0] })).json;
    expect(result).toMatchObject({ accompliceNamed: false });
    expect(result.ending.title).toBe("Case closed");
  });

  it("solves the case: Yasmine, the report to the Dean, money plus scene, and Salma for the bonus", async () => {
    const t = await startedTeam(ctx);
    await solve(ctx, t.sids[0], [...ALL]);
    ctx.clock.advance(52 * 60_000);
    const res = await accuse(ctx, t.sids[0], "yasmine", "report", [...RIGHT, "social/originals/IMG_4471.jpg"], "salma");
    expect(res.json).toMatchObject({ status: "correct", bonus: 15, totalScore: 130 + 40 + 15 });
    const result = await call(ctx, "GET", "/api/case/result", { sid: t.sids[1] });
    expect(result.json).toMatchObject({ status: "SOLVED", elapsedSeconds: 52 * 60, revealPending: true, accompliceNamed: true });
    expect(result.json.score).toMatchObject({ flagPoints: 130, verdictPoints: 40, bonusPoints: 15, penalties: 0, total: 185 });
    expect(result.json.ending.text).toMatch(/Salma/);
    expect(result.json.reconstruction.text).toMatch(/Lucien never hurt anyone/);
    expect(result.json.reconstruction.answers).toEqual([]); // flags only after the organizers' reveal
    expect((await accuse(ctx, t.sids[0], "yasmine", "report", RIGHT)).json.error).toBe("case_closed");
  });

  it("names the wrong helper: still solved, no bonus", async () => {
    const t = await startedTeam(ctx);
    await toAct3(ctx, t.sids[0]);
    const res = await accuse(ctx, t.sids[0], "yasmine", "report", RIGHT, "lucien");
    expect(res.json).toMatchObject({ status: "correct", bonus: 0 });
  });
});

describe("spoiler separation over the API", () => {
  it("never returns canonical flags, the accusation rule or the reconstruction before the case is resolved", async () => {
    const t = await startedTeam(ctx);
    await solve(ctx, t.sids[0], [...ALL]);
    const bodies = await Promise.all(
      [
        "/api/me/team-state",
        "/api/case/challenges",
        "/api/case/fs",
        "/api/case/accusation",
        "/api/case/file",
        "/api/case/result",
        "/api/case/timeline",
        "/api/notes",
        "/api/clock",
        "/api/practice/tasks",
        "/api/practice/fs",
      ].map(async (u) => (await call(ctx, "GET", u, { sid: t.sids[0] })).body),
    );
    const all = bodies.join("\n");
    for (const flag of [...Object.values(FLAGS), ...Object.values(content.answers.practice)]) expect(all).not.toContain(flag);
    expect(all).not.toContain("groups");
    expect(all).not.toContain(content.verdict.reconstruction.stinger);
    expect(all).not.toContain("$comment");
  });

  it("shows the reconstruction and flags to finished teams only after the reveal", async () => {
    const t = await startedTeam(ctx);
    ctx.clock.advance(76 * 60_000);
    expect((await call(ctx, "GET", "/api/case/result", { sid: t.sids[0] })).json.reconstruction).toBeNull();
    const admin = await adminLogin(ctx);
    await call(ctx, "POST", "/api/admin/event/reveal", { admin, body: {} });
    const after = await call(ctx, "GET", "/api/case/result", { sid: t.sids[0] });
    expect(after.json.reconstruction.answers.map((a: { flag: string }) => a.flag)).toEqual(Object.values(FLAGS));
  });

  it("keeps notes private to each team", async () => {
    const a = await startedTeam(ctx, "Team A");
    const b = await startedTeam(ctx, "Team B");
    const note = await call(ctx, "POST", "/api/notes", { sid: a.sids[0], body: { title: "Secret", body: "A14 looks important" } });
    expect(note.status).toBe(201);
    expect((await call(ctx, "GET", "/api/notes", { sid: b.sids[0] })).json.notes).toEqual([]);
    expect((await call(ctx, "PUT", `/api/notes/${note.json.id}`, { sid: b.sids[0], body: { body: "x", version: 1 } })).status).toBe(404);
  });

  it("detects concurrent note edits", async () => {
    const t = await startedTeam(ctx);
    const note = await call(ctx, "POST", "/api/notes", { sid: t.sids[0], body: { body: "first" } });
    expect((await call(ctx, "PUT", `/api/notes/${note.json.id}`, { sid: t.sids[1], body: { body: "second", version: 1 } })).json.version).toBe(2);
    const stale = await call(ctx, "PUT", `/api/notes/${note.json.id}`, { sid: t.sids[0], body: { body: "stale", version: 1 } });
    expect(stale.status).toBe(409);
    expect(stale.json.current.body).toBe("second");
  });
});

describe("practice room", () => {
  it("is open in the lobby, before the clock, and never touches the score", async () => {
    const t = await makeTeam(ctx);
    const fs = (await call(ctx, "GET", "/api/practice/fs", { sid: t.sids[0] })).json;
    expect(fs.root).toBe("training");
    expect(fs.files.map((f: { path: string }) => f.path)).toContain(".secret_note");
    const tasks = (await call(ctx, "GET", "/api/practice/tasks", { sid: t.sids[0] })).json;
    expect(tasks.map((x: { id: string }) => x.id)).toEqual(["hidden", "metadata", "integrity", "cipher"]);
    const raw = await call(ctx, "GET", "/api/practice/fs/raw?path=note.txt", { sid: t.sids[0] });
    expect(raw.body).toContain("Wkh sdvvzrug lv SXPSNLQ");
    expect((await call(ctx, "GET", "/api/practice/fs/raw?path=../evidence/meta.json", { sid: t.sids[0] })).status).toBe(404);
    const sub = (id: string, answer: string) => call(ctx, "POST", `/api/practice/tasks/${id}/submit`, { sid: t.sids[1], body: { answer } });
    expect((await sub("cipher", "flag{pumpkin}")).json.status).toBe("correct");
    expect((await sub("integrity", "FLAG{A}")).json.status).toBe("incorrect");
    expect((await sub("metadata", "0915")).json.status).toBe("format_error");
    expect((await sub("nope", "FLAG{X}")).status).toBe(404);
    const state = (await call(ctx, "GET", "/api/me/team-state", { sid: t.sids[0] })).json;
    expect(state).toMatchObject({ team: { status: "NOT_STARTED", score: { total: 0 } } });
    expect((await call(ctx, "GET", "/api/practice/tasks")).status).toBe(401);
  });
});

describe("organizer controls", () => {
  it("protects admin endpoints from players and wrong tokens", async () => {
    const t = await makeTeam(ctx);
    expect((await call(ctx, "GET", "/api/admin/overview", { sid: t.sids[0] })).status).toBe(401);
    expect((await call(ctx, "POST", "/api/admin/login", { body: { token: "nope" } })).status).toBe(401);
    expect((await call(ctx, "GET", "/api/admin/export")).status).toBe(401);
    expect((await call(ctx, "POST", `/api/admin/teams/${t.teamId}/open-act`, { sid: t.sids[0], body: { act: 3, reason: "please" } })).status).toBe(401);
  });

  it("pauses all clocks and shifts deadlines on resume, with an audit trail", async () => {
    const t = await startedTeam(ctx);
    const admin = await adminLogin(ctx);
    const before = (await call(ctx, "GET", "/api/clock", { sid: t.sids[0] })).json.deadlineAt;
    await call(ctx, "POST", "/api/admin/event/pause", { admin, body: { reason: "Wi-Fi outage" } });
    expect((await submit(ctx, t.sids[0], "EV01", FLAGS.EV01)).json.status).toBe("paused");
    ctx.clock.advance(10 * 60_000);
    await call(ctx, "POST", "/api/admin/event/resume", { admin, body: { reason: "back" } });
    const after = (await call(ctx, "GET", "/api/clock", { sid: t.sids[0] })).json.deadlineAt;
    expect(Date.parse(after) - Date.parse(before)).toBe(10 * 60_000);
    const audit = (await call(ctx, "GET", "/api/admin/overview", { admin })).json.audit.map((a: { action: string }) => a.action);
    expect(audit).toEqual(expect.arrayContaining(["pause_event", "resume_event"]));
  });

  it("opens an act early for a stuck team, with an audit entry and a note in the team's activity", async () => {
    const waiting = await makeTeam(ctx, "Waiting");
    const t = await startedTeam(ctx);
    const admin = await adminLogin(ctx);
    expect((await call(ctx, "POST", `/api/admin/teams/${waiting.teamId}/open-act`, { admin, body: { act: 2, reason: "stuck" } })).json.error).toBe("not_started");
    const res = await call(ctx, "POST", `/api/admin/teams/${t.teamId}/open-act`, { admin, body: { act: 3, reason: "stuck on the door log" } });
    expect(res.json).toMatchObject({ act: 3 });
    expect((await call(ctx, "POST", `/api/admin/teams/${t.teamId}/open-act`, { admin, body: { act: 2, reason: "again" } })).json.error).toBe("already_open");
    expect((await call(ctx, "POST", `/api/admin/teams/${t.teamId}/open-act`, { admin, body: { act: 4, reason: "nope" } })).status).toBe(400);
    const state = (await call(ctx, "GET", "/api/me/team-state", { sid: t.sids[0] })).json;
    expect(state.acts.current).toBe(3);
    expect(state.activity.filter((a: { kind: string }) => a.kind === "act").map((a: { text: string }) => a.text)).toEqual([
      "Organizers opened Act III: The Angel. New evidence is mounted.",
      "Organizers opened Act II: The Booth. New evidence is mounted.",
    ]);
    expect((await submit(ctx, t.sids[0], "EV08", FLAGS.EV08)).json.status).toBe("correct");
    const audit = (await call(ctx, "GET", "/api/admin/overview", { admin })).json.audit;
    expect(audit[0]).toMatchObject({ action: "open_act", payload: { act: 3, reason: "stuck on the door log" } });
  });

  it("extends a timed-out team back into play without restarting it", async () => {
    const t = await startedTeam(ctx);
    const admin = await adminLogin(ctx);
    ctx.clock.advance(76 * 60_000);
    expect((await call(ctx, "GET", "/api/me/team-state", { sid: t.sids[0] })).json.team.status).toBe("TIME_EXPIRED");
    const res = await call(ctx, "POST", `/api/admin/teams/${t.teamId}/extend`, { admin, body: { minutes: 5, reason: "network incident" } });
    expect(res.json.status).toBe("ACTIVE");
    expect((await call(ctx, "GET", "/api/me/team-state", { sid: t.sids[0] })).json.team.status).toBe("ACTIVE");
    expect((await submit(ctx, t.sids[0], "EV01", FLAGS.EV01)).json.status).toBe("correct");
  });

  it("shows each accusation to organizers, requires the exact team name to reset, and exports a CSV without notes", async () => {
    const t = await startedTeam(ctx);
    await toAct3(ctx, t.sids[0]);
    await call(ctx, "POST", "/api/notes", { sid: t.sids[0], body: { body: "private reasoning" } });
    await accuse(ctx, t.sids[0], "karim", "grudge", ["phones/nadia_haddad/messenger/karim_darwish.json"], "tara");
    const admin = await adminLogin(ctx);
    const detail = (await call(ctx, "GET", `/api/admin/teams/${t.teamId}`, { admin })).json;
    expect(detail.act).toBe(3);
    expect(detail.verdicts[0]).toMatchObject({ suspectId: "karim", motiveId: "grudge", accompliceId: "tara", files: ["phones/nadia_haddad/messenger/karim_darwish.json"], correct: false, bonus: 0, by: "ana" });
    expect((await call(ctx, "POST", `/api/admin/teams/${t.teamId}/reset`, { admin, body: { confirmTeamName: "night owls", reason: "test" } })).status).toBe(400);
    const csv = await call(ctx, "GET", "/api/admin/export", { admin });
    expect(csv.body.split("\n")[0]).toBe("rank,team,score,status,flags_solved,elapsed_seconds,last_score_at_utc,started_at_utc,completed_at_utc");
    expect(csv.body).toContain("Night Owls,45,ACTIVE,4");
    expect(csv.body).not.toContain("private reasoning");
    const reset = await call(ctx, "POST", `/api/admin/teams/${t.teamId}/reset`, { admin, body: { confirmTeamName: "Night Owls", reason: "test" } });
    expect(reset.json).toMatchObject({ status: "NOT_STARTED", score: 0, verdictAttempts: 0, act: 1 });
  });

  it("ranks the leaderboard by score, then by who got there first", async () => {
    const a = await startedTeam(ctx, "Alpha");
    const b = await startedTeam(ctx, "Bravo");
    const c = await startedTeam(ctx, "Charlie");
    await solve(ctx, b.sids[0], ["EV01"]);
    ctx.clock.advance(60_000);
    await solve(ctx, a.sids[0], ["EV02"]);
    await solve(ctx, c.sids[0], ["EV01", "EV02"]);
    const board = await call(ctx, "GET", "/api/leaderboard");
    expect(board.json.rows.map((r: { teamName: string }) => r.teamName)).toEqual(["Charlie", "Bravo", "Alpha"]);
    expect(Object.keys(board.json.rows[0]).sort()).toEqual(["elapsedSeconds", "lastScoreAt", "rank", "score", "solvedCount", "status", "teamName"]);
  });
});

describe("request hardening", () => {
  it("rejects cross-site origins and non-JSON bodies", async () => {
    const cross = await call(ctx, "POST", "/api/teams", { body: { teamName: "X Team", nickname: "x" }, headers: { origin: "https://evil.example" } });
    expect(cross.status).toBe(403);
    const plain = await ctx.app.inject({ method: "POST", url: "/api/teams", headers: { "content-type": "text/plain" }, payload: "teamName=x" });
    expect(plain.statusCode).toBe(415);
  });

  it("sends security headers and never caches API responses", async () => {
    const res = await call(ctx, "GET", "/api/health");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("requires a session for case data", async () => {
    expect((await call(ctx, "GET", "/api/case/fs")).status).toBe(401);
    expect((await call(ctx, "GET", "/api/case/fs/raw?path=incident_report.txt")).status).toBe(401);
  });
});

describe("event readiness regressions", () => {
  it("requires a private credential to recover and leaves existing sessions valid", async () => {
    const t = await makeTeam(ctx, "Recovery", 3);
    const admin = await adminLogin(ctx);
    await call(ctx, "PUT", "/api/admin/event", { admin, body: { registrationOpen: false } });
    for (const recoveryKey of [undefined, "wrong-key", t.sids[0]]) {
      const r = await call(ctx, "POST", "/api/teams/join", { body: { code: t.code, nickname: "MATE1", recoveryKey } });
      expect(r.json.error).toBe("recovery_required");
      expect(r.cookie).toBeUndefined();
      expect((await call(ctx, "GET", "/api/me/team-state", { sid: t.sids[1] })).status).toBe(200);
    }
    const recovered = await call(ctx, "POST", "/api/teams/join", { body: { code: t.code, nickname: "mate1", recoveryKey: t.sids[1] } });
    expect(recovered.status).toBe(200);
    expect(recovered.json.state.members).toHaveLength(3);
    expect((await call(ctx, "GET", "/api/me/team-state", { sid: t.sids[1] })).status).toBe(200);
    expect((await call(ctx, "POST", "/api/teams/join", { sid: t.sids[1], body: { code: t.code, nickname: "mate1" } })).status).toBe(200);
    expect((await call(ctx, "GET", "/api/me/recovery-key", { sid: t.sids[1] })).json.recoveryKey).toBe(t.sids[1]);
    expect((await call(ctx, "GET", "/api/me/recovery-key")).status).toBe(401);
    await call(ctx, "POST", "/api/me/logout", { sid: t.sids[1], body: {} });
    expect((await call(ctx, "POST", "/api/teams/join", { body: { code: t.code, nickname: "mate1", recoveryKey: t.sids[1] } })).json.error).toBe("recovery_required");
  });

  it("blocks new members when registration closes, but creation toggle alone permits joining", async () => {
    const t = await makeTeam(ctx);
    const admin = await adminLogin(ctx);
    await call(ctx, "PUT", "/api/admin/event", { admin, body: { registrationOpen: false } });
    expect((await call(ctx, "POST", "/api/teams/join", { body: { code: t.code, nickname: "late" } })).json.error).toBe("registration_closed");
    await call(ctx, "PUT", "/api/admin/event", { admin, body: { registrationOpen: true, createTeamEnabled: false } });
    expect((await call(ctx, "POST", "/api/teams/join", { body: { code: t.code, nickname: "late" } })).status).toBe(200);
    expect((await call(ctx, "POST", "/api/teams/join", { body: { code: t.code, nickname: "extra" } })).json.error).toBe("team_full");
  });

  it("defaults to organizer-controlled Begin and validates configurable team sizes", async () => {
    const db = openDb(":memory:");
    const fresh = await buildApp({ db, clock: ctx.clock, config: { ...loadConfig({}), adminToken: ADMIN_TOKEN, webDist: "/nonexistent" }, content });
    const isolated = { ...ctx, app: fresh };
    try {
      const t = await makeTeam(isolated);
      expect((await call(isolated, "POST", "/api/case/start", { sid: t.sids[0], body: {} })).json.error).toBe("start_closed");
      const admin = await adminLogin(isolated);
      expect((await call(isolated, "PUT", "/api/admin/event", { admin, body: { minTeamSize: 4, maxTeamSize: 2 } })).status).toBe(400);
      await call(isolated, "PUT", "/api/admin/event", { admin, body: { minTeamSize: 2, maxTeamSize: 2, startOpen: true } });
      expect((await call(isolated, "POST", "/api/case/start", { sid: t.sids[0], body: {} })).status).toBe(200);
    } finally { await fresh.close(); db.close(); }
  });

  it("never caches raw or text evidence, including errors and session changes", async () => {
    const t = await startedTeam(ctx);
    await toAct3(ctx, t.sids[0]);
    const pdf = [...content.files.values()].find(f => f.mime === "application/pdf")!;
    const image = [...content.files.values()].find(f => f.mime.startsWith("image/") && f.unlock.act === 1)!;
    const training = [...content.training.files.keys()][0];
    for (const url of [`/api/case/fs/raw?path=${pdf.path}`, `/api/case/fs/text?path=${pdf.path}`, `/api/case/fs/raw?path=${image.path}`, `/api/practice/fs/raw?path=${training}`]) {
      const res = await call(ctx, "GET", url, { sid: t.sids[0] });
      expect(res.status).toBe(200);
      expect(res.headers["cache-control"]).toBe("no-store");
      if (url.includes("/raw")) expect(res.headers["content-disposition"]).toContain("inline");
      const unauthorized = await call(ctx, "GET", url);
      expect(unauthorized.status).toBe(401);
      expect(unauthorized.headers["cache-control"]).toBe("no-store");
    }
  });

  it("reopens an expired team using frozen time during a long event pause", async () => {
    const t = await startedTeam(ctx);
    const admin = await adminLogin(ctx);
    ctx.clock.advance(76 * 60_000);
    await call(ctx, "GET", "/api/me/team-state", { sid: t.sids[0] });
    await call(ctx, "POST", "/api/admin/event/pause", { admin, body: {} });
    ctx.clock.advance(30 * 60_000);
    const extended = await call(ctx, "POST", `/api/admin/teams/${t.teamId}/extend`, { admin, body: { minutes: 5, reason: "incident" } });
    expect(extended.json.status).toBe("ACTIVE");
    expect((await submit(ctx, t.sids[0], "EV01", FLAGS.EV01)).json.status).toBe("paused");
    await call(ctx, "POST", "/api/admin/event/resume", { admin, body: {} });
    expect((await submit(ctx, t.sids[0], "EV01", FLAGS.EV01)).json.status).toBe("correct");
    ctx.clock.advance(4 * 60_000 + 1);
    expect((await submit(ctx, t.sids[0], "EV02", FLAGS.EV02)).json.status).toBe("time_expired");
  });

  it("does not consume both accusations on duplicate requests from two devices", async () => {
    const t = await startedTeam(ctx);
    await toAct3(ctx, t.sids[0]);
    const body = { suspectId: "lucien", motiveId: "secret", files: ["staff_channel/attachments/fwd_0003.png"], expectedAttempt: 1 };
    const results = await Promise.all(t.sids.map(sid => call(ctx, "POST", "/api/case/accusation", { sid, body })));
    expect(results.map(r => r.status).sort()).toEqual([200, 409]);
    expect((await call(ctx, "GET", "/api/case/accusation", { sid: t.sids[0] })).json.attemptsUsed).toBe(1);
    expect((await call(ctx, "POST", "/api/case/accusation", { sid: t.sids[0], body })).json.error).toBe("stale_attempt");
    const final = { ...body, expectedAttempt: 2 };
    const endings = await Promise.all(t.sids.map(sid => call(ctx, "POST", "/api/case/accusation", { sid, body: final })));
    expect(endings.map(r => r.status).sort()).toEqual([200, 409]);
    expect((await call(ctx, "GET", "/api/case/result", { sid: t.sids[1] })).json.status).toBe("WRONG_VERDICT");
  });
});

describe("final scoring concurrency", () => {
  it("does not score a flag after a concurrent successful accusation closes the case", async () => {
    const t = await startedTeam(ctx);
    await toAct3(ctx, t.sids[0]);
    const [verdict, flag] = await Promise.all([
      call(ctx, "POST", "/api/case/accusation", { sid: t.sids[0], body: { suspectId: "yasmine", motiveId: "report", files: ["finance/.backup/ledger_2026-10-30.csv", "access_control/exports/ACS-EXP-7731.csv"], expectedAttempt: 1 } }),
      submit(ctx, t.sids[1], "EV06", FLAGS.EV06),
    ]);
    expect(verdict.json.status).toBe("correct");
    expect(flag.json.status).toBe("case_closed");
    expect((await call(ctx, "GET", "/api/me/team-state", { sid: t.sids[0] })).json.solvedIds).not.toContain("EV06");
  });
});
