# QA checklist

Legend: **A** = automated test · **M** = manual check before the event · file references point to the test.

## Challenge and fairness

| Criterion | How verified |
|---|---|
| A new player understands the crime, the people and the task within 3 minutes | M — lobby rules + Case file page with pilot teams |
| Beginners can learn the tools without being guided through the case | A — `terminal.test.ts` "cheat sheet" (no case file names or facts; every listed command exists); e2e practice room; M — a beginner pilot uses the practice room first |
| The story flows: MOTH and the door log → Lucien → the booth and the forged log → Salma's phone and the money | A — `content.test.ts` "acts" (each challenge's evidence opens in its own act) and "story continuity"; M — pilot debrief |
| No flag can be read off by eye | A — `content.test.ts` (375-row door logs of equal size two cells apart; the manifest seals the controller log by hash only; the anonymous post never gives credential and time together) |
| Nothing guides: no hints, no near-miss messages, no tool or file names in challenge text, no descriptions on files | A — `content.test.ts` "never guides", `api.test.ts` "no near-miss feedback" and file listing keys |
| The Caesar Lab starts empty and never suggests a shift | A — e2e checks the empty input; `CaesarLab.tsx` has no brute-force view |
| One shift never decodes the whole MaskMail export | A — `caesar.test.ts` (threads use shifts 11, 7 and 19) |
| The hidden backup is found only by asking for dotfiles | A — `terminal.test.ts` (`ls` vs `ls -a`, `tree -a`, `find`, Tab completion) |
| Murderer deducible from independent records, not costume | A — accusation needs suspect + motive + a money file + a different scene file (`api.test.ts`) |
| Every wrong suspect has a refuting record in the tree | A — `content.test.ts` continuity (booth for Lucien and Salma, gate/kiosk for Karim, DJ recorder for Tara) |
| Sealed acts leak nothing: no titles, intros, challenge text, files or timeline entries | A — `api.test.ts` "answers sealed files and sealed challenges as if they didn't exist"; `check:bundle` |
| Karim consistently named; never a zombie prom king | A — `content.test.ts` |
| Two blind beginner pilots reach Act III in 75 min, incl. a phone | M |
| An experienced CTF player can't shortcut via the UI, bundle or file names | A — `check:bundle`, spoiler tests; M — inspect the network tab |

## Functional

| Criterion | How verified |
|---|---|
| Team invite by code; everyone sees the same status | A — `api.test.ts`, e2e |
| Timer starts only on Begin; default 75 minutes | A — `api.test.ts` "starts the 75-minute clock only on Begin…" |
| Acts open for the whole team: Act II with both Act I flags, Act III with two Act II flags; new evidence mounts without losing the terminal | A — `api.test.ts` "acts", `terminal.test.ts` "mounting new evidence", e2e playthrough |
| Organizers can open an act for a stuck team, audit-logged | A — `api.test.ts` "opens an act early…" |
| Timer survives refresh, clock tampering, device change | A — server-side deadline + rejoin reclaim (`api.test.ts`); M — refresh during play |
| Correct flag scores once; wrong scores nothing | A — `api.test.ts` incl. concurrent submissions |
| Solves and first blood are shared across teams | A — `api.test.ts` "tracks solves and first blood" |
| All eight flags reachable with the in-game terminal and Caesar Lab | A — e2e playthrough |
| The deleted thread is invisible to SQL and visible to `strings` | A — `content.test.ts` EV06, `terminal.test.ts` sqlite3 |
| Terminal commands behave like their Linux counterparts on the evidence | A — `terminal.test.ts` |
| Door-log hashes are fixed; the manifests seal only originals | A — `content.test.ts` |
| Accusation opens with Act III and validates suspect, motive, accomplice and paths without spending an attempt | A — `api.test.ts` |
| Accomplice bonus: +15 for Salma in a correct accusation; nothing lost otherwise | A — `api.test.ts`, e2e |
| Practice room works before Begin and never touches the score | A — `api.test.ts` "practice room", e2e |
| First wrong accusation −10 and one retry; second closes | A — `api.test.ts`, e2e |
| Server never returns flags, the rule or the culprit before resolution | A — `api.test.ts` spoiler suite |
| Admin export and notes not reachable by other teams | A — `api.test.ts` |
| An old database is moved aside, not deleted | M — start the server on a v2 `data/case404.db` |

## UI and accessibility

| Criterion | How verified |
|---|---|
| Keyboard-only completion | M — full keyboard pass (terminal, board, dialogs) |
| Mobile portrait supports everything | A — `mobile.spec.ts` (Pixel 7, no horizontal scroll) |
| Contrast ≥ 4.5:1 for text | Design — `tokens.css` header lists the ratios |
| Reduced motion | M — Settings → Reduce motion; OS setting |
| Audio optional and never carries information | Design — chime off by default |

## Event readiness

| Criterion | How verified |
|---|---|
| Artifact bytes and hashes frozen | A — `content.test.ts`; generated files committed |
| Two practice teams reach both endings | M |
| Facilitator runbook and answer sheet | `docs/event-runbook.md`, `private/organizer/ANSWER_KEY.md` |
| Time extension without restarting a team | A — `api.test.ts` "extends a timed-out team…" |
| Scoreboard privacy approved | M — team names only (A: payload keys checked) |
| Scheduled reveal doesn't leak to teams still playing | A — reconstruction only for finished teams after reveal (`api.test.ts`) |
