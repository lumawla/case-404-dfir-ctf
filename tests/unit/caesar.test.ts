import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { caesar } from "../../packages/shared/src/caesar";

const ARCHIVE = readFileSync(new URL("../../content/evidence/fs/case404/maskmail/archive_export.txt", import.meta.url), "utf8");

/** Message bodies of one thread in the MaskMail export ("HH:MM SENDER:" header, body on the next line). */
function thread(id: string) {
  const section = ARCHIVE.split(/^== thread /m).find((s) => s.startsWith(id))!;
  const lines = section.split("\n");
  return lines.flatMap((l, i) => (/^\d{2}:\d{2} [A-Z]+:$/.test(l) ? [{ head: l, body: lines[i + 1] }] : []));
}

// Organizer-only plaintext. Lives in tests, never in shipped content.
const MOTH_PLAINTEXT = [
  "I know what you've been hiding. I have proof, and it goes to the Dean at 8.",
  "You don't understand. Let me explain first.",
  "Then explain. You have until morning.",
  "Not over text. Meet me in the projection room at 11:50. Come alone.",
];

describe("caesar", () => {
  it("encodes and decodes", () => {
    expect(caesar("ABC xyz!", 11, false)).toBe("LMN ijk!");
    expect(caesar("LMN ijk!", 11, true)).toBe("ABC xyz!");
  });

  it("preserves non-letters, case and line breaks", () => {
    expect(caesar("Hello, World 2026!\nok", 3, false)).toBe("Khoor, Zruog 2026!\nrn");
    expect(caesar("Zz", 1, false)).toBe("Aa");
  });

  it("normalizes any shift into 0..25", () => {
    expect(caesar("abc", 26 + 2, false)).toBe("cde");
    expect(caesar("abc", -1, false)).toBe("zab");
  });
});

describe("MaskMail archive", () => {
  it("has a neutral header that never names the cipher or the shift", () => {
    const header = ARCHIVE.split("== thread")[0];
    expect(header).not.toMatch(/shift|caesar|rot|cipher|novelty|encod/i);
  });

  it("decodes the MOTH thread with shift 11 and round-trips", () => {
    const msgs = thread("c41e");
    expect(msgs.map((m) => m.head)).toEqual(["23:34 NADIA:", "23:35 MOTH:", "23:36 NADIA:", "23:37 MOTH:"]);
    msgs.forEach((m, i) => {
      expect(caesar(m.body, 11, true)).toBe(MOTH_PLAINTEXT[i]);
      expect(caesar(MOTH_PLAINTEXT[i], 11, false)).toBe(m.body);
    });
  });

  it("uses other shifts (7 and 19) for the other threads, so one shift never reads the whole file", () => {
    const decoy = thread("7f3a");
    expect(decoy.map((m) => m.head)).toEqual(["21:16 GHOSTLIGHT:", "21:18 NADIA:"]);
    expect(caesar(decoy[0].body, 7, true)).toMatch(/^Encoder keeps dropping frames/);
    expect(caesar(decoy[0].body, 11, true)).not.toMatch(/Encoder/);
    expect(caesar(thread("c41e")[0].body, 7, true)).not.toMatch(/proof/);
    expect(caesar(thread("19bd")[0].body, 19, true)).toBe("Punch bowl at ten. Wear the crown or don't come.");
  });
});
