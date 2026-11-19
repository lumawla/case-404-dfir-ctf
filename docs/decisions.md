# Implementation decisions and brief corrections

Choices made while building from *CASE 404 Implementation Brief v1.0*, and what changed in the revamp. Items marked **correction** fix an inconsistency in the brief.

## Second revamp: three acts and a frame

Feedback on the first revamp: beginners didn't know the commands; some flags could be answered by eye (two short door logs side by side); and the story didn't flow, with no clear motive or timeline. Decisions, agreed with the organizers:

- **The story is a frame-up told in three acts.** Act I, *The Meeting*: MOTH and the anonymous door log point at Lucien. Act II, *The Booth*: Lucien says he was in the photo booth with Salma; Salma says she was alone and shows her print; the booth's own records count two people and see one, because Lucien really is a vampire, and the controller's log shows the door log was edited. Act III, *The Angel*: Salma's phone shows she and Yasmine planned it, and the money explains why. The motive is concrete: Nadia scheduled an email to the Dean about the stolen fundraiser money for 08:00. Lucien is innocent and harmless; he only wanted to see a human party. Yasmine and Salma knew what he was two weeks before.
- **Acts unlock by solving.** Act II opens with both Act I flags; Act III with any two of the three Act II flags, so one hard challenge never blocks a team. Organizers can open an act for a stuck team. Sealed acts show only category, difficulty and points; their titles, text, files and timeline entries are withheld by the server, not hidden by the client. Accusations open with Act III. (This replaces "no act gating" below.)
- **No flag can be read off by eye.** The door logs are 375-row controller exports of the same size, two cells apart. The intake manifest seals the controller's log by hash only, without a path, so teams have to hash the copies to find the real one. The ledgers have ~90 rows. The anonymous post and the interviews don't give the forged credential and time together.
- **Eight challenges, 130 points; 75 minutes by default.** EV06 *Deleted* (a deleted SMS thread recovered with `strings` from a real SQLite file) is new. A read-only `sqlite3` shows the thread is gone from the table, which is the point.
- **"Did anyone help?"** The accusation asks for an optional accomplice: +15 for naming Salma in a correct accusation, nothing lost otherwise. Accusing Salma as the killer is a wrong accusation with its own ending.
- **Help for beginners without guiding the case.** A Cheat sheet tab (and `help <command>`) explains each tool with generic examples (`photo.jpg`, `data.csv`), never case files. The lobby has an unscored practice room with its own small folder and four warm-up tasks (a hidden file, a photo's time, a checksum, a Caesar note). The challenge text still never names a tool.
- **A timeline the team builds.** The Timeline tab starts with what investigators knew at 00:41 and adds entries as challenges are owned; finding the controller's log strikes out the forged entry.
- **Photographs of fictional people.** Character portraits and the photo evidence come from AI-generated pictures of people who don't exist (`scripts/art/photos/`), never photos of real people. `scripts/build-photos.py` crops the portraits to 3:4 and grades everything to one gloomy party-camera look: neutral white balance, matched exposure, deep oxblood shadows, flash falloff, grain. It adds the recorder overlay to the CCTV still; the asset generator then writes the story EXIF. Camera metadata from the sources is never carried over. Lucien still has no picture anywhere.

## The revamp (Hack The Box style)

Feedback on the first version: too easy, too linear, a confusing UI, and the tools did the thinking. The revamp changes the game, not the story.

- **One workspace.** Challenge board on the left, tools on the right (Terminal, Caesar Lab, Notes). Four top-level pages instead of eleven: Workspace, Case file, Accuse, Scores.
- **Evidence is a file system, not a gallery.** `~/case404` holds 36 files with in-world names, from systems that would really produce them (phone extraction, MaskMail server, photo booth, access controller, local recorder, finance share, campus security). Files have no titles or descriptions, and challenges no longer list "their" evidence, so teams have to work out what matters.
- **A real-feeling terminal instead of point-and-click tools.** `ls -a`, `grep -r`, `exiftool`, `sha256sum`, `diff`, `jq`, `awk`, `pdftotext`, `open` and friends, with pipes, globs, history and Tab completion. A file tree is available for people who don't type, but like any file manager it hides dotfiles.
- **Harder puzzles.**
  - EV01: the feed serves a metadata-stripped copy; the original is elsewhere, and the file's own modification time (23:31) is a decoy.
  - EV02: the MaskMail export no longer announces a shift, and it contains a second thread at a different shift.
  - EV03: the full thread is one conversation among several on Nadia's phone.
  - EV04: the device log covers every session, and wristband S02 vs session S02 is a trap.
  - EV05: the manifest seals eight files, not one, and the flag now asks for the exit time as well.
  - EV06: the old ledger is a hidden backup.
- **No hints, no near misses.** Wrong flags all get the same "Incorrect flag." The practice flag and the hint penalty are gone.
- **No act gating** (superseded by the second revamp). Everything opened at Begin.
- **Accusation = suspect + motive + up to three files.** It replaces the "tick the findings" verdict, which was solvable by reading the option labels. The rule needs the right motive and two different files, one for the money and one placing her at the scene. A rejection never says why.
- **Caesar Lab without guidance.** Empty input, a dial, the alphabet mapping. The try-all-shifts table and conversation mode were removed.
- **HTB touches:** categories (Forensics, Crypto, Mobile), Easy/Medium/Hard, global solve counts, first blood, an "Owned" moment, scoreboard ties broken by who got there first.
- **Look:** the organizers' five-colour palette, UnifrakturMaguntia for titles and Crimson Pro for text (see `design-system/case-404/MASTER.md`). Portraits, the cover and the result art were re-rendered on the new palette.
- **Old databases** are renamed to `.bak` on first start rather than migrated: the scoring rules changed, so old teams can't carry over.

## Corrections

1. **Beirut UTC offset — correction.** The brief puts EV-01's `published_at` at `+03:00` but the photo's EXIF at `+02:00`, and §23.9 says to verify the offset. Lebanon's DST ended on Sunday 25 October 2026 (tzdata: EEST→EET at 00:00), so 31 October is **UTC+02:00**. All in-world ISO timestamps use `+02:00`, and a unit test checks this with `Intl`.
2. **Karim's walking time — correction.** §7 says at least 12 minutes one way; §43 (the "hard constraints") says 8. Only 8 works with leaving at 23:44 and paying at the kiosk at 23:52. The venue data, kiosk receipt and timeline all use 8 minutes, and the contradiction is unit-tested.
3. **Intake manifest byte count.** The manifest records the real size of the controller's door log (179 bytes). The door-log hashes match the brief exactly.

## Design choices from the first version (still true unless the revamp section says otherwise)

- **Verdict evidence availability (superseded by the file-based accusation).** "Unlocked evidence" means evidence the team has *established*: initial public records from the start, campus-security records once Act II opens, and each challenge's findings once that flag is solved. A correct verdict therefore needs EV-05 and EV-06 solved, matching §11 ("a strong solution requires evidence from Cases 05 and 06"). Decoy options (leaked screenshot, circulated export, Karim's messages, stream outage, Yasmine's post) let wrong theories be filed with real citations.
- **Richer, non-contradicting fixtures.** Where the brief shows one or two rows, the database-like files have extra realistic rows so the records search and diff tools have something to search and filter: more booth sessions, other vendors in the ledgers, non-MOTH alias sessions, more feed posts. Every row the brief specifies is reproduced exactly.
- **Extra corroboration.** The badge registry has a `projection_room_access` column (a guest wristband like L07 can't open PROJ-EAST), and the vendor statement confirms Black Cat AV received a single payment. Both support the existing conclusions without replacing the core clues.
- **Booth print.** The EV-04 print shows only the booth name and date. Session and time come from the logs and the EXIF, so the flag needs corroboration, not reading one image.
- **Near-miss feedback and the practice flag** were removed in the revamp.
- **Minimum team size** defaults to 2 (brief: default 2–3, organizer can enable solo or four).
- **Wrong-ending texts** are per suspect (§30). The reconstruction is shown to SOLVED teams immediately, and to other *finished* teams after the organizer reveal. The canonical flags table is shown only after the reveal.
- **Join codes** are stored hashed, so organizers regenerate rather than look them up. Players' devices remember the code for the lobby.
- **Artwork** is original, stylized SVG rendered to JPEG/PNG by the asset script (no real people). Portraits share framing and lighting. No suspect gets a distinctive motif on public pages: the cover's angel silhouette is unhighlighted and the solved-case art has no halo.
- **Database.** SQLite (`node:sqlite`) instead of PostgreSQL for a zero-ops single-instance deployment. See architecture.md.
- **Realtime.** 4-second polling, which the brief allows for v1.
