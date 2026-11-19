# CASE 404 — Facilitator answer sheet (ORGANIZERS ONLY)

**Culprit: Yasmine Mansour (The Angel). Accomplice: Salma Nasser (The Witch), her roommate.**

**Motive:** Yasmine had been paying herself out of the fundraiser for the children's ward. Nadia found the duplicate $2,400 "Black Cat AV" payment (`BC-104-DUP`) to Yasmine's own account (…0412) and scheduled an email to the Dean for 08:00. Yasmine had to stop it that night.

**The frame:** On 14 October Salma discovered that Lucien Moreau doesn't show up in photographs. He really is a vampire, and harmless: he only wanted to see a human party. A man who can't be photographed can't prove where he was, so Salma invited him. At 23:50 Salma pulled Lucien into the photo booth and kept him there until 23:55; the booth's seat counted two people and its camera saw one. At 23:53 Salma posted Yasmine's run-through photo from her phone (still signed in to Yasmine's account) so that Yasmine looked onstage. As MOTH, Yasmine had asked Nadia to the projection room at 23:50. Badge A14 went in at 23:49:03. Yasmine killed Nadia, cancelled the scheduled email on Nadia's phone (23:54:31), screenshotted Lucien's plea (23:54:12), left at 23:55:26, exported the door log at 00:00, swapped A14 for L07 in a saved copy at 00:01 and posted it anonymously at 00:03. Then she told Salma to say she'd been alone, and Salma deleted the thread.

All paths are relative to `~/case404` in the in-game terminal. The board opens in acts: **Act II** opens when both Act I flags are owned, **Act III** when any two of the three Act II flags are owned. Organizers can open an act early from the admin page.

## Act I: The Meeting (evidence: incident report, interviews, MaskMail, staff channel, venue, social feed, a few logs)

| # | Challenge | Flag | One way to get it |
|---|---|---|---|
| EV01 | Moth (Crypto, Easy, 10) | `FLAG{PROJECTION_ROOM_2350}` | `cat maskmail/archive_export.txt`, paste thread `c41e` into the Caesar Lab, shift **11** back → "Meet me in the projection room at 11:50." The other threads use shifts **7** and **19**, so one shift never reads the whole file. `tr 'a-zA-Z' 'p-za-oP-ZA-O'` works too. |
| EV02 | The Door (Forensics, Easy, 10) | `FLAG{L07_2349}` | `grep PROJ-EAST staff_channel/attachments/door_log.csv` → `23:49:03 … ENTRY,L07`. This is the **forged** copy; that's the point of Act I. Neither the anonymous post nor the interviews give the credential and time together. |

## Act II: The Booth (adds: photo booth, Nadia's phone, the access controller exports, intake manifest 1, campus security)

| # | Challenge | Flag | One way to get it |
|---|---|---|---|
| EV03 | Not in the Picture (Forensics, Medium, 15) | `FLAG{S27_2352}` | `grep L07 photobooth/sessions.csv` → S27 at 23:51 with S02 (Salma). `grep S27 photobooth/device.log` → `SEAT_SENSOR occupants=2`, `AUTO_EXPOSURE 23:52:00`, `FACE_DETECT faces=1`. Or `exiftool photobooth/DCIM/PB2_0027.jpg`. Salma's print (`interviews/exhibits/salma_booth_print.jpg`) is the same picture with no metadata. Decoys: 23:51 (open), 23:54 (close). Owning EV03 unlocks `interviews/lucien_moreau_2.txt` (his confession: he's a vampire). |
| EV04 | Cropped (Mobile, Medium, 15) | `FLAG{I_DID_NOT_CHANGE_THEM}` | `open staff_channel/attachments/fwd_0003.png` shows only the 23:41 message. `jq -r '.messages[-1].text' phones/nadia_haddad/messenger/lucien_moreau.json` → his 23:43 reply. Bonus: `exiftool` on the PNG → Creation Time 23:54:12, and `phones/nadia_haddad/media_log.csv` shows that screenshot was taken on **Nadia's own phone** after she walked into the room. |
| EV05 | Two Copies (Forensics, Hard, 20) | `FLAG{A14_2355}` | `intake/manifest.json` seals the controller log (DER-404-01) **by hash only, no path**. `sha256sum access_control/exports/*.csv staff_channel/attachments/door_log.csv`: only `ACS-EXP-7731.csv` matches. The logs are 375 rows and the same size, so eyeballing doesn't work; `diff` shows exactly two cells (A14 → L07). A14 in 23:49:03, out **23:55:26**. Decoy: `FLAG{L07_2355}`. `access_control/README.txt` says wristbands open no doors. |

## Act III: The Angel (adds: Salma's phone, Nadia's scheduled mail, social audit + original upload, Wi-Fi, finance, dashboard audit, MaskMail auth, CCTV, intake manifest 2)

| # | Challenge | Flag | One way to get it |
|---|---|---|---|
| EV06 | Deleted (Mobile, Hard, 20) | `FLAG{2355}` | `sqlite3 phones/salma_nasser/sms.db .tables`, then `SELECT * FROM handle` shows Yasmine as handle 1 but `SELECT count(*) FROM message WHERE handle_id = 1` is 0 (ROWID gaps show deletions). `strings phones/salma_nasser/sms.db \| grep -i booth` → "At 11:50 get Lucien into the photo booth and keep him there till **11:55**." Owning EV06 unlocks `interviews/salma_nasser_2.txt` (her confession). |
| EV07 | Halo, Delayed (Forensics, Easy, 15) | `FLAG{2328}` | `cat social/audit/msp-oct31-0442.json` → `attached_media: IMG_4471.jpg`, posted 23:53 from **Salmas-iPhone**. The feed copy has no EXIF; `exiftool social/originals/IMG_4471.jpg` → Date/Time Original 23:28. Decoys: 23:53 (published), 23:30 (file mtime, when Yasmine sent it to Salma). |
| EV08 | Clean Books (Forensics, Hard, 25) | `FLAG{0412}` | `ls -a finance` reveals `finance/.backup/ledger_2026-10-30.csv` (89 lines). `diff finance/expenses_export.csv finance/.backup/ledger_2026-10-30.csv` → the removed `BC-104-DUP` row to **0412** (plus two genuine Oct 31 rows the backup predates). Decoy: 8802 (the vendor's real account, per `pdftotext finance/invoices/BC-104.pdf -`). |

## Accusation (opens with Act III)

Accepted when **suspect = Yasmine**, **motive = "To stop Nadia reporting stolen fundraiser money to the Dean"**, and the cited files (1–3) include one file from each group, each satisfied by a *different* file:

- **Money:** `finance/.backup/ledger_2026-10-30.csv`, `finance/reimbursements/STAFF-2026-18.txt` (0412 is her reimbursement account), `finance/invoices/BC-104.pdf` (the vendor never issued BC-104-DUP), `phones/nadia_haddad/mail/outbox.json` (the email to the Dean), `logs/staff_dashboard_audit.csv` (she deleted the row at 19:12).
- **Scene:** `access_control/exports/ACS-EXP-7731.csv` (A14 in at 23:49), `cctv/nvr8/CAM-03_20261031_234807.jpg` (the angel walking to the projection room door, 23:48:07), `cctv/nvr8/CAM-01_dj_station.csv` (her speech cue fired at 23:50 with the stage mic idle), `logs/maskmail_auth.log` (MOTH = yasmine.treasurer), `phones/salma_nasser/sms.db` (the plan), `network/wifi.log` (her phone upstairs 23:47–23:56), `social/originals/IMG_4471.jpg` and `social/audit/msp-oct31-0442.json` (the alibi photo is from 23:28 and was posted from Salma's phone), `logs/staff_dashboard_audit.csv` (the export, edit and anonymous share).

**"Did anyone help?"** is optional. Naming **Salma** in a correct accusation earns **+15**. Naming the wrong helper, or no one, costs nothing; it only matters if the accusation itself holds.

The server answers only "holds" or "doesn't hold" and never says which part was wrong. First wrong attempt −10, second wrong attempt closes the case.

## Timeline players build

Known at the start: 23:47 stream down, 23:50–23:55 incident window, 00:03 anonymous accusation, 00:06 body found. Each owned challenge adds entries (Timeline tab). EV05 strikes through EV02's "L07 opened the door" entry and replaces it with "A14 (Yasmine) in 23:49, out 23:55".

| When | What | Source |
|---|---|---|
| 14 Oct | Salma: Lucien isn't in any of her photos. Yasmine: "Useful." | sms.db (deleted) |
| 29 Oct | BC-104-DUP, 2,400 to 0412 | backup ledger |
| 31 Oct 19:12 | Yasmine deletes the row from the export | dashboard audit |
| 21:38 | Nadia schedules the email to the Dean for 08:00 | Nadia's outbox |
| 21:50 | "Get Lucien into the photo booth and keep him there till 11:55" | sms.db (deleted) |
| 23:28 | Run-through photo of Yasmine onstage | IMG_4471 EXIF |
| 23:34–23:37 | MOTH sets the meeting for 23:50 | MaskMail |
| 23:43 | Lucien: "I did not change them." | Nadia's messenger |
| 23:49:03 | A14 into the projection room | controller export |
| 23:50:05 | Speech cue fires; stage mic idle | CAM-01 / console log |
| 23:51–23:54 | Lucien and Salma in booth S27 | booth device log |
| 23:53 | Alibi post from Salmas-iPhone | social audit |
| 23:54:12 / :31 | Screenshot on Nadia's phone; email cancelled | media log, outbox |
| 23:55:26 | A14 out | controller export |
| 00:01:03 | Edited door-log copy saved | dashboard audit |
| 00:03:40 | Anonymous post with the edited log | staff channel |

## Common wrong theories

- **Lucien:** the crop, the posted log, the missing photos. Refuted by the booth (EV03), the full thread (EV04) and the controller's own log, where wristbands open no doors (EV05). Ending: he only wanted to see a human party.
- **Salma:** she lied and helped, but she was in the booth with Lucien during the killing. Accusing her as the killer is wrong; naming her as the helper is the bonus.
- **Karim:** threats, the costume, K02 denied at 22:26. Refuted by `campus_security/`: gate exit 23:44, kiosk receipt 23:52:47, an 8-minute walk.
- **Tara:** the stream died at 23:47 and the GHOSTLIGHT thread points at her. Refuted by `cctv/nvr8/CAM-01_dj_station.csv` (at the console 23:47–23:57). The "inflated AV invoices" motive is wrong: the invoice is legitimate.
- **Yasmine with weak files** (only the stage photo, or only the backup): rejected, because it needs both money and scene.

## Practice room (lobby, unscored)

`ls -a` → `.secret_note` → `FLAG{LANTERN}` · `exiftool cat.jpg` → `FLAG{0915}` · `sha256sum lists/*.csv` vs `lists/checksums.txt` → B was edited → `FLAG{B}` · `note.txt` shift 3 → `FLAG{PUMPKIN}`.

## Facilitating

Do: explain how a command works (`help ls`, `help exiftool`, the Cheat sheet tab, pipes), the flag format (24-hour HHMM, underscores) and what a hash is for. Point beginners at the practice room before they start. Don't: point to files, name shifts, or confirm a suspect, flag or theory. If a team is stuck for a long time at an act boundary, open the next act for them from the admin page (it's logged).

Scoring: flags 10/10/15/15/20/20/15/25 = 130; correct accusation +40; accomplice +15; first wrong accusation −10; score never below 0. Max 185. Ties: whoever reached the score first.
