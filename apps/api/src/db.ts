import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export type Db = DatabaseSync;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  duration_seconds INTEGER NOT NULL,
  registration_open INTEGER NOT NULL DEFAULT 1,
  create_team_enabled INTEGER NOT NULL DEFAULT 1,
  registration_code TEXT,
  min_team_size INTEGER NOT NULL DEFAULT 2,
  max_team_size INTEGER NOT NULL DEFAULT 3,
  start_open INTEGER NOT NULL DEFAULT 1,
  leaderboard_public INTEGER NOT NULL DEFAULT 1,
  reveal_at TEXT,
  paused_at TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id),
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  join_code_hash TEXT NOT NULL UNIQUE,
  started_at TEXT,
  deadline_at TEXT,
  completed_at TEXT,
  case_status TEXT NOT NULL DEFAULT 'NOT_STARTED',
  ending TEXT,
  act2_opened_at TEXT,
  act3_opened_at TEXT,
  notes_rev INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE (event_id, name_key)
);
CREATE TABLE IF NOT EXISTS team_members (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id),
  nickname TEXT NOT NULL,
  nickname_key TEXT NOT NULL,
  session_token_hash TEXT UNIQUE,
  role TEXT NOT NULL,
  ready INTEGER NOT NULL DEFAULT 0,
  revoked INTEGER NOT NULL DEFAULT 0,
  joined_at TEXT NOT NULL,
  last_seen_at TEXT,
  UNIQUE (team_id, nickname_key)
);
CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id TEXT NOT NULL,
  challenge_id TEXT NOT NULL,
  member_id TEXT,
  submitted_at TEXT NOT NULL,
  correct INTEGER NOT NULL,
  normalized_answer_hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS submissions_team ON submissions(team_id, challenge_id, submitted_at);
CREATE TABLE IF NOT EXISTS team_solved (
  team_id TEXT NOT NULL,
  challenge_id TEXT NOT NULL,
  solved_at TEXT NOT NULL,
  awarded_points INTEGER NOT NULL,
  member_id TEXT,
  PRIMARY KEY (team_id, challenge_id)
);
CREATE INDEX IF NOT EXISTS solved_challenge ON team_solved(challenge_id, solved_at);
CREATE TABLE IF NOT EXISTS team_notes (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  author_member_id TEXT,
  last_editor_member_id TEXT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  evidence_refs TEXT NOT NULL DEFAULT '[]',
  starred INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS notes_team ON team_notes(team_id);
CREATE TABLE IF NOT EXISTS verdict_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id TEXT NOT NULL,
  attempt_no INTEGER NOT NULL,
  suspect_id TEXT NOT NULL,
  motive_id TEXT NOT NULL,
  accomplice_id TEXT,
  files TEXT NOT NULL,
  member_id TEXT,
  submitted_at TEXT NOT NULL,
  correct INTEGER NOT NULL,
  penalty INTEGER NOT NULL,
  bonus INTEGER NOT NULL DEFAULT 0,
  UNIQUE (team_id, attempt_no)
);
CREATE TABLE IF NOT EXISTS team_activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id TEXT NOT NULL,
  member_id TEXT,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS activity_team ON team_activity(team_id, id);
CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS admin_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  payload TEXT NOT NULL,
  occurred_at TEXT NOT NULL
);
`;

/** Bumped whenever SCHEMA changes incompatibly. */
export const SCHEMA_VERSION = 3;

/** Refuse incompatible databases. Startup must never replace live event state. */
function checkVersion(file: string): void {
  if (file === ":memory:" || !existsSync(file)) return;
  const probe = new DatabaseSync(file, { readOnly: true });
  try {
    const version = (probe.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
    const hasTables = !!probe.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' LIMIT 1").get();
    if (hasTables && version !== SCHEMA_VERSION) {
      throw new Error(`Database schema ${version} is incompatible with ${SCHEMA_VERSION}. Startup stopped; back up and explicitly migrate the database. No data was reset.`);
    }
  } finally { probe.close(); }
}

export function openDb(file: string): Db {
  if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
  checkVersion(file);
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  db.exec(SCHEMA);
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  return db;
}

/** Runs fn inside an IMMEDIATE transaction (single writer), rolling back on error. */
export function tx<T>(db: Db, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
