# CASE 404 — The Last Photograph

A Halloween **digital-forensics murder mystery CTF** in the style of Hack The Box, for the GDG × Criminology & Forensics Club event. Teams of 2–3 get a challenge board, a Linux-style terminal with the evidence mounted at `~/case404`, a Caesar Lab, a cheat sheet, a case timeline and shared notes. The case opens in **three acts**: eight `FLAG{...}` challenges, each act mounting new evidence, then one accusation. There are no hints, no near-miss feedback and nothing points at the right file: teams dig through the evidence with `ls -a`, `grep`, `exiftool`, `sha256sum`, `diff`, `jq`, `sqlite3`, `strings` and friends. Beginners can warm up first in an unscored practice room.

Everything runs in the browser: the terminal executes its commands locally against the real evidence bytes. Players can also `download` any file and use their own tools.

> **Spoiler policy.** This README is spoiler-free. The culprit, flags and full solution are in [`private/organizer/`](private/organizer/), which the server reads but never serves. Don't copy that folder anywhere public.

Event-readiness fixes, verification, deployment and rollback: [docs/event-readiness.md](docs/event-readiness.md).

## Quick start

Requirements: Node.js **22.13+** (uses the built-in `node:sqlite`).

```bash
npm install
npm run dev            # API on :8787 (tsx watch) + web on http://localhost:5173
```

Dev defaults: organizer token `dev-admin-token` (sign in at `/admin`), database at `data/case404.db`. Teams need **2 members** to begin by default. Organizers must first enable **Teams may press Begin** in the dashboard. Open a second browser profile to join, or lower *Min team* to 1 in the admin dashboard.

### Production

```bash
npm install
npm run build          # web → apps/web/dist, API → apps/api/dist/server.js
NODE_ENV=production ADMIN_TOKEN='long-random' APP_SECRET='long-random' npm start
```

The API serves the built client on the same origin (default port 8787). Put it behind an HTTPS reverse proxy (set `TRUST_PROXY=1`), or use the [`Dockerfile`](Dockerfile). **Free hosting for the event:** on an organizer laptop with [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) installed, run `npm run host` — it starts the server and prints a public `https://…trycloudflare.com` link and the organizer token. A persistent Render blueprint ([`render.yaml`](render.yaml)) is also included for practice links. Details: [docs/event-runbook.md](docs/event-runbook.md#hosting-it-online-for-free). See [`.env.example`](.env.example) for all settings and [docs/event-runbook.md](docs/event-runbook.md) for event-day operations.

## What's in the box

| Area | Highlights |
|---|---|
| Player flow | Landing → create/join team (unguessable code, invite link) → lobby with the rules and the **practice room** → **Begin the investigation** → workspace, act by act → accusation → result |
| Workspace | HTB-style challenge board grouped by act (sealed acts show only category, difficulty and points; category, solves, first blood, "Owned" stamp) beside the tools: **Terminal**, **Caesar Lab**, **Timeline**, **Cheat sheet**, **Notes**. Opening an act shows its briefing and mounts its evidence in the terminal. Case file (story and people), Accuse, Scoreboard. |
| Terminal | ~50 commands with pipes, `;`/`&&`/`||`, globs, `>`/`>>` into `/tmp`, Tab completion and history: `ls -la`, `cd`, `cat`, `head`/`tail`, `grep -rniE -A/-B/-C`, `find`, `tree -a`, `wc`, `sort`, `uniq`, `cut`, `column`, `awk`, `jq`, `tr`, `diff [-u]`, `cmp`, `sha256sum [-c]`, `sha1sum`, `md5sum`, `file`, `exiftool`, `strings`, `xxd`, `hexdump -C`, `base64`, `pdftotext`, `sqlite3` (read-only, `.tables`/`.schema`/`SELECT`), `open` (images inline, PDFs in a tab), `download`. Dotfiles stay hidden until you ask for them. `help <command>` shows examples. |
| Caesar Lab | An empty box, a shift dial and the letter mapping. No brute force and no suggestions. |
| Server rules | Server-authoritative 75-minute timer, acts unlocked by solves (sealed files and challenges answer as if they didn't exist), flags validated server-side only, per-challenge rate limiting, global solve counts and first blood, two-attempt accusation (suspect + motive + up to three files, optional accomplice bonus) that opens with the final act and never explains a rejection |
| Organizers | `/admin`: event settings, emergency pause/resume (deadlines shift), reveal, announcements, per-team open act/extend/reset/regenerate code/remove member, accusation review, CSV export, audit log |
| Accessibility | Keyboard-complete, skip links, focus-managed dialogs, polite live region, on-demand timer announcements, reduced motion, text scaling, high contrast, phone layout |

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | API + web dev servers |
| `npm run build` | Production build of web and API |
| `npm start` | Run the built server |
| `npm run host` | Free event hosting from a laptop: production server + public Cloudflare tunnel link |
| `npm test` | Unit + API integration tests (Vitest) |
| `npm run test:e2e` | Playwright playthrough (desktop + phone); run `npm run build` first |
| `npm run typecheck` | TypeScript across all packages |
| `npm run check:bundle` | Fails if the built client contains flags, the accusation rule, the solution or evidence content |
| `npm run evidence` | Rebuilds the record evidence (door logs, registries, booth logs, ledgers, Wi-Fi log, the Messages database, the practice lists) from one seeded timeline, then re-hashes the intake manifests |
| `npm run photos` | Rebuilds the character portraits and the photo evidence (stage, booth, CCTV, practice cat) from the AI-generated source pictures in `scripts/art/photos/` with one shared camera look (Python 3 + Pillow + numpy); run `npm run assets` after it to add the story EXIF |
| `npm run assets` | Regenerates placeholder artwork and image/PDF evidence (JPEG/PNG/PDF/SVG) with Chromium, then re-hashes the intake manifests |

## Repository layout

```text
apps/
  api/            Fastify + node:sqlite server (teams, timer, flags, accusation, notes, admin)
  web/            React + Vite client
    src/terminal/ The in-browser shell: virtual file system, parser, ~50 commands (pure TS, unit-tested)
packages/shared/  Types and pure logic used by both (Caesar, EXIF reader, rules)
content/
  public/         Story for the Case File page and the venue plan
  evidence/fs/    The evidence tree players explore (~/case404), plus meta.json (timestamps, the act each file opens in)
  training/       The practice room's folder (~/training) and its four tasks
  gated/          Challenges, acts, timeline, accusation options, endings (served as each act opens)
private/organizer Answer key and facilitator sheet — server-only, never web-served
scripts/          Evidence and asset generators, hosting helper, e2e server, dev runner, bundle spoiler check
tests/            unit/, integration/, e2e/
design-system/    Palette, type and interaction rules (MASTER.md)
docs/             Architecture, runbook, QA checklist, decisions
```

## Documentation

- [docs/architecture.md](docs/architecture.md) — components, data model, security and spoiler separation
- [docs/event-runbook.md](docs/event-runbook.md) — before / during / after the event, emergencies
- [docs/qa-checklist.md](docs/qa-checklist.md) — acceptance criteria and how each is verified
- [docs/decisions.md](docs/decisions.md) — choices, corrections and what changed in the revamp
- [design-system/case-404/MASTER.md](design-system/case-404/MASTER.md) — visual and interaction rules

All characters, accounts, payments, messages and places are fictional.
