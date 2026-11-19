import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { loadFiles } from "../../apps/api/src/content";
import { CHEATSHEET } from "../../apps/web/src/terminal/cheatsheet";
import { Shell, type FileIO, type Out } from "../../apps/web/src/terminal/shell";
import { Vfs } from "../../apps/web/src/terminal/vfs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { root: caseRoot, files } = loadFiles(path.join(root, "content/evidence"));
const listing = { root: caseRoot, files: [...files.values()].map((f) => ({ path: f.path, size: f.bytes.length, modified: f.modified, mime: f.mime })), revision: "all" };

const opened: string[] = [];
const io: FileIO = {
  read: async (node) => new Uint8Array(files.get(node.casePath!)!.bytes),
  pdfText: async (node) => files.get(node.casePath!)!.text ?? "",
  objectUrl: async (node) => `blob:${node.name}`,
  download: async () => {},
  openInNewTab: (url) => void opened.push(url),
};

let sh: Shell;
beforeEach(() => {
  sh = new Shell(new Vfs(listing), io);
  sh.cd("case404");
});

/** Runs a line and returns what a player would see as plain text. */
async function run(line: string): Promise<string> {
  const out = await sh.run(line);
  return out.map(toText).filter((x) => x !== null).join("\n");
}
const toText = (o: Out): string | null =>
  o.kind === "text" ? o.text : o.kind === "rich" ? o.lines.map((l) => l.map((s) => s.t).join("")).join("\n") : o.kind === "image" ? `[image ${o.name}]` : o.kind === "link" ? `[link ${o.label}]` : null;

describe("navigation", () => {
  it("starts in the evidence tree and hides dotfiles unless asked", async () => {
    expect(sh.prompt).toEqual({ user: "investigator@der-forensics", path: "~/case404" });
    expect(await run("ls -1")).toContain("finance");
    expect(await run("ls finance")).not.toContain(".backup");
    expect(await run("ls -a finance")).toContain(".backup");
    expect(await run("ls -la finance/.backup")).toMatch(/-r--r--r-- +1 der evidence +\d+ Oct 30 23:59 ledger_2026-10-30.csv/);
    expect(await run("cd finance/.backup && pwd")).toBe("/home/investigator/case404/finance/.backup");
    expect(await run("cd ~ && ls")).toBe("case404");
    expect(await run("cd nowhere")).toBe("cd: nowhere: No such file or directory");
  });

  it("finds hidden files with find and tree -a", async () => {
    expect(await run('find . -name "*.csv" -path "*backup*"')).toBe("./finance/.backup/ledger_2026-10-30.csv");
    expect(await run("tree finance")).not.toContain(".backup");
    expect(await run("tree -a finance")).toContain(".backup");
  });

  it("completes commands and paths with Tab, dotfiles only when typed", () => {
    expect(sh.complete("exif").line).toBe("exiftool ");
    expect(sh.complete("cat fin").line).toBe("cat finance/");
    expect(sh.complete("ls finance/").options).not.toContain(".backup/");
    expect(sh.complete("ls finance/.").line).toBe("ls finance/.backup/");
    expect(sh.complete("cat social/o").line).toBe("cat social/originals/");
  });
});

describe("reading and searching", () => {
  it("cats, pipes, greps recursively and counts", async () => {
    expect(await run("cat incident_report.txt | head -n 1")).toBe("BLACKTHORN HALL - INCIDENT DOSSIER");
    expect(await run("grep -rl MOTH .")).toBe(["logs/maskmail_auth.log", "maskmail/archive_export.txt"].join("\n"));
    expect(await run("grep -c 'alias=MOTH' logs/maskmail_auth.log")).toBe("4");
    expect(await run("grep 'MOTH\\|GHOSTLIGHT' logs/maskmail_auth.log | wc -l")).toBe("7");
    expect(await run("grep -E 'S27' photobooth/device.log | grep EXPOSURE")).toContain("23:52:00 S27 AUTO_EXPOSURE");
    expect(await run("grep PROJ-EAST staff_channel/attachments/door_log.csv | tail -n 1")).toBe("2026-10-31 23:55:26,PROJ-EAST,EXIT,L07,GRANTED");
    expect(await run("cat social/originals/IMG_4471.jpg")).toMatch(/binary data, \d+ bytes not shown/);
  });

  it("slices CSV and JSON with cut, sort, awk, column and jq", async () => {
    expect(await run("cut -d, -f4 access_control/exports/ACS-EXP-7731.csv | sort -u | grep -c .")).toBe("24");
    expect(await run("awk -F, '$4 == \"A14\" && $2 == \"PROJ-EAST\" {print $1, $3}' access_control/exports/ACS-EXP-7731.csv")).toBe(
      "2026-10-31 23:49:03 ENTRY\n2026-10-31 23:55:26 EXIT",
    );
    expect(await run("column -t -s, access_control/badges.csv | head -n 1")).toMatch(/^badge +holder +role +doors +status/);
    expect(await run("jq -r '.messages[] | select(.from == \"LUCIEN\") | .text' phones/nadia_haddad/messenger/lucien_moreau.json | tail -n 1")).toBe(
      "I did not change them. Please keep this between us.",
    );
    expect(await run("jq '.posts | length' social/feed_export.json")).toBe("7");
  });

  it("decodes the MaskMail thread with tr (for players who know it) and leaves the other threads at other shifts", async () => {
    expect(await run("sed")).toBe("sed: command not found");
    const moth = await run("tail -n 1 maskmail/archive_export.txt | tr 'a-zA-Z' 'p-za-oP-ZA-O'");
    expect(moth).toBe("Not over text. Meet me in the projection room at 11:50. Come alone.");
    const decoyLine = "head -n 14 maskmail/archive_export.txt | tail -n 1";
    expect(await run(`${decoyLine} | tr 'a-zA-Z' 'p-za-oP-ZA-O'`)).not.toMatch(/stream/);
    expect(await run(`${decoyLine} | tr 'a-zA-Z' 't-za-sT-ZA-S'`)).toMatch(/^Encoder keeps dropping frames/);
  });
});

describe("forensic tools", () => {
  it("reads EXIF: the original keeps capture time, the feed copy does not", async () => {
    const original = await run("exiftool social/originals/IMG_4471.jpg");
    expect(original).toMatch(/Date\/Time Original +: 2026:10:31 23:28:00/);
    expect(original).toMatch(/File Modification Date\/Time +: 2026:10:31 23:30:41\+02:00/);
    expect(await run("exiftool -DateTimeOriginal social/originals/IMG_4471.jpg")).toBe("Date/Time Original              : 2026:10:31 23:28:00");
    expect(await run("exiftool social/cdn/msp-oct31-0442_1080.jpg")).not.toContain("Date/Time Original");
    expect(await run("exiftool photobooth/DCIM/PB2_0027.jpg")).toMatch(/Date\/Time Original +: 2026:10:31 23:52:00/);
    expect(await run("exiftool interviews/exhibits/salma_booth_print.jpg")).not.toContain("Date/Time Original");
  });

  it("reads PNG text metadata: the screenshot was made at 23:54:12 and marked up", async () => {
    const png = await run("exiftool staff_channel/attachments/fwd_0003.png");
    expect(png).toMatch(/Creation Time +: 2026:10:31 23:54:12/);
    expect(png).toMatch(/Software +: iOS 19\.1 Markup/);
    expect(await run("exiftool -CreationTime staff_channel/attachments/fwd_0003.png")).toBe("Creation Time                   : 2026:10:31 23:54:12");
  });

  it("hashes files: only the controller's export matches the hash sealed at intake", async () => {
    const manifest = JSON.parse(readFileSync(path.join(root, "content/evidence/fs/case404/intake/manifest.json"), "utf8"));
    const sealed = manifest.sealed.find((s: { item: string }) => s.item === "DER-404-01").sha256;
    const sums = await run("sha256sum access_control/exports/*.csv staff_channel/attachments/door_log.csv");
    expect(sums.split("\n").filter((l) => l.startsWith(sealed))).toEqual([`${sealed}  access_control/exports/ACS-EXP-7731.csv`]);
    expect(await run("md5sum incident_report.txt")).toMatch(/^[0-9a-f]{32}  incident_report.txt$/);
    expect(await run(`echo "${sealed}  access_control/exports/ACS-EXP-7734.csv" > /tmp/check && sha256sum -c /tmp/check`)).toMatch(/ACS-EXP-7734.csv: FAILED/);
  });

  it("diffs the door logs and the ledgers", async () => {
    expect(await run("diff staff_channel/attachments/door_log.csv access_control/exports/ACS-EXP-7731.csv")).toBe(
      [
        "367c367",
        "< 2026-10-31 23:49:03,PROJ-EAST,ENTRY,L07,GRANTED",
        "---",
        "> 2026-10-31 23:49:03,PROJ-EAST,ENTRY,A14,GRANTED",
        "375c375",
        "< 2026-10-31 23:55:26,PROJ-EAST,EXIT,L07,GRANTED",
        "---",
        "> 2026-10-31 23:55:26,PROJ-EAST,EXIT,A14,GRANTED",
      ].join("\n"),
    );
    expect(await run("cmp access_control/exports/ACS-EXP-7734.csv staff_channel/attachments/door_log.csv")).toBe("");
    const ledgers = await run("diff finance/expenses_export.csv finance/.backup/ledger_2026-10-30.csv");
    expect(ledgers).toContain("86a87\n> 2026-10-29,Black Cat AV,2400,0412,Yasmine Mansour,BC-104-DUP");
    expect(await run("diff -u finance/expenses_export.csv finance/.backup/ledger_2026-10-30.csv")).toContain("+2026-10-29,Black Cat AV,2400,0412,Yasmine Mansour,BC-104-DUP");
  });

  it("identifies types, dumps bytes and extracts PDF text", async () => {
    expect(await run("file social/originals/IMG_4471.jpg")).toMatch(/JPEG image data, .*Exif standard.*1600x1067/);
    expect(await run("file staff_channel/attachments/fwd_0003.png")).toMatch(/PNG image data, \d+ x \d+/);
    expect(await run("file finance/invoices/BC-104.pdf")).toMatch(/PDF document, version 1\.\d/);
    expect(await run("file access_control/badges.csv")).toMatch(/CSV ASCII text/);
    expect(await run("file phones/salma_nasser/sms.db")).toMatch(/SQLite 3\.x database, .*database pages 3, .*UTF-8/);
    expect(await run("xxd -l 4 social/originals/IMG_4471.jpg")).toMatch(/^00000000: ffd8 ffe0/);
    expect(await run("pdftotext finance/invoices/BC-104.pdf - | grep '^Remit'")).toBe("Remit to: Black Cat AV operating account ending 8802");
    expect(await run("strings -n 8 social/originals/IMG_4471.jpg | grep Canon")).toContain("Canon EOS R50");
  });

  it("queries the Messages database: the Yasmine thread is gone from the table, but strings still finds it", async () => {
    expect(await run("sqlite3 phones/salma_nasser/sms.db .tables")).toBe("handle  message");
    expect(await run("sqlite3 phones/salma_nasser/sms.db 'SELECT * FROM handle WHERE ROWID = 1'")).toBe("1|+961 70 555 014|Yasmine M.");
    expect(await run("sqlite3 phones/salma_nasser/sms.db 'SELECT count(*) FROM message WHERE handle_id = 1'")).toBe("0");
    expect(await run("sqlite3 -header phones/salma_nasser/sms.db \"SELECT date, text FROM message WHERE handle_id = 3 ORDER BY date LIMIT 1\"")).toBe(
      "date|text\n2026-10-31 23:58:12|who was the vampire you dragged into the booth lol",
    );
    expect(await run("sqlite3 phones/salma_nasser/sms.db 'SELECT ROWID FROM message' | head -n 3")).toBe("4\n7\n8");
    expect(await run("sqlite3 phones/salma_nasser/sms.db 'SELECT nope FROM message'")).toBe("Error: no such column: nope");
    expect(await run("strings phones/salma_nasser/sms.db | grep -c 'keep him there till 11:55'")).toBe("1");
    expect(await run("sqlite3 incident_report.txt .tables")).toBe("Error: file is not a database");
  });

  it("opens images inline and PDFs in a new tab", async () => {
    expect(await run("open staff_channel/attachments/fwd_0003.png")).toBe("[image fwd_0003.png]");
    expect(await run("open finance/invoices/BC-104.pdf")).toMatch(/opened in a new tab/);
    expect(opened).toContain("blob:BC-104.pdf");
  });
});

describe("mounting new evidence", () => {
  it("adds an act's files in place, keeping /tmp, history and the working directory", async () => {
    const act1 = { ...listing, files: listing.files.filter((f) => files.get(f.path)!.unlock.act === 1) };
    const shell = new Shell(new Vfs(act1), io);
    shell.cd("case404");
    await shell.run("cd interviews");
    await shell.run("echo kept > /tmp/scratch.txt");
    expect(shell.vfs.stat("/home/investigator/case404/photobooth")).toBeNull();
    const act2 = { ...listing, files: listing.files.filter((f) => files.get(f.path)!.unlock.act <= 2 && !files.get(f.path)!.unlock.solved) };
    const added = shell.vfs.mount(act2);
    expect(added).toContain("photobooth/device.log");
    expect(added).not.toContain("incident_report.txt");
    expect(shell.cwd).toBe("/home/investigator/case404/interviews");
    expect((await shell.run("cat /tmp/scratch.txt"))[0]).toMatchObject({ text: "kept" });
    expect(shell.vfs.mount(act2)).toEqual([]);
  });
});

describe("practice folder", () => {
  const training = loadFiles(path.join(root, "content/training"));
  const tio: FileIO = { ...io, read: async (node) => new Uint8Array(training.files.get(node.casePath!)!.bytes) };
  const practiceListing = { root: training.root, files: [...training.files.values()].map((f) => ({ path: f.path, size: f.bytes.length, modified: f.modified, mime: f.mime })), revision: "practice" };

  it("supports every warm-up task with the same tools", async () => {
    const p = new Shell(new Vfs(practiceListing), tio);
    p.cd("training");
    const out = async (line: string) => (await p.run(line)).map(toText).filter((x) => x !== null).join("\n");
    expect(await out("ls")).not.toContain(".secret_note");
    expect(await out("cat .secret_note")).toContain("FLAG{LANTERN}");
    expect(await out("exiftool -DateTimeOriginal cat.jpg")).toBe("Date/Time Original              : 2026:10:01 09:15:00");
    const sums = await out("sha256sum lists/guests_a.csv lists/guests_b.csv");
    const recorded = (await out("grep -v '^#' lists/checksums.txt")).split(" ")[0];
    expect(recorded).toMatch(/^[0-9a-f]{64}$/);
    expect(sums.split("\n").find((l) => l.startsWith(recorded))).toContain("guests_a.csv");
    expect(await out("tail -n 1 note.txt | tr 'D-ZA-Cd-za-c' 'A-Za-z'")).toBe("The password is PUMPKIN.");
  });
});

describe("shell behaviour", () => {
  it("expands globs, keeps the evidence read-only and lets players write to /tmp", async () => {
    expect(await run("ls interviews/*an*")).toContain("interviews/yasmine_mansour.txt");
    expect(await run("echo hi > notes.txt")).toBe("bash: notes.txt: Read-only file system");
    expect(await run("rm incident_report.txt")).toBe("rm: cannot remove 'incident_report.txt': Read-only file system");
    expect(await run("grep MOTH logs/maskmail_auth.log > /tmp/moth.txt; wc -l /tmp/moth.txt")).toBe("4 /tmp/moth.txt");
    expect(await run("nonsense")).toBe("nonsense: command not found");
    expect(await run("false_cmd && echo no || echo yes")).toContain("yes");
    expect(await run("echo 'unterminated")).toMatch(/unexpected EOF/);
    expect(await run("sudo cat /etc/shadow")).toMatch(/not in the sudoers file/);
  });

  it("lists every visible command in help, and shows examples for one", async () => {
    const help = await run("help");
    for (const c of ["ls", "cd", "cat", "grep", "exiftool", "sha256sum", "diff", "jq", "awk", "pdftotext", "open", "download", "strings", "xxd", "find", "sqlite3"]) expect(help).toContain(c);
    expect(help).not.toMatch(/caesar|rot13/i);
    const exif = await run("help exiftool");
    expect(exif).toContain("Examples:");
    expect(exif).toContain("exiftool -DateTimeOriginal photo.jpg");
  });
});

describe("cheat sheet", () => {
  const text = JSON.stringify(CHEATSHEET);

  it("teaches tools with made-up files, never the case's own", () => {
    const names = new Set([...files.keys()].flatMap((p) => p.split("/")).filter((n) => n.length > 3 && !["DCIM", "logs"].includes(n)));
    for (const n of names) expect(text.includes(n), n).toBe(false);
    expect(text).not.toMatch(/MOTH|Nadia|Lucien|Yasmine|Salma|A14|L07|0412|S27|11:55|23:\d\d/);
  });

  it("only shows commands the terminal has, and every example runs", async () => {
    const commands = CHEATSHEET.flatMap((s) => s.entries).map((e) => e.cmd).filter((c) => /^[a-z0-9]+$/.test(c));
    for (const c of commands) expect(await run(`help ${c}`), c).not.toMatch(/no help topics/);
    expect(await run("echo SGVsbG8= | base64 -d")).toBe("Hello");
    expect(await run("echo Khoor | tr 'D-ZA-Cd-za-c' 'A-Za-z'")).toBe("Hello");
  });
});
