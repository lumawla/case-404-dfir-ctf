import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadContent } from "../../apps/api/src/content";
import { caesar } from "../../packages/shared/src/caesar";
import { readExif } from "../../packages/shared/src/exif";
import { isWellFormedFlag, normalizeFlag } from "../../packages/shared/src/flags";
import { CHALLENGE_ACT, CHALLENGE_IDS, CHALLENGE_POINTS, computeScore, earnedAct } from "../../packages/shared/src/rules";
import type { ChallengeId } from "../../packages/shared/src/types";
import { formatCountdown } from "../../packages/shared/src/time";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const content = loadContent(path.join(root, "content"), path.join(root, "private/organizer/answers.json"));
const caseDir = path.join(root, "content/evidence/fs/case404");
const bytes = (p: string) => readFileSync(path.join(caseDir, p));
const text = (p: string) => bytes(p).toString("utf8");
const json = (p: string) => JSON.parse(text(p));
const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

/** Minimal CSV reader for the fixtures (handles quoted fields with commas). Skips the header. */
function csv(p: string): string[][] {
  return text(p)
    .trim()
    .split("\n")
    .slice(1)
    .map((line) => {
      const cells: string[] = [];
      let cell = "";
      let quoted = false;
      for (const ch of line) {
        if (ch === '"') quoted = !quoted;
        else if (ch === "," && !quoted) {
          cells.push(cell);
          cell = "";
        } else cell += ch;
      }
      return [...cells, cell];
    });
}
const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h < 12 ? h + 24 : h) * 60 + m;
};

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe("evidence file system", () => {
  it("loads every file with metadata, including the hidden backup", () => {
    expect(content.root).toBe("case404");
    expect(content.files.size).toBe(walk(caseDir).length);
    expect(content.files.has("finance/.backup/ledger_2026-10-30.csv")).toBe(true);
    expect([...content.files.keys()].every((p) => !/EV0\d|PUB_|REC_/.test(p))).toBe(true);
  });

  it("stores text evidence as UTF-8 with LF line endings, one trailing newline and no BOM", () => {
    for (const [p, f] of content.files) {
      if (!/\.(csv|txt|log|json)$/.test(p)) continue;
      expect(f.bytes[0], p).not.toBe(0xef);
      expect(f.bytes.includes(0x0d), p).toBe(false);
      expect(f.bytes[f.bytes.length - 1], p).toBe(0x0a);
    }
  });

  it("only documents have a text layer for pdftotext", () => {
    for (const [p, f] of content.files) expect(f.text !== null, p).toBe(p.endsWith(".pdf"));
  });

  it("the practice folder loads on its own, with a hidden note and four tasks", () => {
    expect(content.training.root).toBe("training");
    expect([...content.training.files.keys()].sort()).toEqual([".secret_note", "README.txt", "cat.jpg", "lists/checksums.txt", "lists/guests_a.csv", "lists/guests_b.csv", "note.txt"]);
    expect(content.training.tasks.map((t) => t.id)).toEqual(["hidden", "metadata", "integrity", "cipher"]);
    for (const t of content.training.tasks) expect(isWellFormedFlag(content.answers.practice[t.id]), t.id).toBe(true);
  });

  it("practice: one list matches the recorded checksum and the other differs in one cell, not in size", () => {
    const dir = path.join(root, "content/training/fs/training/lists");
    const a = readFileSync(path.join(dir, "guests_a.csv"));
    const b = readFileSync(path.join(dir, "guests_b.csv"));
    expect(readFileSync(path.join(dir, "checksums.txt"), "utf8")).toContain(`${sha256(a)}  guests.csv`);
    expect(sha256(b)).not.toBe(sha256(a));
    expect(b.length).toBe(a.length);
    expect(a.toString().split("\n").length).toBeGreaterThan(200);
    const diff = a.toString().split("\n").filter((l, i) => l !== b.toString().split("\n")[i]);
    expect(diff).toHaveLength(1);
    expect(readExif(new Uint8Array(readFileSync(path.join(root, "content/training/fs/training/cat.jpg"))))!.DateTimeOriginal).toBe("2026:10:01 09:15:00");
    expect(caesar(readFileSync(path.join(root, "content/training/fs/training/note.txt"), "utf8"), 3, true)).toContain("The password is PUMPKIN");
  });
});

describe("acts: every challenge is solvable from evidence open in its act", () => {
  const NEEDS: Record<string, string[]> = {
    EV01: ["maskmail/archive_export.txt"],
    EV02: ["staff_channel/attachments/door_log.csv"],
    EV03: ["photobooth/sessions.csv", "photobooth/device.log", "photobooth/DCIM/PB2_0027.jpg"],
    EV04: ["phones/nadia_haddad/messenger/lucien_moreau.json"],
    EV05: ["access_control/exports/ACS-EXP-7731.csv", "access_control/exports/ACS-EXP-7734.csv", "intake/manifest.json"],
    EV06: ["phones/salma_nasser/sms.db"],
    EV07: ["social/originals/IMG_4471.jpg"],
    EV08: ["finance/.backup/ledger_2026-10-30.csv", "finance/expenses_export.csv"],
  };

  it("maps challenges to acts as I-I, II-II-II, III-III-III", () => {
    expect(CHALLENGE_IDS.map((id) => CHALLENGE_ACT[id])).toEqual([1, 1, 2, 2, 2, 3, 3, 3]);
    for (const c of content.challenges.values()) expect(c.act, c.id).toBe(CHALLENGE_ACT[c.id]);
  });

  it("puts each challenge's evidence in its own act, never a later one", () => {
    for (const [id, files] of Object.entries(NEEDS)) {
      for (const f of files) {
        const file = content.files.get(f);
        expect(file, f).toBeDefined();
        expect(file!.unlock.act, `${id} needs ${f}`).toBe(CHALLENGE_ACT[id as ChallengeId]);
        expect(file!.unlock.solved, f).toBeNull();
      }
    }
  });

  it("keeps later evidence sealed: Act I has none of the booth, phones, controller or money", () => {
    const act1 = [...content.files.values()].filter((f) => f.unlock.act === 1).map((f) => f.path);
    expect(act1.some((p) => /^(photobooth|phones|access_control|finance|network|cctv|intake)\//.test(p))).toBe(false);
    expect(act1).toContain("staff_channel/attachments/door_log.csv");
    expect(content.files.get("interviews/lucien_moreau_2.txt")!.unlock).toEqual({ act: 2, solved: "EV03" });
    expect(content.files.get("interviews/salma_nasser_2.txt")!.unlock).toEqual({ act: 3, solved: "EV06" });
  });

  it("opens Act II with both Act I flags and Act III with any two Act II flags", () => {
    expect(earnedAct(["EV01"])).toBe(1);
    expect(earnedAct(["EV01", "EV02"])).toBe(2);
    expect(earnedAct(["EV01", "EV02", "EV05"])).toBe(2);
    expect(earnedAct(["EV01", "EV02", "EV03", "EV05"])).toBe(3);
    expect(earnedAct(["EV04", "EV05"], 2)).toBe(3);
    expect(earnedAct([], 3)).toBe(3);
  });

  it("every accusation group can be cited in Act III without any challenge-gated file", () => {
    for (const [group, files] of Object.entries(content.answers.verdict.groups)) {
      expect(files.some((f) => content.files.get(f)!.unlock.act <= 3 && !content.files.get(f)!.unlock.solved), group).toBe(true);
    }
  });
});

describe("integrity: the door logs and the intake manifest", () => {
  const CONTROLLER = "access_control/exports/ACS-EXP-7731.csv";
  const EDITED = "access_control/exports/ACS-EXP-7734.csv";
  const POSTED = "staff_channel/attachments/door_log.csv";

  it("keeps the fixed digests of the door logs; the posted copy is the edited export", () => {
    expect(sha256(bytes(CONTROLLER))).toBe("4359805ecab2319a510bc4e2f81c20535b7cc0551b980e710ac0d671ab8ce0ad");
    expect(sha256(bytes(EDITED))).toBe("7e558ccd7bd539a2d128956f47b640d987b6672b190ec2690e22e0f3b8a6c792");
    expect(bytes(POSTED).equals(bytes(EDITED))).toBe(true);
  });

  it("is too long to compare by eye: hundreds of rows, same size, two cells apart", () => {
    const a = csv(CONTROLLER);
    const b = csv(EDITED);
    expect(a.length).toBeGreaterThan(300);
    expect(bytes(CONTROLLER).length).toBe(bytes(EDITED).length);
    const changed = a.flatMap((r, i) => (r.join() === b[i].join() ? [] : [[r, b[i]]]));
    expect(changed).toEqual([
      [
        ["2026-10-31 23:49:03", "PROJ-EAST", "ENTRY", "A14", "GRANTED"],
        ["2026-10-31 23:49:03", "PROJ-EAST", "ENTRY", "L07", "GRANTED"],
      ],
      [
        ["2026-10-31 23:55:26", "PROJ-EAST", "EXIT", "A14", "GRANTED"],
        ["2026-10-31 23:55:26", "PROJ-EAST", "EXIT", "L07", "GRANTED"],
      ],
    ]);
  });

  it("seals the controller log by hash only (no path), and never a second-hand copy", () => {
    const manifest = json("intake/manifest.json");
    const controller = manifest.sealed.find((s: { item: string }) => s.item === "DER-404-01");
    expect(controller.path).toBeUndefined();
    expect(controller.sha256).toBe(sha256(bytes(CONTROLLER)));
    for (const m of ["intake/manifest.json", "intake/manifest_2.json"]) {
      for (const s of json(m).sealed.filter((x: { path?: string }) => x.path)) {
        expect(sha256(bytes(s.path)), s.path).toBe(s.sha256);
        expect(bytes(s.path).length, s.path).toBe(s.bytes);
        expect(s.path.startsWith("staff_channel/") || s.path.includes(".backup"), s.path).toBe(false);
      }
    }
    expect(text("intake/manifest.json")).not.toContain(sha256(bytes(EDITED)));
  });
});

describe("story continuity", () => {
  it("credentials: A14 Yasmine, L07 Lucien, S02 Salma, T09 Tara, N01 Nadia; K02 deactivated; wristbands open no doors", () => {
    const badges = Object.fromEntries(csv("access_control/badges.csv").map((r) => [r[0], r]));
    expect(badges.A14[1]).toBe("Yasmine Mansour");
    expect(badges.T09[1]).toBe("Tara Rahal");
    expect(badges.N01[1]).toBe("Nadia Haddad");
    expect(badges.K02[4]).toBe("DEACTIVATED 2026-10-18");
    expect(badges.L07).toBeUndefined();
    const reg = Object.fromEntries(csv("venue/registration.csv").map((r) => [r[0], r]));
    expect(reg.L07.slice(0, 3)).toEqual(["L07", "Lucien Moreau", "guest wristband"]);
    expect(reg.L07[5]).toMatch(/camera shy/);
    expect(reg.S02[1]).toBe("Salma Nasser");
    expect(text("access_control/README.txt")).toMatch(/wristband/i);
    expect(csv("access_control/exports/ACS-EXP-7731.csv").filter((r) => r[3] === "L07" || r[3] === "S02")).toEqual([]);
  });

  it("Act I: MOTH set the meeting; the anonymous post came before the body was found", () => {
    expect(text("logs/maskmail_auth.log")).toMatch(/23:33:05 .* session open alias=MOTH account=yasmine\.treasurer src=10\.31\.0\.14/);
    const channel = text("staff_channel/messages.log");
    expect(channel.indexOf("00:03:40] anonymous")).toBeLessThan(channel.indexOf("Nadia has been found"));
    expect(channel).not.toMatch(/anonymous:.*(23:49|11:49|L07)/);
  });

  it("EV03: Lucien and Salma in S27: two on the seat, one face, exposure 23:52; her print has no metadata", () => {
    expect(csv("photobooth/sessions.csv").filter((r) => r[0] === "S27")).toEqual([
      ["S27", "23:51", "L07", "Lucien Moreau"],
      ["S27", "23:51", "S02", "Salma Nasser"],
    ]);
    const s27 = text("photobooth/device.log").split("\n").filter((l) => l.includes(" S27 "));
    expect(s27.find((l) => l.includes("SEAT_SENSOR"))).toMatch(/occupants=2/);
    expect(s27.find((l) => l.includes("FACE_DETECT"))).toMatch(/faces=1/);
    expect(s27.find((l) => l.includes("AUTO_EXPOSURE"))).toMatch(/23:52:00 S27 AUTO_EXPOSURE .*PB2_0027\.jpg/);
    expect(s27.find((l) => l.includes("SESSION_AUTO_CLOSE"))).toMatch(/23:54:00/);
    expect(readExif(new Uint8Array(bytes("photobooth/DCIM/PB2_0027.jpg")))!.DateTimeOriginal).toBe("2026:10:31 23:52:00");
    expect(readExif(new Uint8Array(bytes("interviews/exhibits/salma_booth_print.jpg")))).toBeNull();
  });

  it("EV04: the full thread has Lucien's denial; the screenshot was taken on Nadia's phone at 23:54:12", () => {
    const last = json("phones/nadia_haddad/messenger/lucien_moreau.json").messages.at(-1);
    expect(last).toMatchObject({ from: "LUCIEN", time: "2026-10-31 23:43", text: "I did not change them. Please keep this between us." });
    expect(text("phones/nadia_haddad/media_log.csv")).toContain("2026-10-31 23:54:12,Screenshot 2026-10-31 at 23.54.12.png,screenshot");
    expect(bytes("staff_channel/attachments/fwd_0003.png").toString("latin1")).toContain("Creation Time\u00002026:10:31 23:54:12");
    const outbox = json("phones/nadia_haddad/mail/outbox.json").outbox[0];
    expect(outbox).toMatchObject({ scheduled_for: "2026-11-01T08:00:00+02:00", status: "CANCELLED", cancelled_at: "2026-10-31T23:54:31+02:00" });
  });

  it("EV05: the controller has A14 in at 23:49:03 and out at 23:55:26, and Yasmine's phone upstairs in between", () => {
    const rows = csv("access_control/exports/ACS-EXP-7731.csv").filter((r) => r[1] === "PROJ-EAST" && r[0] > "2026-10-31 23:40");
    expect(rows.map((r) => `${r[0].slice(11)} ${r[2]} ${r[3]}`)).toEqual(["23:49:03 ENTRY A14", "23:50:11 ENTRY N01", "23:55:26 EXIT A14"]);
    const wifi = text("network/wifi.log");
    expect(wifi).toMatch(/23:47:52 .*host=Yasmines-iPhone from=BACKSTAGE to=AP-2F-CORRIDOR/);
    expect(wifi).toMatch(/23:56:31 .*host=Yasmines-iPhone from=AP-2F-CORRIDOR/);
    expect(wifi).toMatch(/23:49:58 .*host=Salmas-iPhone from=MAIN-FLOOR to=AP-BOOTH/);
    expect(readExif(new Uint8Array(bytes("cctv/nvr8/CAM-03_20261031_234807.jpg")))!.DateTimeOriginal).toBe("2026:10:31 23:48:07");
  });

  it("EV06: Salma's Yasmine thread is gone from the live table but still in the file's free space", () => {
    const db = new DatabaseSync(path.join(caseDir, "phones/salma_nasser/sms.db"), { readOnly: true });
    const live = db.prepare("SELECT handle_id, text FROM message").all() as { handle_id: number; text: string }[];
    db.close();
    expect(live.filter((m) => m.handle_id === 1)).toEqual([]);
    expect(live.some((m) => m.text === "salma i literally watched you pull him in")).toBe(true);
    const raw = bytes("phones/salma_nasser/sms.db").toString("latin1");
    expect(raw).toContain("At 11:50 get Lucien into the photo booth and keep him there till 11:55.");
    expect(raw).toContain("he isn't in ANY of them");
    expect(raw).toContain("If anyone asks, you were alone in the booth.");
  });

  it("EV07: the post went live at 23:53 from Salma's phone; the photo was taken at 23:28; the feed copy has no EXIF", () => {
    const audit = json("social/audit/msp-oct31-0442.json");
    expect(audit).toMatchObject({ attached_media: "IMG_4471.jpg", published_at: "2026-10-31T23:53:00+02:00", publish_method: "manual", reactions_at_export: 87 });
    expect(audit.session).toMatchObject({ device_name: "Salmas-iPhone", ip: "10.31.4.88" });
    const exif = readExif(new Uint8Array(bytes("social/originals/IMG_4471.jpg")))!;
    expect(exif).toMatchObject({ Model: "Canon EOS R50", DateTimeOriginal: "2026:10:31 23:28:00", OffsetTimeOriginal: "+02:00" });
    expect(readExif(new Uint8Array(bytes("social/cdn/msp-oct31-0442_1080.jpg")))).toBeNull();
    expect(text("phones/salma_nasser/media_log.csv")).toContain("2026-10-31 23:52:58,IMG_4471.jpg,upload,MASKED Social,posted as @yasmine.angel");
    expect(text("cctv/nvr8/CAM-01_dj_station.csv")).toMatch(/23:50:05,.*Speech cue fired.*stage mic idle/);
  });

  it("EV08: the backup keeps a duplicate to 0412 (Yasmine's account) that the export dropped; the vendor's is 8802", () => {
    const current = csv("finance/expenses_export.csv");
    const backup = csv("finance/.backup/ledger_2026-10-30.csv");
    expect(backup.filter((r) => !current.some((c) => c.join() === r.join()))).toEqual([["2026-10-29", "Black Cat AV", "2400", "0412", "Yasmine Mansour", "BC-104-DUP"]]);
    expect(new Set(current.filter((r) => r[1] === "Black Cat AV").map((r) => r[3]))).toEqual(new Set(["8802"]));
    expect(backup.length).toBeGreaterThan(80);
    expect(text("finance/reimbursements/STAFF-2026-18.txt")).toMatch(/Claimant: Yasmine Mansour[\s\S]*last four digits\): 0412/);
    expect(content.files.get("finance/invoices/BC-104.pdf")!.text).toContain("ending 8802");
  });

  it("the dashboard audit shows the erased row, the export, the edited copy and the anonymous share", () => {
    const audit = csv("logs/staff_dashboard_audit.csv").map((r) => r.slice(0, 4).join(" "));
    expect(audit).toContain("2026-10-31 19:12:44 yasmine.treasurer finance/expenses_export.csv DELETE_ROW");
    expect(audit).toContain("2026-11-01 00:00:21 yasmine.treasurer acs/ACS-EXP-7731 EXPORT");
    expect(audit).toContain("2026-11-01 00:01:03 yasmine.treasurer acs/ACS-EXP-7734 SAVE_EDITED_COPY");
    expect(audit).toContain("2026-11-01 00:03:40 yasmine.treasurer acs/ACS-EXP-7734 SHARE_ANONYMOUS");
  });

  it("venue: the booth is at least 4 minutes from the projection room and the kiosk 8 minutes from the gate", () => {
    const venue = JSON.parse(readFileSync(path.join(root, "content/public/venue.json"), "utf8")) as { routes: { from: string; to: string; minutes: number }[] };
    expect(venue.routes.find((r) => r.from === "booth" && r.to === "projection")!.minutes).toBeGreaterThanOrEqual(4);
    expect(venue.routes.find((r) => r.from === "gate" && r.to === "kiosk")!.minutes).toBe(8);
  });

  it("wrong suspects are refuted: Karim off campus, Tara at the console", () => {
    const exit = csv("campus_security/GATE-N_index.csv").find((r) => r[2] === "EXIT" && r[3].includes("G04"))!;
    expect(exit[0].startsWith("23:44")).toBe(true);
    expect(text("campus_security/moonrise_kiosk.txt")).toContain("2026-10-31 23:52:47");
    expect(minutes("23:44") + 8).toBe(minutes("23:52"));
    expect(text("cctv/nvr8/CAM-01_dj_station.csv")).toMatch(/23:52:18,NVR-8 CAM-01,.*T09 at the mixing console/);
  });

  it("Lucien has no portrait and is not the photographer; Salma is a witness", () => {
    const lucien = content.caseFile.suspects.find((s: { id: string }) => s.id === "lucien");
    expect(lucien.portrait).toBeNull();
    expect(lucien.portraitNote).toMatch(/camera shy/i);
    expect(JSON.stringify(content.caseFile)).not.toMatch(/photographer/i);
    expect(content.caseFile.witnesses.map((w: { id: string }) => w.id)).toEqual(["salma"]);
    expect(existsSync(path.join(root, "apps/web/public/portraits/lucien.jpg"))).toBe(false);
    expect(existsSync(path.join(root, "apps/web/public/portraits/salma.jpg"))).toBe(true);
  });

  it("Karim is consistently named and never a zombie prom king", () => {
    const all = walk(path.join(root, "content")).filter((f) => /\.(json|txt|csv|log)$/.test(f)).map((f) => readFileSync(f, "utf8")).join("\n");
    expect(all).not.toMatch(/zombie|prom king/i);
    expect(all).toContain("Karim Darwish");
  });
});

describe("challenges, acts and the accusation rule", () => {
  it("has eight challenges worth 130 points with HTB-style metadata", () => {
    expect([...content.challenges.keys()]).toEqual(CHALLENGE_IDS);
    expect(Object.values(CHALLENGE_POINTS).reduce((a, b) => a + b, 0)).toBe(130);
    for (const c of content.challenges.values()) {
      expect(["Forensics", "Crypto", "Mobile", "OSINT", "Misc"]).toContain(c.category);
      expect(["Easy", "Medium", "Hard"]).toContain(c.difficulty);
      expect(c.format).toMatch(/^FLAG\{[A-Z_]+\}/);
    }
  });

  it("never guides: no tools, file names, hints or techniques in challenge or act text", () => {
    const texts = [...[...content.challenges.values()].map((c) => [c.id, `${c.title} ${c.description} ${c.format}`]), ...content.acts.map((a) => [`act ${a.n}`, `${a.title} ${a.intro}`])];
    for (const [id, t] of texts) {
      expect(t, id).not.toMatch(/exif|metadata|hash|sha|caesar|shift|cipher|diff\b|grep|strings|sqlite|terminal|backup|hidden|ls -a|hint|\.(csv|jpg|png|log|json|txt|pdf|db)\b|\//i);
    }
  });

  it("the timeline only adds what each challenge proves, and EV05 strikes the forged door entry", () => {
    expect(Object.keys(content.timeline.solved).sort()).toEqual([...CHALLENGE_IDS].sort());
    const ev05 = content.timeline.solved.EV05![0];
    expect(ev05.replaces).toBe(content.timeline.solved.EV02![0].id);
    for (const e of [...content.timeline.baseline, ...Object.values(content.timeline.solved).flat()]) expect(Number.isNaN(Date.parse(e.at)), e.id).toBe(false);
    expect(JSON.stringify(content.timeline.baseline)).not.toMatch(/Yasmine|Salma|A14/);
  });

  it("every flag matches its format, and every accusation file exists", () => {
    for (const id of CHALLENGE_IDS) expect(isWellFormedFlag(content.answers.flags[id])).toBe(true);
    const rule = content.answers.verdict;
    expect(content.verdict.suspects.map((s) => s.id)).toEqual(["yasmine", "lucien", "karim", "tara", "salma"]);
    expect(content.verdict.suspects.map((s) => s.id)).toContain(rule.suspect);
    expect(content.verdict.suspects.map((s) => s.id)).toContain(rule.accomplice);
    expect(content.verdict.motives.map((m) => m.id)).toContain(rule.motive);
    for (const p of Object.values(rule.groups).flat()) expect(content.files.has(p), p).toBe(true);
    for (const id of ["solved", "solved_accomplice", "wrong_lucien", "wrong_karim", "wrong_tara", "wrong_salma", "wrong_yasmine", "expired", "active"]) {
      expect(content.verdict.endings[id], id).toBeDefined();
    }
  });
});

describe("spoiler separation", () => {
  const flags = Object.values(content.answers.flags);
  const playerFiles = [
    ...walk(path.join(root, "content")),
    ...walk(path.join(root, "apps/web/src")),
    ...walk(path.join(root, "apps/web/public")),
    ...walk(path.join(root, "packages/shared/src")),
  ].filter((f) => !/\.(jpg|png|pdf)$/.test(f));

  it("no canonical flag appears in player content, the web source or shared code", () => {
    for (const f of playerFiles) {
      const body = readFileSync(f, "utf8");
      for (const flag of flags) expect(body.includes(flag), `${flag} found in ${path.relative(root, f)}`).toBe(false);
    }
  });

  it("the accusation rule, the story's answers and the reconstruction stay out of the web client", () => {
    const web = walk(path.join(root, "apps/web/src")).map((f) => readFileSync(f, "utf8")).join("\n");
    expect(web).not.toContain(content.verdict.reconstruction.stinger);
    expect(web).not.toMatch(/yasmine\.treasurer|BC-104-DUP|ACS-EXP-7731|keep him there/);
    expect(web).not.toMatch(/accomplice:\s*"salma"|suspect:\s*"yasmine"/);
  });

  it("the answer key lives outside the served content tree", () => {
    expect(walk(path.join(root, "content")).some((f) => f.endsWith("answers.json"))).toBe(false);
  });
});

describe("flags, score and clock helpers", () => {
  it("normalizes flags by trimming and uppercasing ASCII only", () => {
    expect(normalizeFlag("  flag{projection_room_2350}\n")).toBe("FLAG{PROJECTION_ROOM_2350}");
    expect(normalizeFlag("FLAG{11:50}")).toBe("FLAG{11:50}");
    expect(isWellFormedFlag(normalizeFlag("FLAG{11:50}"))).toBe(false);
    expect(isWellFormedFlag("FLAG{}")).toBe(false);
  });
  it("never lets the score go below zero", () => {
    expect(computeScore(10, 16)).toBe(0);
    expect(computeScore(185, 10)).toBe(175);
  });
  it("formats the countdown", () => {
    expect(formatCountdown(3_600_000)).toBe("60:00");
    expect(formatCountdown(61_500)).toBe("01:02");
  });
});
