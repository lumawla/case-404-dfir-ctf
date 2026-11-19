# Architecture

```text
Browser (React SPA, same origin)
  ├─ Public pages: landing, join/create, lobby (rules + Begin), practice room, scoreboard
  ├─ Case shell (lazy-loaded): workspace (challenge board by act + terminal / Caesar Lab /
  │  timeline / cheat sheet / notes), case file, accuse, scoreboard, result
  ├─ Terminal runs locally (apps/web/src/terminal): virtual file system built from /api/case/fs,
  │  file bytes fetched on demand from /api/case/fs/raw and cached for the session; when an act
  │  opens, the new files are mounted into the same shell (cwd, history and /tmp survive)
  └─ Polls /api/me/team-state every 4 s (15 s when hidden)
            │  HTTPS, httpOnly session cookie, JSON only
            ▼
Fastify API (apps/api)
  ├─ team auth (cookie → hashed session token)        ├─ admin auth (token → admin session)
  ├─ authoritative clock + expiry + pause shifts       ├─ flag validation (answers from private/)
  ├─ evidence tree (content/evidence/fs + meta.json)   ├─ accusation rule, endings, reveal
  ├─ acts: what each team can see, opened by solves    ├─ practice room (content/training)
  └─ notes, timeline, solve counts / first blood, audit log
            │
            ▼
SQLite (node:sqlite, WAL) — data/case404.db
```

## Why this stack

React/TypeScript and Fastify, with **SQLite via Node's built-in `node:sqlite`**: one process, one file, no database server to operate on event day. A 60-team event generates a few thousand small writes; SQLite in WAL mode handles that easily.

Run **one** API instance: the in-memory join/login rate limiter and SQLite's single writer both assume it.

`PRAGMA user_version` marks the schema version. Startup refuses incompatible versions without changing or replacing the database. This release keeps schema 3; explicit offline migrations are required for other versions.

## Request flow and invariants

- **Sessions.** Creating or joining a team issues a random 256-bit token in an `httpOnly`, `SameSite=Lax` cookie (`Secure` in production). Only its SHA-256 is stored. An existing nickname requires its current cookie or private recovery key; the same bearer credential is reused so existing sessions stay valid. New members require open registration and an available seat.
- **Join codes.** 12 characters from a 32-symbol alphabet (60 bits), stored as an HMAC keyed by `APP_SECRET`. Organizers can regenerate them; old codes stop working.
- **CSRF.** Only JSON bodies are parsed (the `text/plain` parser is removed), cookies are `SameSite=Lax`, and state-changing requests with a foreign `Origin` are rejected.
- **Timer.** `POST /api/case/start` sets `started_at`/`deadline_at` once (`UPDATE … WHERE case_status='NOT_STARTED'`). Every authenticated request runs `refreshTeam`, which expires teams on server time. Clients only animate the countdown, using the measured offset `serverNow − clientNow`. Pausing freezes the effective clock; resuming adds the paused duration to every active deadline.
- **Acts.** The case opens in three acts (`content/gated/acts.json`, rules in `packages/shared/src/rules.ts`). Act I opens at Begin. Act II opens when both Act I challenges are owned, Act III when any two of the three Act II challenges are. `teams.act2_opened_at`/`act3_opened_at` record when; the transaction that records a solve also opens the act, posts it to the team's activity and returns `actOpened` to the solver. Organizers can open an act early (`POST /api/admin/teams/:id/open-act`, audit-logged); acts never close. While an act is sealed its challenges come back with `title`, `description` and `format` set to null, submissions are refused with `locked`, and its files are missing from the listing and answer 404, exactly like files that don't exist. Within an act, the order is the team's call. After time runs out, open files stay readable and submissions are refused.
- **Flags.** Normalized by trimming and ASCII upper-casing only, format-checked, rate-limited (6 wrong per challenge per minute), compared with the server-only answer, and recorded with a keyed hash instead of the raw answer. A wrong flag gets the same reply whatever it was. `team_solved` has a `(team_id, challenge_id)` primary key and inserts use `INSERT OR IGNORE` inside an immediate transaction, so concurrent correct submissions award points once. First blood is the earliest `team_solved` row per challenge.
- **Score.** `max(0, flags + accusation + accomplice bonus − penalties)`, recomputed from rows. Scoreboard ties go to whoever reached the score first.
- **Accusation.** Opens with Act III. Two attempts. Each names a suspect, a motive, optionally an accomplice, and 1–3 file paths (`~/case404/…`, absolute and relative forms are normalized; unknown or still-sealed paths return 400 without using an attempt). The rule in `answers.json` is suspect + motive + files covering every evidence group, each group by a different file. Naming the right accomplice in a correct accusation adds 15; a wrong or missing accomplice costs nothing. The reply never says which part failed. The first wrong attempt costs 10 points; the second closes the case with a per-suspect ending.
- **Timeline.** `GET /api/case/timeline` returns the baseline entries plus those of each owned challenge (`content/gated/timeline.json`), sorted by time. An entry can strike out an earlier one (`replaces`), which is how the forged door entry is crossed out once the controller's log is found.
- **Practice room.** `content/training/` is a second, tiny file tree with its own `meta.json` and four tasks. `GET /api/practice/fs`, `/api/practice/fs/raw`, `/api/practice/tasks` and `POST /api/practice/tasks/:id/submit` need a team session but not a started case, and never touch the score. Which tasks a player solved is kept in their browser.

## Evidence file system

`content/evidence/fs/case404/` *is* the tree players see at `~/case404`: in-world file names, nested folders, one hidden folder (`finance/.backup/`). `content/evidence/meta.json` gives each file its in-world modification time (what `ls -l` and `exiftool` show), when it appears (`unlock`: `act1`, `act2`, `act3`, or `solved:EVxx` for the two follow-up interviews) and, for the PDF, its text layer for `pdftotext`. The loader refuses to start if a file on disk has no meta entry or the other way round, or if an `unlock` value is unknown, so nothing is served by accident.

| Endpoint | Returns |
|---|---|
| `GET /api/case/fs` | `{ root, files: [{ path, size, modified, mime }], revision }` for the files this team can see, no titles or descriptions. `revision` changes when new files open. |
| `GET /api/case/fs/raw?path=…` | Exact bytes. `&download=1` for an attachment named after the file. Lookup is an exact map hit, so traversal strings are just unknown paths (404). |
| `GET /api/case/fs/text?path=…` | The PDF text layer (415 for anything else) |

The terminal (`apps/web/src/terminal/`) is plain TypeScript with no DOM dependency: `vfs.ts` (tree, path resolution, writable `/tmp`), `shell.ts` (tokenizer with quotes and escapes, `|`, `;`, `&&`, `||`, `>`, `>>`, `2>`, variable and `~` expansion, globbing that skips dotfiles unless the pattern starts with `.`, Tab completion), `commands.ts` (the commands), `jq.ts`, `awk.ts`, `sqlite.ts` (a read-only SQLite b-tree reader for `sqlite3`, which shows live rows only, so deleted records are visible to `strings` but not to SQL, as on a real phone), `media.ts` (JPEG/PNG/PDF/SQLite sniffing, PNG text chunks, hex dumps, MD5; SHA via Web Crypto) and `cheatsheet.ts` (the beginner's cheat sheet, also used by `help <command>`). `session.ts` holds the React glue shared by the case and the practice room. `tests/unit/terminal.test.ts` runs it against the real evidence files.

## Spoiler separation

| Bucket | Where | Served |
|---|---|---|
| Public safe content | Lobby rules in the web bundle, portraits and art | Bundled |
| Story | `content/public/case.json` | `/api/case/file`, after Begin |
| Evidence | `content/evidence/` | `/api/case/fs*`, after Begin, one act at a time |
| Gated content | `content/gated/` (challenges, acts, timeline, accusation options, endings, reconstruction) | By team state: sealed acts' titles, intros, challenge text and timeline entries are withheld |
| Practice | `content/training/` | `/api/practice/*`, any team session |
| Organizer secrets | `private/organizer/answers.json` (or `CASE_ANSWERS_PATH`) | Never; read into server memory only |

Automated guards:
- `tests/unit/content.test.ts` checks that no flag appears in `content/`, `apps/web/src`, `apps/web/public` or `packages/shared`, that the accusation rule and the reconstruction stay out of the client, and that challenge text never names a tool, file or technique.
- `tests/integration/api.test.ts` checks that no API payload contains flags, the accusation rule or the reconstruction before resolution, and that sealed acts' titles, intros and challenge text never appear in a response.
- `npm run check:bundle` scans the built `dist/` for flags, the motive and evidence paths of the rule, the reconstruction, evidence bytes, the hidden backup's name and source maps.

Static serving uses `@fastify/static` rooted at `apps/web/dist` only. Unknown paths, including `/private/...` and `/content/...`, fall back to the SPA shell, never to files. Route-specific security headers win over the defaults: SVG evidence is sandboxed, and PDFs get `object-src 'self'` so the browser's PDF viewer works.

## Evidence pipeline

- Narrative evidence (interviews, chats, reports, JSON exports) is hand-written with LF endings. `.gitattributes` keeps Windows checkouts byte-identical.
- `npm run evidence` (`scripts/build-evidence.mjs`) generates the long record files from one seeded timeline: the controller's door-log export and the edited copy (375 rows, two cells apart, same size), the guest and badge registries, the photo booth's sessions and device log, the two ledgers, the Wi-Fi log, Salma's real SQLite Messages database (the deleted thread stays in the file's free space) and the practice lists. Output is deterministic; the door-log hashes are unit-tested.
- `npm run assets` renders placeholder SVG scenes with Chromium into JPEG/PNG, injects **real EXIF** with a small TIFF writer (`scripts/lib/exif-writer.mjs`) and PNG text chunks, makes the metadata-free feed rendition of the stage photo and the booth print, prints the invoice PDF and renders the venue plan from `content/public/venue.json`.
- Both scripts finish by rewriting `intake/manifest.json` and `intake/manifest_2.json` with fresh hashes (`scripts/lib/intake-manifest.mjs`). The first manifest seals the controller's log by hash only, without a path.
- All outputs are committed so bytes stay frozen for the event.

## Testing

| Layer | Tooling | Covers |
|---|---|---|
| Unit | Vitest | Terminal engine on the real evidence (navigation, hidden files, completion, grep/awk/jq/cut, EXIF and PNG text, hashes and `-c`, diff, file, sqlite3 and strings on the Messages database, pdftotext, open, redirection, read-only files, mounting a new act), the practice folder, Caesar + all three MaskMail threads, act placement of every challenge's evidence, unlock rules, content continuity, manifest hashes, "no guidance" scan, spoiler scans |
| Integration | Vitest + `fastify.inject`, in-memory SQLite, manual clock | Team flow, idempotent start, expiry, pause/resume shift, extension, acts (sealed listings and challenges, act opening by solves, follow-up files, organizer open-act), timeline and strike-through, file listing/bytes/text and traversal, flags without near-miss feedback, concurrent awards, solves and first blood, rate limiting, accusation gating, validation, rule and accomplice bonus, practice room, reveal gating, cross-team isolation, admin auth and accusation review, CSRF, headers, CSV export, scoreboard ties |
| End to end | Playwright (desktop + Pixel 7) | Two-player playthrough act by act through the terminal and Caesar Lab, all eight flags, act briefings and evidence mounting, timeline and cheat sheet, a wrong then a right accusation with the accomplice, the teammate's board updating, the scoreboard; the practice room before Begin; phone play without horizontal scroll |
