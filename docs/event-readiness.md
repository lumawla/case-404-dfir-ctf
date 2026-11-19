# Event readiness review — 3 November 2026

Work is on `fix/event-readiness`. No production deployment or live-data reset was performed. Case narrative, evidence bytes, canonical flags, shared scoring constants, accusation criteria, and penalties are unchanged.

## Confirmed fixes and participant behavior

- **Session impersonation:** a join code and nickname no longer reclaim a member. Recovery requires the member's private bearer credential, available through **Team lobby → My private recovery key → Show my recovery key**. Save it privately, then enter it under **Recover my existing membership** on another device. Existing authenticated cookies can also recover their own membership. Recovery reuses the credential without rotating or invalidating existing sessions. It works on full teams and after registration closes. Organizer revocation and logout invalidate it; logout on one recovered device signs that membership out on every device. If both cookie and key are lost, ask an organizer to remove the old seat and join under a new nickname when registration is open. Team investigation progress stays on the server.
- **Registration:** closing registration blocks both team creation and new memberships. Disabling team creation alone still permits invitations. Full teams reject additional members; verified recovery does not add a seat.
- **Notes:** Done flushes immediately and waits for completion. Requests are serialized; edits during a save use the returned version in the next request. Failures keep the editor and text available with an error and Retry save. Conflicts require choosing Mine or Theirs. Pending edits trigger a browser unload warning. A disconnected unsaved draft has not reached the server: keep the editor open and retry before leaving.
- **Organizer settings:** polling continues updating the dashboard; locally edited fields survive polls. Save sends only edited fields, avoiding overwriting emergency controls or another organizer's unrelated changes.
- **Evidence:** authenticated case bytes, PDF text, and practice bytes use `Cache-Control: no-store`. Session creation, recovery, and logout request browser cache clearing. MIME types, inline/download disposition and the PDF-specific CSP remain intact. Previously downloaded evidence and already-open documents cannot be recalled; these changes prevent subsequent unauthorized access through HTTP caching. The case data provider is keyed by team identity.
- **Start controls:** new events default to Begin disabled, with the existing 2–3 member defaults. Organizers must enable **Teams may press Begin**. Existing databases retain their existing settings; verify that checkbox before admitting players. Team sizes remain configurable from 1 through 4 with minimum ≤ maximum.
- **Accusations:** every request includes the expected attempt number. Repeated requests and two devices confirming the same attempt cannot consume the following attempt. The confirmation explicitly warns that success or a final failure closes the case and further scoring. The client also guards duplicate clicks. Scored handlers read current team state before acting.
- **Pause/extension:** an expired team's extension is evaluated against the frozen pause timestamp, allowing it to reopen during a long pause and receive the normal resume shift.
- **Persistence/deployment:** schema version remains **3**. Incompatible databases now stop startup without replacement, renaming, or reset. The host helper always builds current source. Builds seal both client and server artifacts in a release manifest, and built-server startup refuses missing/stale files or changed checkout sources. HTML revalidates. The Render blueprint now provisions a persistent paid disk with automatic deploys disabled. Docker build context excludes all data and environment secrets; the private answer key stays server-side.

## Verification actually executed

Environment: Windows, Node 22.16.0, Playwright Chromium 156; mobile uses Pixel 7 emulation.

| Check | Result |
| --- | --- |
| Baseline `npm test` | 108 passed |
| New regression harness against original source | 14 failures reproduced; only temporary component exports were added for mounting. All modified files restored afterwards. |
| Final `npm test` | 125 passed across 7 files, including unit and API integration tests |
| `npm run typecheck` | Passed |
| `npm run build` | Passed: both production bundles and release manifest |
| `npm run check:bundle` | Passed: 56 public files, 49 spoiler patterns; no client source maps |
| `npm run test:e2e` | 5 passed: full two-person case, practice, private recovery, browser session-switch cache checks, mobile smoke |
| Two-person playthrough | All eight challenges, act unlocks, shared note rapid close, offline/reconnect, refresh, wrong accusation, successful accusation with accomplice, result and scoreboard |
| `node scripts/smoke-production.mjs` | Passed against a disposable database: real production startup, secure cookie attributes, private-file boundary, HTML revalidation, restart persistence and verified backup |
| Database persistence | Sessions, join code, settings, solves, notes, deadline and progress survive close/reopen; incompatible schemas 0, 2 and 4 refused without changing the file |
| Evidence / rules preservation | Git diff of `content/`, `private/`, and `packages/shared/` is empty |

An initial expanded E2E run failed because the test did not dismiss the second player's act briefing before clicking Notes. The test was corrected to dismiss the existing intended dialog. The final suite passes.

### Load rehearsal

Run from the repository root, after building:

```powershell
npx playwright install chromium
$env:LOAD_SECONDS = '120'
npm run test:load
```

Defaults: 60 isolated authenticated Chromium contexts, 30 two-person teams, 120-second soak. `LOAD_SECONDS`, `LOAD_PARTICIPANTS` (even, 2–60), and `LOAD_PORT` can be set. The script starts only a localhost server with fresh random secrets and a new temporary SQLite database. It refuses an occupied port. It creates/joins/starts through the normal API, loads all workspaces together, runs terminal commands, writes one shared note per member, submits the same correct flag concurrently from both teammates and checks one award per team, lets the real UI poll, then reloads every browser and checks memberships and both shared notes. It never connects to the deployed event or resets its database.

Executed rehearsal: **60 participants, 60-second soak**, zero captured JavaScript/HTTP errors; 1,780 browser-observed API requests. All 60 refresh/progress checks passed. Sixty simultaneous correct submissions produced exactly 30 awards and 30 already-solved responses.

| Measurement | p50 | p95 | p99 |
| --- | ---: | ---: | ---: |
| Browser, all phases | 11 ms | 356 ms | 880 ms |
| Browser, steady state | 4 ms | 53 ms | 90 ms |
| Server processing, steady state | 1.1 ms | 12 ms | 17 ms |

An earlier run sharing the workstation with E2E browsers had zero errors but browser p95 11.9 seconds. The uncontended repeats separate arrival/refresh and steady-state measurements. The table records the final run with concurrent scoring checks. Server log durations measure request processing and exclude time queued before admission. This is a single-machine rehearsal, not a distributed network benchmark. Results are written to ignored `test-results/load-results.json`; temporary rehearsal databases are retained outside the repository for inspection.

## Release gates and limitations

No known application blocker remains in the executed local checks. Before the event, verify the **actual** HTTPS reverse proxy, persistent disk mount, stable secrets, database backup/restore, and organizer Begin/registration settings on the release host. Hosting-provider deployment, Docker image execution, a distributed 60-device test, and physical iOS/Android testing were not executed here. Docker is not installed on this workstation. These infrastructure checks remain release gates.

Keep one API process/replica per SQLite database. Do not horizontally scale this configuration. A deployment with schema other than 3 is blocked until its database is explicitly migrated and tested offline. Do not bypass the version check or select a fresh path to work around it. Do not use the old free/ephemeral Render deployment for the event; existing services must actually be moved to the disk configuration. This patch does not migrate provider data automatically.

## Exact source-host deployment (PowerShell)

These are operator instructions; they were not executed against a live host. Make the reviewed fix commit available in the private release-host checkout first; commands below assume its local `fix/event-readiness` branch exists. Use an HTTPS reverse proxy pointing to localhost:8787. Configure it to forward the real scheme/IP, bypass caching for `/api/`, and allow inline PDFs. Do not expose the repository root as a static directory. Stop the existing server gracefully before switching revisions. Keep the proxy on a maintenance page until checks finish.

1. In the currently deployed checkout, record the revision and actual database path. Preserve the **existing** ADMIN_TOKEN and APP_SECRET in the service's secret store; do not generate replacements for an existing event. If using `npm run host`, retain `data/event-secrets.json` privately as well. Select the real existing database, not a new empty location.

```powershell
Set-Location 'C:\Users\User\Desktop\Personal\Coding\dfir'
$previousRelease = git rev-parse HEAD
$releaseRevision = git rev-parse fix/event-readiness
# Replace only this example path with the deployment's EXISTING absolute database path.
$eventDatabase = 'C:\Users\User\Desktop\Personal\Coding\dfir\data\case404.db'
$snapshotPath = "$eventDatabase.pre-release-$(Get-Date -Format yyyyMMdd-HHmmss).snapshot"
# Stop the existing service gracefully now, using its service manager or Ctrl+C.
git switch --detach $releaseRevision
node scripts/backup-db.mjs $eventDatabase $snapshotPath
if ($LASTEXITCODE -ne 0) { throw 'Backup failed: stop deployment' }
npm ci --include=dev
if ($LASTEXITCODE -ne 0) { throw 'Install failed' }
npm run typecheck
if ($LASTEXITCODE -ne 0) { throw 'Typecheck failed' }
npm test
if ($LASTEXITCODE -ne 0) { throw 'Tests failed' }
npm run build
if ($LASTEXITCODE -ne 0) { throw 'Build failed' }
npm run check:bundle
if ($LASTEXITCODE -ne 0) { throw 'Spoiler check failed' }
node scripts/smoke-production.mjs
if ($LASTEXITCODE -ne 0) { throw 'Production smoke failed' }
$env:NODE_ENV = 'production'
$env:DATABASE_PATH = $eventDatabase
$env:HOST = '127.0.0.1'
$env:PORT = '8787'
$env:TRUST_PROXY = '1'
# ADMIN_TOKEN and APP_SECRET must already contain the unchanged service secrets.
if (!$env:ADMIN_TOKEN -or !$env:APP_SECRET) { throw 'Load the existing service secrets first' }
npm start
```

2. From a second terminal, check `Invoke-RestMethod http://127.0.0.1:8787/api/health`. Through the public HTTPS URL, check the organizer dashboard, existing team counts/scores/notes, a retained participant session, and image/PDF viewing using an authorized rehearsal team. Never reset a live team for verification. Restart once and confirm the same records remain.
3. Confirm registration and **Teams may press Begin** are deliberately set. Existing event settings are preserved. Have participants reload their tabs to load the new accusation client. Remove maintenance only after validation. Keep the release revision, previous revision, snapshot path and unchanged secrets in the private operations record.

The manifest is generated output: do not copy an old manifest into a new checkout. Run root `npm run build`, not only a workspace build. Source changes after building intentionally block startup until rebuilt. Do not run source updates or `npm run host` while participants are playing.

## Docker and Render

For Docker, build `docker build -t case404:event-ready .` before the maintenance window. Use a **named volume or bind mount** for `/app/data`, and an existing private environment file for stable ADMIN_TOKEN and APP_SECRET. For an existing deployment, reuse its actual volume and database. Do not use an anonymous replacement volume. Example for a prepared named volume:

```powershell
docker run -d --name case404 --restart unless-stopped --env-file 'C:\secure\case404.env' -e TRUST_PROXY=1 -p 127.0.0.1:8787:8787 --mount source=case404-data,target=/app/data case404:event-ready
```

The environment file must use `DATABASE_PATH=/app/data/case404.db` and the unchanged secrets. Keep the image private because it includes the server's organizer answer key. Run the container behind HTTPS. Do not run `docker compose down -v`, `docker volume rm`, or use a new volume when replacing the container. Verify a snapshot and retained team state before switching traffic.

For Render, review/apply the repository blueprint's Starter plan, `/var/data` disk and `DATABASE_PATH=/var/data/case404.db`. Back up and transfer any existing database explicitly before switching from an ephemeral service; copy it with the server stopped or use a consistent SQLite snapshot. Preserve APP_SECRET and ADMIN_TOKEN. Keep automatic deploys disabled. Confirm the actual disk is attached before opening the event.

## Rollback without losing scores

Keep maintenance enabled and stop the new service gracefully. Since this patch does not change schema 3, roll back **code only**, using the current database and unchanged secrets:

```powershell
git switch --detach $previousRelease
npm ci --include=dev
if ($LASTEXITCODE -ne 0) { throw 'Install failed' }
npm run build
if ($LASTEXITCODE -ne 0) { throw 'Build failed' }
# Keep NODE_ENV, DATABASE_PATH, ADMIN_TOKEN, APP_SECRET, HOST and TRUST_PROXY unchanged.
npm start
```

For containers, stop the replacement and start the previously recorded image with the **same named volume, environment file and port binding**. For Render, select the recorded previous code release while retaining the disk and secret values. Verify team state before removing maintenance.

Do not restore the pre-release snapshot for an ordinary code rollback: that would discard investigation progress made after the backup. If there is confirmed database corruption, stop all writers and retain the damaged database plus its WAL/SHM files before a separately approved recovery from a verified snapshot. Prefer a previously verified secure release; the original pre-fix application has the confirmed impersonation and other defects, so restoring it is a maintenance fallback, not an event-ready release.
