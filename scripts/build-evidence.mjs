#!/usr/bin/env node
// Builds the long, record-style evidence files from one consistent timeline:
//
//   npm run evidence
//
// Door logs (the controller's export and the edited copy), the badge and guest registries, the
// photo booth records, the expense ledgers, the Wi-Fi log and Salma's Messages database (with a
// deleted conversation still recoverable from its free space). Output is deterministic (seeded),
// committed, and re-hashed into the intake manifests. Hand-written files (interviews, chats,
// reports) live directly in content/evidence/fs and are not touched here.

import { createHash } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { writeIntakeManifests } from "./lib/intake-manifest.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const caseDir = path.join(root, "content/evidence/fs/case404");
const out = (p, text) => {
  mkdirSync(path.dirname(path.join(caseDir, p)), { recursive: true });
  writeFileSync(path.join(caseDir, p), text);
};
const lines = (rows) => `${rows.join("\n")}\n`;

// Deterministic PRNG (mulberry32), so every run writes the same bytes.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(0x407);
const int = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

// Clock helpers. Seconds since 2026-10-31 00:00 local (+02:00); past midnight rolls into Nov 1.
const T = (hhmmss) => {
  const [h, m, s = 0] = hhmmss.split(":").map(Number);
  return h * 3600 + m * 60 + s;
};
const stamp = (sec) => {
  const day = sec >= 86400 ? "2026-11-01" : "2026-10-31";
  const t = sec % 86400;
  const p = (n) => String(n).padStart(2, "0");
  return `${day} ${p(Math.floor(t / 3600))}:${p(Math.floor((t % 3600) / 60))}:${p(t % 60)}`;
};
const hhmm = (sec) => stamp(sec).slice(11, 16);

// ---------------------------------------------------------------------------------------------
// People

const STAFF = [
  { id: "N01", name: "Nadia Haddad", role: "chair", doors: "ALL", costume: "Fortune teller", checkin: "18:41" },
  { id: "A14", name: "Yasmine Mansour", role: "treasurer", doors: "ALL", costume: "Angel", checkin: "18:44" },
  { id: "T09", name: "Tara Rahal", role: "DJ and AV lead", doors: "STAFF-ENT;BACKSTAGE;AV-STORE;STAIR-E;PROJ-EAST", costume: "Mad scientist", checkin: "17:58" },
  { id: "T10", name: "Hadi Saab", role: "AV crew", doors: "STAFF-ENT;BACKSTAGE;AV-STORE;STAIR-E", costume: "Staff (black tee)", checkin: "18:02" },
  { id: "T11", name: "Mira Saad", role: "lighting", doors: "STAFF-ENT;BACKSTAGE;AV-STORE;STAIR-E", costume: "Staff (black tee)", checkin: "18:05" },
  { id: "P03", name: "Ziad Khoury", role: "event photographer", doors: "STAFF-ENT;BACKSTAGE", costume: "Staff (black tee)", checkin: "19:20" },
  { id: "M01", name: "Sami Aoun", role: "building manager", doors: "ALL", costume: "Staff (lanyard)", checkin: "17:30" },
  { id: "SEC1", name: "Fouad Badr", role: "security", doors: "STAFF-ENT;BACKSTAGE;CATERING;STAIR-E;OFFICE-2F", costume: "Security vest", checkin: "18:00" },
  { id: "SEC2", name: "Jana Ayoub", role: "security", doors: "STAFF-ENT;BACKSTAGE;CATERING;STAIR-E;OFFICE-2F", costume: "Security vest", checkin: "18:00" },
  ...["Rawad Tannous", "Zeina Ghanem", "Marc Sfeir", "Layal Bou Saab", "Samir Nakhle"].map((name, i) => ({
    id: `C0${i + 1}`,
    name,
    role: "catering",
    doors: "STAFF-ENT;CATERING",
    costume: "Catering whites",
    checkin: `18:${String(10 + i * 4).padStart(2, "0")}`,
  })),
  ...["Christelle Wakim", "Ali Zein", "Maria Azar", "Ralph Kassis", "Tamara Najjar", "Joe Hatem", "Perla Dib", "Wassim Harb"].map((name, i) => ({
    id: `V0${i + 1}`,
    name,
    role: "volunteer",
    doors: i < 3 ? "STAFF-ENT;BACKSTAGE;CATERING" : "STAFF-ENT;BACKSTAGE",
    costume: pick(["Bat", "Raven", "Skeleton", "Witch", "Grim reaper"]),
    checkin: `19:${String(5 + i * 3).padStart(2, "0")}`,
  })),
];
const DEACTIVATED = { id: "K02", name: "Karim Darwish", role: "former co-organizer", doors: "ALL", status: "DEACTIVATED 2026-10-18" };

const COSTUMES = [
  "Skeleton", "Black cat", "Werewolf", "Mummy", "Ghost bride", "Scarecrow", "Plague doctor", "Banshee", "Medusa", "Devil",
  "Pirate ghost", "Headless horseman", "Grim reaper", "Bat", "Spider queen", "Jack-o'-lantern", "Haunted doll", "Raven", "Witch", "Frankenstein's monster",
];
const GUEST_NAMES = [
  "Rana Aoun", "Jad Saleh", "Maya Khoury", "Rami Fares", "Nour Abboud", "Elie Daher", "Georges Abi Nader", "Lina Chami", "Fadi Rizkallah", "Yara Hajj",
  "Nadine Fakhoury", "Bilal Itani", "Sara Mouawad", "Hassan Jaber", "Rita Saliba", "Karen Chidiac", "Elias Moussa", "Mona Halabi", "Charbel Daou", "Lara Nehme",
  "Kevin Abou Jaoude", "Rania Ezzeddine", "Tony Feghali", "Nayla Sarkis", "Ghassan Tabet", "Dima Rached", "Walid Hobeika", "Yasmina Tohme", "Antoine Bitar", "Carla Khalife",
  "Nabil Shehadeh", "Reem Assaf", "Patrick Nassif", "Hala Ghosn", "Sami Kanaan", "Joanna Freiha", "Michel Rahme", "Leila Barakat", "Omar Zahreddine", "Tala Mikati",
];
// Guests the story names; everyone else is filler with a generated costume.
const FIXED_GUESTS = {
  G04: { name: "Karim Darwish", costume: "Masked slasher (hockey mask, foam prop machete)", checkin: "22:19" },
  G08: { name: "Lea Karam", costume: "Skeleton", checkin: "21:10" },
  G11: { name: "Omar Khalil", costume: "Pumpkin king", checkin: "20:55" },
  G17: { name: "Celine Matar", costume: "Witch", checkin: "21:48" },
  G25: { name: "Hiba Sayegh", costume: "Medusa", checkin: "22:02" },
  G31: { name: "Dana Rizk", costume: "Banshee", checkin: "23:20" },
};
const GUESTS = [];
let gi = 0;
for (let n = 1; n <= 46; n++) {
  const id = `G${String(n).padStart(2, "0")}`;
  const fixed = FIXED_GUESTS[id];
  GUESTS.push(
    fixed
      ? { id, ...fixed }
      : { id, name: GUEST_NAMES[gi++ % GUEST_NAMES.length], costume: pick(COSTUMES), checkin: hhmm(T("19:50") + int(0, 200) * 60) },
  );
}
GUESTS.push({ id: "L07", name: "Lucien Moreau", costume: "Vampire", checkin: "21:02" });
GUESTS.push({ id: "S02", name: "Salma Nasser", costume: "Witch (black hat, black lace dress)", checkin: "21:37" });

// ---------------------------------------------------------------------------------------------
// Guest registry (Act I): who got which credential at the coat check

{
  const rows = ["credential,name,credential_type,costume_registered,checked_in,id_photo"];
  for (const s of STAFF) rows.push(`${s.id},${s.name},staff,${s.costume},${s.checkin},OK`);
  for (const g of GUESTS) {
    const photo = g.id === "L07" ? "FAILED x3 (guest declined a retake: camera shy)" : "OK";
    rows.push(`${g.id},${g.name},guest wristband,${g.costume.includes(",") ? `"${g.costume}"` : g.costume},${g.checkin},${photo}`);
  }
  out("venue/registration.csv", lines(rows));
}

// ---------------------------------------------------------------------------------------------
// Badge registry (Act II)

{
  const rows = ["badge,holder,role,doors,status"];
  for (const s of STAFF) rows.push(`${s.id},${s.name},${s.role},${s.doors},ACTIVE`);
  rows.push(`${DEACTIVATED.id},${DEACTIVATED.name},${DEACTIVATED.role},${DEACTIVATED.doors},${DEACTIVATED.status}`);
  out("access_control/badges.csv", lines(rows));
}

// ---------------------------------------------------------------------------------------------
// Door log for the evening window 18:00–24:00 (every reader). The controller's export is ACS-EXP-7731;
// ACS-EXP-7734 is the copy Yasmine edited at 00:01, swapping her badge for Lucien's wristband on the
// two projection-room rows only. That edited copy is what reached the staff channel as door_log.csv.

{
  const DOORS = ["STAFF-ENT", "BACKSTAGE", "AV-STORE", "CATERING", "STAIR-E", "OFFICE-2F"];
  const EXIT_READERS = new Set(["STAFF-ENT", "AV-STORE", "OFFICE-2F", "PROJ-EAST"]);
  const WINDOW_START = T("18:00");
  const WINDOW_END = T("23:59:59");
  const events = [];
  const add = (sec, door, action, cred, result = "GRANTED") => events.push({ sec, door, action, cred, result });

  // Quiet periods the story needs: nobody else on the stairs or upstairs while it happens,
  // Nadia and Yasmine off the random schedule late in the evening, Tara at her console.
  const blocked = (cred, door, sec) =>
    door === "PROJ-EAST" ||
    (door === "STAIR-E" && sec >= T("23:40") && sec <= T("23:59:59")) ||
    (door === "OFFICE-2F" && sec >= T("23:40")) ||
    ((cred === "A14" || cred === "N01") && sec >= T("23:25")) ||
    (cred === "T09" && sec >= T("23:40") && sec <= T("23:58"));

  for (const s of STAFF) {
    const allowed = s.doors === "ALL" ? DOORS : s.doors.split(";").filter((d) => d !== "PROJ-EAST");
    const arrive = Math.max(WINDOW_START + int(0, 300), T(s.checkin));
    add(arrive, "STAFF-ENT", "ENTRY", s.id);
    const visits = s.role === "catering" ? int(10, 16) : s.role === "volunteer" ? int(6, 11) : s.role === "security" ? int(12, 16) : int(10, 15);
    for (let v = 0; v < visits; v++) {
      const sec = arrive + int(5, WINDOW_END - arrive - 5);
      const door = pick(allowed);
      if (blocked(s.id, door, sec)) continue;
      add(sec, door, "ENTRY", s.id);
      if (EXIT_READERS.has(door) && rand() < 0.8) {
        const back = sec + int(60, 1500);
        if (back <= WINDOW_END && !blocked(s.id, door, back)) add(back, door, "EXIT", s.id);
      }
    }
  }
  // A few wrong-door swipes, and Karim trying his dead badge out of habit.
  add(T("20:40:17"), "OFFICE-2F", "ENTRY", "C02", "DENIED");
  add(T("21:05:44"), "AV-STORE", "ENTRY", "V03", "DENIED");
  add(T("22:26:05"), "STAFF-ENT", "ENTRY", "K02", "DENIED");
  // The projection room all evening.
  add(T("18:20:31"), "PROJ-EAST", "ENTRY", "M01");
  add(T("18:31:02"), "PROJ-EAST", "EXIT", "M01");
  add(T("19:40:12"), "PROJ-EAST", "ENTRY", "N01");
  add(T("19:58:40"), "PROJ-EAST", "EXIT", "N01");
  add(T("20:12:09"), "PROJ-EAST", "ENTRY", "T09");
  add(T("20:16:55"), "PROJ-EAST", "EXIT", "T09");
  add(T("23:11:40"), "PROJ-EAST", "ENTRY", "T09");
  add(T("23:19:05"), "PROJ-EAST", "EXIT", "T09");
  // The murder: Yasmine up the east stairs, into the room before Nadia, out five minutes later.
  add(T("23:47:38"), "STAIR-E", "ENTRY", "A14");
  add(T("23:49:03"), "PROJ-EAST", "ENTRY", "A14");
  add(T("23:49:20"), "STAIR-E", "ENTRY", "N01");
  add(T("23:50:11"), "PROJ-EAST", "ENTRY", "N01");
  add(T("23:55:26"), "PROJ-EAST", "EXIT", "A14");

  events.sort((a, b) => a.sec - b.sec || a.cred.localeCompare(b.cred));
  const header = "timestamp,reader,action,credential,result";
  const row = (e, cred = e.cred) => `${stamp(e.sec)},${e.door},${e.action},${cred},${e.result}`;
  const authentic = [header, ...events.filter((e) => e.sec >= WINDOW_START && e.sec <= WINDOW_END).map((e) => row(e))];
  const edited = [
    header,
    ...events
      .filter((e) => e.sec >= WINDOW_START && e.sec <= WINDOW_END)
      .map((e) => row(e, e.door === "PROJ-EAST" && e.cred === "A14" ? "L07" : e.cred)),
  ];
  out("access_control/exports/ACS-EXP-7731.csv", lines(authentic));
  out("access_control/exports/ACS-EXP-7734.csv", lines(edited));
  out("staff_channel/attachments/door_log.csv", lines(edited));
}

// ---------------------------------------------------------------------------------------------
// Photo booth (Act II). One frame per session; frames are numbered like sessions.
// Session S27 is Lucien and Salma: two wristbands, two people on the seat, one face in the picture.

{
  const guestPool = GUESTS.filter((g) => !["L07", "S02", "G04"].includes(g.id));
  const sessions = [];
  // 26 sessions between 20:31 and 23:38, at uneven intervals.
  const gaps = Array.from({ length: 25 }, () => 5 + rand() * 5);
  const scale = (T("23:38:00") - T("20:31:12")) / gaps.reduce((a, b) => a + b, 0);
  let t = T("20:31:12");
  for (let n = 1; n <= 26; n++) {
    const eligible = guestPool.filter((g) => T(g.checkin) < t);
    const size = Math.min(pick([1, 2, 2, 2, 3, 3, 4]), eligible.length);
    const people = [];
    while (people.length < size) {
      const g = pick(eligible);
      if (!people.includes(g)) people.push(g);
    }
    if (!people.length) throw new Error(`nobody had checked in before booth session ${n}`);
    sessions.push({ n, open: t, people });
    if (n < 26) t += Math.round(gaps[n - 1] * scale);
  }
  sessions.push({ n: 27, open: T("23:51:08"), people: [GUESTS.find((g) => g.id === "L07"), GUESTS.find((g) => g.id === "S02")], faces: 1 });
  sessions.push({ n: 28, open: T("23:58:02"), people: [GUESTS.find((g) => g.id === "G11")] });
  sessions.push({ n: 29, open: T("24:04:15"), people: [GUESTS.find((g) => g.id === "G31")] });

  const csvRows = ["session_id,checkin_time,wristband,participant_name"];
  const log = ["# MASKED PhotoBooth PB-2 | firmware 4.1 | tz +02:00 | clock: NTP campus-time (drift <1s at 23:00 check)"];
  for (const s of sessions) {
    const id = `S${String(s.n).padStart(2, "0")}`;
    for (const p of s.people) csvRows.push(`${id},${hhmm(s.open)},${p.id},${p.name}`);
    const masked = s.n === 9;
    const faces = s.faces ?? (masked ? s.people.length - 1 : s.people.length);
    const countdown = s.n === 27 ? T("23:51:50") : s.open + int(25, 45);
    const shot = countdown + 10;
    log.push(`${stamp(s.open)} ${id} SESSION_OPEN wristbands=${s.people.map((p) => p.id).join(",")}`);
    log.push(`${stamp(s.open + 7)} ${id} SEAT_SENSOR occupants=${s.people.length}`);
    log.push(`${stamp(countdown)} ${id} COUNTDOWN_START 10s`);
    log.push(`${stamp(shot)} ${id} AUTO_EXPOSURE frame=1/1 file=PB2_${String(s.n).padStart(4, "0")}.jpg`);
    log.push(`${stamp(shot + 1)} ${id} FACE_DETECT faces=${faces}${masked ? " occluded=1" : ""}`);
    log.push(`${stamp(shot + 31)} ${id} PRINT copies=${s.people.length > 2 ? 3 : 2}`);
    log.push(`${stamp(s.n === 27 ? T("23:54:00") : shot + 120)} ${id} SESSION_AUTO_CLOSE idle`);
  }
  log.push("2026-11-01 00:29:40 SYSTEM STORAGE_EXPORT requested_by=der-intake files=PB2_0027.jpg");
  out("photobooth/sessions.csv", lines(csvRows));
  out("photobooth/device.log", lines(log));
}

// ---------------------------------------------------------------------------------------------
// Expense ledgers (Act III). The nightly backup of Oct 30 still holds BC-104-DUP, the 2,400
// Yasmine paid to her own account (0412). The current export, edited at 19:12 on Oct 31, does not.

{
  const VENDORS = [
    { payee: "Hollow Lantern Decor", acct: "5521", prefix: "HL", lo: 120, hi: 900, by: ["Nadia Haddad", "Yasmine Mansour"] },
    { payee: "Neon Pulse Rentals", acct: "7730", prefix: "NP", lo: 300, hi: 1900, by: ["Tara Rahal"] },
    { payee: "Crescent Catering", acct: "3307", prefix: "CC", lo: 200, hi: 1400, by: ["Nadia Haddad"] },
    { payee: "Black Cat AV", acct: "8802", prefix: "BC", lo: 400, hi: 1800, by: ["Yasmine Mansour", "Tara Rahal"] },
    { payee: "Campus Print Shop", acct: "9014", prefix: "CPS", lo: 40, hi: 260, by: ["Yasmine Mansour"] },
    { payee: "Fog & Fable FX", acct: "6123", prefix: "FF", lo: 90, hi: 700, by: ["Tara Rahal", "Yasmine Mansour"] },
    { payee: "Bone & Bramble Florists", acct: "2209", prefix: "BB", lo: 60, hi: 420, by: ["Nadia Haddad"] },
    { payee: "Spectral Sound Hire", acct: "5840", prefix: "SS", lo: 250, hi: 1200, by: ["Tara Rahal"] },
    { payee: "Student Union Venue Office", acct: "1001", prefix: "SU", lo: 150, hi: 600, by: ["Yasmine Mansour"] },
    { payee: "Campus Security Services", acct: "3156", prefix: "CS", lo: 200, hi: 800, by: ["Nadia Haddad"] },
    { payee: "Moonlight Costume Rentals", acct: "7302", prefix: "MC", lo: 80, hi: 500, by: ["Yasmine Mansour"] },
  ];
  const counters = Object.fromEntries(VENDORS.map((v) => [v.prefix, int(10, 60)]));
  const rows = [];
  for (let day = 1; day <= 61; day++) {
    const date = day <= 30 ? `2026-09-${String(day).padStart(2, "0")}` : `2026-10-${String(day - 30).padStart(2, "0")}`;
    if (date >= "2026-10-20") continue; // the last ten days are written out below
    const count = pick([0, 1, 1, 2, 2, 3]);
    for (let k = 0; k < count; k++) {
      const v = pick(VENDORS);
      counters[v.prefix] += int(1, 3);
      const amount = Math.round((v.lo + rand() * (v.hi - v.lo)) / 5) * 5;
      rows.push([date, v.payee, String(amount), v.acct, pick(v.by), `${v.prefix}-${String(counters[v.prefix]).padStart(3, "0")}`]);
    }
  }
  const late = [
    ["2026-10-20", "Hollow Lantern Decor", "640", "5521", "Nadia Haddad", "HL-0031"],
    ["2026-10-21", "Moonlight Costume Rentals", "315", "7302", "Yasmine Mansour", "MC-118"],
    ["2026-10-22", "Neon Pulse Rentals", "1850", "7730", "Tara Rahal", "NP-2210"],
    ["2026-10-23", "Bone & Bramble Florists", "260", "2209", "Nadia Haddad", "BB-074"],
    ["2026-10-24", "Crescent Catering", "1120", "3307", "Nadia Haddad", "CC-889"],
    ["2026-10-25", "Fog & Fable FX", "410", "6123", "Tara Rahal", "FF-311"],
    ["2026-10-26", "Black Cat AV", "2400", "8802", "Yasmine Mansour", "BC-104"],
    ["2026-10-27", "Campus Security Services", "560", "3156", "Nadia Haddad", "CS-020"],
    ["2026-10-28", "Campus Print Shop", "185", "9014", "Yasmine Mansour", "CPS-77"],
    ["2026-10-29", "Black Cat AV", "2400", "0412", "Yasmine Mansour", "BC-104-DUP"],
    ["2026-10-29", "Spectral Sound Hire", "690", "5840", "Tara Rahal", "SS-205"],
    ["2026-10-30", "Student Union Venue Office", "450", "1001", "Yasmine Mansour", "SU-031"],
  ];
  const oct31 = [
    ["2026-10-31", "Crescent Catering", "380", "3307", "Nadia Haddad", "CC-902"],
    ["2026-10-31", "Bone & Bramble Florists", "95", "2209", "Nadia Haddad", "BB-079"],
  ];
  const header = "date,payee,amount_usd,account_last4,approved_by,invoice";
  const csv = (r) => r.map((c) => (c.includes(",") ? `"${c}"` : c)).join(",");
  const backup = [...rows, ...late];
  const current = [...rows, ...late.filter((r) => r[5] !== "BC-104-DUP"), ...oct31];
  out("finance/.backup/ledger_2026-10-30.csv", lines([header, ...backup.map(csv)]));
  out("finance/expenses_export.csv", lines([header, ...current.map(csv)]));
}

// ---------------------------------------------------------------------------------------------
// Wi-Fi controller log (Act III): DHCP leases and roaming between access points.

{
  const APS = ["MAIN-FLOOR", "AP-STAGE", "AP-BOOTH", "COAT-CHECK", "BACKSTAGE"];
  const mac = () => Array.from({ length: 6 }, () => int(0, 255).toString(16).padStart(2, "0")).join(":");
  const entries = [];
  const lease = (sec, ip, m, host) => entries.push({ sec, text: `wlc-01 dhcp lease ip=${ip} mac=${m} host=${host}` });
  const roam = (sec, m, host, from, to) => entries.push({ sec, text: `wlc-01 roam client=${m} host=${host} from=${from} to=${to} rssi=-${int(41, 72)}` });

  const fillerHosts = [
    "Galaxy-S24", "iPhone", "Pixel-8", "iPhone", "Redmi-Note-13", "iPhone", "Galaxy-A55", "iPhone", "OnePlus-12", "iPhone", "Pixel-7a", "iPhone",
    "Galaxy-S23", "iPhone", "iPad", "Surface-Go", "iPhone", "Pixel-9", "iPhone", "Galaxy-Z-Flip",
  ];
  fillerHosts.forEach((h, i) => {
    const m = mac();
    const host = h === "iPhone" ? `iPhone-${int(10, 99)}` : `${h}-${int(100, 999)}`;
    let at = T("19:45") + int(0, 200) * 60;
    let ap = "COAT-CHECK";
    lease(at, `10.31.4.${20 + i}`, m, host);
    for (let k = 0; k < int(2, 6); k++) {
      at += int(5, 50) * 60 + int(0, 59);
      if (at > T("24:20")) break;
      const to = pick(APS.filter((a) => a !== ap && a !== "BACKSTAGE"));
      roam(at, m, host, ap, to);
      ap = to;
    }
  });
  lease(T("18:03:10"), "10.31.0.23", "a4:5e:60:1c:22:9d", "DJ-STATION");
  roam(T("18:03:14"), "a4:5e:60:1c:22:9d", "DJ-STATION", "BACKSTAGE", "AP-STAGE");
  // Nadia
  lease(T("18:42:05"), "10.31.0.11", "52:7c:19:e3:08:a6", "Nadias-iPhone");
  roam(T("23:21:30"), "52:7c:19:e3:08:a6", "Nadias-iPhone", "BACKSTAGE", "MAIN-FLOOR");
  roam(T("23:49:40"), "52:7c:19:e3:08:a6", "Nadias-iPhone", "MAIN-FLOOR", "AP-2F-CORRIDOR");
  // Yasmine
  lease(T("18:45:22"), "10.31.0.14", "6e:02:aa:91:4c:1b", "Yasmines-iPhone");
  roam(T("23:24:18"), "6e:02:aa:91:4c:1b", "Yasmines-iPhone", "AP-STAGE", "BACKSTAGE");
  roam(T("23:47:52"), "6e:02:aa:91:4c:1b", "Yasmines-iPhone", "BACKSTAGE", "AP-2F-CORRIDOR");
  roam(T("23:56:31"), "6e:02:aa:91:4c:1b", "Yasmines-iPhone", "AP-2F-CORRIDOR", "MAIN-FLOOR");
  // Salma
  lease(T("21:12:44"), "10.31.4.88", "3a:91:c2:7e:10:5f", "Salmas-iPhone");
  roam(T("21:12:51"), "3a:91:c2:7e:10:5f", "Salmas-iPhone", "COAT-CHECK", "MAIN-FLOOR");
  roam(T("23:49:58"), "3a:91:c2:7e:10:5f", "Salmas-iPhone", "MAIN-FLOOR", "AP-BOOTH");
  roam(T("23:55:40"), "3a:91:c2:7e:10:5f", "Salmas-iPhone", "AP-BOOTH", "MAIN-FLOOR");

  entries.sort((a, b) => a.sec - b.sec);
  out("network/wifi.log", lines(entries.filter((e) => e.sec <= T("24:20")).map((e) => `${stamp(e.sec)} ${e.text}`)));
}

// ---------------------------------------------------------------------------------------------
// Salma's Messages database (Act III). A real SQLite file. Her conversation with Yasmine was deleted
// at 00:12; with secure_delete off and no vacuum, the text stays in the file's free space, where
// `strings` finds it. The other conversations are still live.

{
  const file = path.join(caseDir, "phones/salma_nasser/sms.db");
  mkdirSync(path.dirname(file), { recursive: true });
  rmSync(file, { force: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA page_size = 4096; PRAGMA journal_mode = DELETE; PRAGMA secure_delete = OFF; PRAGMA auto_vacuum = NONE;");
  db.exec(`CREATE TABLE handle (ROWID INTEGER PRIMARY KEY, id TEXT, display_name TEXT);
           CREATE TABLE message (ROWID INTEGER PRIMARY KEY, handle_id INTEGER, date TEXT, service INTEGER, is_from_me INTEGER, text TEXT);`);
  const handles = [
    [1, "+961 70 555 014", "Yasmine M."],
    [2, "+961 3 555 230", "Mama"],
    [3, "+961 71 555 808", "Lea Karam"],
    [4, "chat-214", "Witches of Room 214"],
  ];
  for (const h of handles) db.prepare("INSERT INTO handle VALUES (?, ?, ?)").run(...h);
  // [handle, date, from_me, text]
  const msgs = [
    [1, "2026-10-14 21:40:12", 1, "ok this is insane. 6 pics with lucien at the seminar drinks. he isn't in ANY of them. not blurry. just not there"],
    [1, "2026-10-14 21:41:03", 1, "his arm was literally around me"],
    [1, "2026-10-14 21:47:55", 0, "Phones, mirrors, the library CCTV. I told you. He doesn't show up on anything."],
    [4, "2026-10-14 22:10:31", 0, "who's bringing the cauldron for the 31st"],
    [1, "2026-10-15 09:12:40", 1, "so what IS he"],
    [1, "2026-10-15 09:15:02", 0, "Useful."],
    [2, "2026-10-19 12:01:17", 0, "Did you eat? Call me tonight"],
    [2, "2026-10-19 12:30:44", 1, "yes mama. tonight"],
    [1, "2026-10-24 22:03:29", 0, "Nadia asked about the Black Cat payments. If she finds the rest I'm finished. Expelled. Charges."],
    [1, "2026-10-24 22:05:10", 1, "what are you going to do"],
    [1, "2026-10-24 22:20:47", 0, "Make sure that if anything happens, it happens to someone who can't prove where he was. Invite Lucien to the party."],
    [1, "2026-10-26 18:44:02", 1, "invited him. he said he's always wanted to go to a 'human party'. he's actually sweet??"],
    [1, "2026-10-26 18:46:30", 0, "Don't get attached."],
    [4, "2026-10-28 20:15:00", 1, "i have the cauldron. and the fake cobwebs"],
    [4, "2026-10-28 20:16:12", 0, "queen"],
    [1, "2026-10-31 21:45:20", 0, "She's sending it to the Dean at 8. It has to be tonight."],
    [1, "2026-10-31 21:46:02", 1, "what do you mean tonight"],
    [1, "2026-10-31 21:50:33", 0, "I just need five minutes alone with her. At 11:50 get Lucien into the photo booth and keep him there till 11:55. Whatever happens, you were never with him."],
    [1, "2026-10-31 21:52:10", 1, "ok. and the post?"],
    [1, "2026-10-31 23:30:41", 0, "Post this from my account at 11:53 exactly. You're still logged in. I'm 'on stage'."],
    [4, "2026-10-31 23:31:15", 0, "WHERE are you two, the dance floor is insane"],
    [1, "2026-10-31 23:53:04", 1, "posted"],
    [3, "2026-10-31 23:58:12", 0, "who was the vampire you dragged into the booth lol"],
    [3, "2026-10-31 23:59:01", 1, "nobody. i was alone"],
    [3, "2026-10-31 23:59:30", 0, "salma i literally watched you pull him in"],
    [1, "2026-11-01 00:10:09", 0, "If anyone asks, you were alone in the booth. Show them the photo."],
    [1, "2026-11-01 00:11:20", 1, "what happened up there"],
    [1, "2026-11-01 00:11:48", 0, "Delete this. Now."],
    [2, "2026-11-01 00:40:02", 0, "Are you home? Something happened at the university, it's on the news"],
  ];
  for (const [h, date, me, text] of msgs) {
    db.prepare("INSERT INTO message (handle_id, date, service, is_from_me, text) VALUES (?, ?, 3, ?, ?)").run(h, date, me, text);
  }
  db.exec("DELETE FROM message WHERE handle_id = 1;");
  db.close();
}

// ---------------------------------------------------------------------------------------------
// Practice folder (lobby, unscored). Two copies of a long guest list, one with a single edited
// cell, and the checksum recorded for the original. Long enough that the edit isn't spotted by eye.
{
  const trainingDir = path.join(root, "content/training/fs/training");
  const r = rng(31);
  const first = ["Adam", "Bella", "Chris", "Dina", "Eli", "Farah", "Gabe", "Hana", "Ivan", "Jana", "Karl", "Lina", "Marc", "Nora", "Omar", "Petra", "Rami", "Sara", "Tom", "Vera", "Wael", "Yara", "Zein"];
  const last = ["Abboud", "Brown", "Chami", "Daher", "Evans", "Fares", "Green", "Haddad", "Issa", "Jones", "Khoury", "Lopez", "Moussa", "Nasr", "Owens", "Price", "Rizk", "Saleh", "Taylor", "Usher", "Wright", "Young", "Zahr"];
  const types = ["standard", "standard", "standard", "student", "student", "volunteer", "VIP"];
  const rows = ["ticket,name,type,checked_in"];
  for (let n = 1; n <= 240; n++) {
    const name = `${first[Math.floor(r() * first.length)]} ${last[Math.floor(r() * last.length)]}`;
    const type = types[Math.floor(r() * types.length)];
    const hh = 18 + Math.floor(r() * 5);
    const mm = Math.floor(r() * 60);
    rows.push(`T-${String(2000 + n)},${name},${type},${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`);
  }
  const original = lines(rows);
  const edited = original.split("\n").map((row) => (row.startsWith("T-2157,") ? row.replace(/:(\d)(\d)$/, (_, a, b) => `:${(Number(a) + 3) % 6}${b}`) : row)).join("\n");
  if (edited === original) throw new Error("practice list edit did not apply");
  mkdirSync(path.join(trainingDir, "lists"), { recursive: true });
  writeFileSync(path.join(trainingDir, "lists/guests_a.csv"), original);
  writeFileSync(path.join(trainingDir, "lists/guests_b.csv"), edited);
  const sha = createHash("sha256").update(original).digest("hex");
  writeFileSync(
    path.join(trainingDir, "lists/checksums.txt"),
    `# sha256 of guests.csv when it was exported from the ticket system (2026-10-01 09:20)\n${sha}  guests.csv\n`,
  );
}

writeIntakeManifests(caseDir);
console.log("Evidence built and the intake manifests re-hashed.");
