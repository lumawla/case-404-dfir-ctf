import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { CHALLENGE_ACT, CHALLENGE_IDS, type ActNumber, type ChallengeCategory, type ChallengeId, type Difficulty, type PracticeTask, type SuspectId } from "@case404/shared";

/** One file of the read-only evidence file system players explore in the terminal. */
export type FileRecord = {
  /** Relative to the case root (~/case404), POSIX separators. */
  path: string;
  bytes: Buffer;
  mime: string;
  modified: string;
  /** pdftotext output for documents; null for everything else. */
  text: string | null;
  /** The file appears once this act is open and, if set, once this challenge is owned. */
  unlock: { act: ActNumber; solved: ChallengeId | null };
};

export type ChallengeRecord = {
  id: ChallengeId;
  act: ActNumber;
  title: string;
  category: ChallengeCategory;
  difficulty: Difficulty;
  description: string;
  format: string;
};

export type Answers = {
  flags: Record<ChallengeId, string>;
  verdict: { suspect: SuspectId; motive: string; accomplice: SuspectId; groups: Record<string, string[]> };
  practice: Record<string, string>;
};

export type TimelineRecord = { id: string; at: string; label: string; text: string; replaces?: string };

export type FileTree = { root: string; files: Map<string, FileRecord> };

export type CaseContent = {
  caseFile: any; // content/public/case.json (validated by tests)
  root: string;
  files: Map<string, FileRecord>;
  challenges: Map<ChallengeId, ChallengeRecord>;
  acts: { n: ActNumber; title: string; intro: string }[];
  timeline: { baseline: TimelineRecord[]; solved: Partial<Record<ChallengeId, TimelineRecord[]>> };
  verdict: {
    suspects: { id: SuspectId; name: string; alias: string; portrait: string | null }[];
    motives: { id: string; label: string }[];
    maxFiles: number;
    messages: { incorrect: string; finalIncorrect: string; correct: string };
    endings: Record<string, { title: string; text: string }>;
    reconstruction: { text: string; stinger: string };
  };
  training: FileTree & { tasks: PracticeTask[] };
  answers: Answers;
};

const MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".csv": "text/csv; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".log": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".pdf": "application/pdf",
  ".db": "application/vnd.sqlite3",
};

const readJson = (file: string) => JSON.parse(readFileSync(file, "utf8"));

function walk(dir: string, base = dir): string[] {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const abs = path.join(dir, name);
      return statSync(abs).isDirectory() ? walk(abs, base) : [path.relative(base, abs).split(path.sep).join("/")];
    });
}

function parseUnlock(file: string, value: string | undefined): FileRecord["unlock"] {
  if (value === undefined || value === "act1") return { act: 1, solved: null };
  if (value === "act2") return { act: 2, solved: null };
  if (value === "act3") return { act: 3, solved: null };
  const id = value.startsWith("solved:") ? value.slice(7) : "";
  if ((CHALLENGE_IDS as string[]).includes(id)) return { act: CHALLENGE_ACT[id as ChallengeId], solved: id as ChallengeId };
  throw new Error(`meta.json: ${file} has an unknown unlock "${value}".`);
}

/** Loads a file tree. Every file on disk must have a meta entry and vice versa, so nothing is served by accident. */
export function loadFiles(treeDir: string): FileTree {
  const meta = readJson(path.join(treeDir, "meta.json")) as { root: string; files: Record<string, { modified: string; text?: string; unlock?: string }> };
  const caseDir = path.join(treeDir, "fs", meta.root);
  const onDisk = walk(caseDir);
  const missingMeta = onDisk.filter((p) => !meta.files[p]);
  const missingFile = Object.keys(meta.files).filter((p) => !onDisk.includes(p));
  if (missingMeta.length || missingFile.length) {
    throw new Error(`${path.join(treeDir, "meta.json")} is out of sync. No meta: ${missingMeta.join(", ") || "-"}. No file: ${missingFile.join(", ") || "-"}.`);
  }
  const files = new Map<string, FileRecord>();
  for (const p of onDisk) {
    const entry = meta.files[p];
    files.set(p, {
      path: p,
      bytes: readFileSync(path.join(caseDir, p)),
      mime: MIME[path.extname(p).toLowerCase()] ?? "application/octet-stream",
      modified: entry.modified,
      text: entry.text ? readFileSync(path.join(treeDir, entry.text), "utf8") : null,
      unlock: parseUnlock(p, entry.unlock),
    });
  }
  return { root: meta.root, files };
}

export function loadContent(contentDir: string, answersPath: string): CaseContent {
  const { root, files } = loadFiles(path.join(contentDir, "evidence"));
  const challenges = new Map<ChallengeId, ChallengeRecord>();
  for (const c of readJson(path.join(contentDir, "gated/challenges.json")).challenges) challenges.set(c.id, c);
  const { $comment: _t, ...timeline } = readJson(path.join(contentDir, "gated/timeline.json"));
  const training = loadFiles(path.join(contentDir, "training"));
  return {
    caseFile: readJson(path.join(contentDir, "public/case.json")),
    root,
    files,
    challenges,
    acts: readJson(path.join(contentDir, "gated/acts.json")).acts,
    timeline,
    verdict: readJson(path.join(contentDir, "gated/verdict.json")),
    training: { ...training, tasks: readJson(path.join(contentDir, "training/tasks.json")).tasks },
    answers: readJson(answersPath),
  };
}
