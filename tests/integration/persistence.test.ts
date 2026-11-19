import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it } from "vitest";
import { openDb, SCHEMA_VERSION } from "../../apps/api/src/db";
import { verifyRelease } from "../../apps/api/src/release";
import { createHash } from "node:crypto";
import { buildApp } from "../../apps/api/src/app";
import { manualClock } from "../../apps/api/src/clock";
import { loadConfig } from "../../apps/api/src/config";
import { loadContent } from "../../apps/api/src/content";

const folders: string[] = [];
const temp = () => { const dir = mkdtempSync(path.join(tmpdir(), "case404-test-")); folders.push(dir); return dir; };
afterEach(() => { for (const dir of folders.splice(0)) rmSync(dir, { recursive: true, force: true }); });

it.each([0, SCHEMA_VERSION - 1, SCHEMA_VERSION + 1])("refuses incompatible schema %s without changing or replacing the database", version => {
  const file = path.join(temp(), "event.db"); const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE live_data (score INTEGER); INSERT INTO live_data VALUES (130); PRAGMA user_version = ${version}`); db.close();
  const before = readFileSync(file);
  expect(() => openDb(file)).toThrow("No data was reset"); expect(readFileSync(file)).toEqual(before);
});

it("refuses missing manifests and stale or missing built artifacts and checkout sources", () => {
  const dir = temp(); expect(() => verifyRelease(dir)).toThrow("Missing release manifest");
  mkdirSync(path.join(dir, "apps/api/src"), { recursive: true });
  const source = "apps/api/src/server.ts", artifact = "server.js";
  writeFileSync(path.join(dir, source), "current source"); writeFileSync(path.join(dir, artifact), "current artifact");
  const hash = (text: string) => createHash("sha256").update(text).digest("hex");
  writeFileSync(path.join(dir, "release-manifest.json"), JSON.stringify({ sources: { [source]: hash("current source") }, artifacts: { [artifact]: hash("current artifact") } }));
  expect(() => verifyRelease(dir)).not.toThrow();
  writeFileSync(path.join(dir, artifact), "stale"); expect(() => verifyRelease(dir)).toThrow("Stale");
  writeFileSync(path.join(dir, artifact), "current artifact"); writeFileSync(path.join(dir, source), "changed source"); expect(() => verifyRelease(dir)).toThrow("Stale");
  rmSync(path.join(dir, source)); expect(() => verifyRelease(dir)).toThrow("missing");
});

it("preserves sessions, settings, solves, notes, deadlines and progress across a real database reopen", async () => {
  const file = path.join(temp(), "event.db");
  const config = { ...loadConfig({}), databasePath: file, webDist: "/nonexistent" };
  const content = loadContent(config.contentDir, config.answersPath); const clock = manualClock("2026-11-05T16:30:00Z");
  let db = openDb(file), app = await buildApp({ db, config, content, clock });
  const post = (url: string, payload: unknown, sid?: string) => app.inject({ method: "POST", url, payload, cookies: sid ? { c404_sid: sid } : {} });
  const login = await post("/api/admin/login", { token: config.adminToken });
  await app.inject({ method: "PUT", url: "/api/admin/event", payload: { startOpen: true, minTeamSize: 2 }, cookies: { c404_admin: login.cookies[0].value } });
  const team = await post("/api/teams", { teamName: "Persistence", nickname: "Ana" }); const sid = team.cookies[0].value;
  await post("/api/teams/join", { code: team.json().joinCode, nickname: "Ben" });
  await post("/api/case/start", {}, sid);
  await post("/api/case/challenges/EV01/submit", { answer: content.answers.flags.EV01 }, sid);
  await post("/api/notes", { body: "Keep this investigation" }, sid);
  const before = (await app.inject({ url: "/api/me/team-state", cookies: { c404_sid: sid } })).json();
  await app.close(); db.close();
  db = openDb(file); app = await buildApp({ db, config, content, clock });
  try {
    const after = (await app.inject({ url: "/api/me/team-state", cookies: { c404_sid: sid } })).json();
    expect(after).toEqual(before);
    expect((await app.inject({ url: "/api/notes", cookies: { c404_sid: sid } })).json().notes[0].body).toBe("Keep this investigation");
    expect((await post("/api/teams/join", { code: team.json().joinCode, nickname: "Ana", recoveryKey: sid })).statusCode).toBe(200);
  } finally { await app.close(); db.close(); }
});
