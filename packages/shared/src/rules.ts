import type { ActNumber, ChallengeId } from "./types.js";

export const CHALLENGE_IDS: ChallengeId[] = ["EV01", "EV02", "EV03", "EV04", "EV05", "EV06", "EV07", "EV08"];

export const CHALLENGE_POINTS: Record<ChallengeId, number> = {
  EV01: 10,
  EV02: 10,
  EV03: 15,
  EV04: 15,
  EV05: 20,
  EV06: 20,
  EV07: 15,
  EV08: 25,
};

export const CHALLENGE_ACT: Record<ChallengeId, ActNumber> = {
  EV01: 1,
  EV02: 1,
  EV03: 2,
  EV04: 2,
  EV05: 2,
  EV06: 3,
  EV07: 3,
  EV08: 3,
};

export const ACTS: ActNumber[] = [1, 2, 3];

/** Act II opens when both Act I challenges are owned; Act III when any two of the three Act II challenges are. */
export const ACT_UNLOCK: Record<ActNumber, { from: ActNumber | null; need: number; text: string }> = {
  1: { from: null, need: 0, text: "Open from the start" },
  2: { from: 1, need: 2, text: "Opens when both Act I challenges are owned" },
  3: { from: 2, need: 2, text: "Opens when any two Act II challenges are owned" },
};

/** The highest act the solves earn, starting from an act already open (organizers can open one early). Acts open in order. */
export function earnedAct(solved: readonly ChallengeId[], current: ActNumber = 1): ActNumber {
  let act: ActNumber = current;
  for (const n of [2, 3] as const) {
    const rule = ACT_UNLOCK[n];
    const owned = solved.filter((id) => CHALLENGE_ACT[id] === rule.from).length;
    if (act === rule.from && owned >= rule.need) act = n;
  }
  return act;
}

export const DEFAULT_DURATION_SECONDS = 75 * 60;
export const VERDICT_POINTS = 40;
export const ACCOMPLICE_BONUS = 15;
export const FIRST_WRONG_VERDICT_PENALTY = 10;
export const VERDICT_ATTEMPTS = 2;
export const MAX_ACCUSATION_FILES = 3;

/** Score never drops below zero; penalties are recorded separately. */
export function computeScore(earned: number, penalties: number): number {
  return Math.max(0, earned - penalties);
}
