/** Trusted server clock. Tests substitute a controllable implementation. */
export type Clock = { now(): Date };

export const systemClock: Clock = { now: () => new Date() };

export function manualClock(start: Date | string): Clock & { set(d: Date | string): void; advance(ms: number): void } {
  let current = new Date(start);
  return {
    now: () => new Date(current),
    set: (d) => {
      current = new Date(d);
    },
    advance: (ms) => {
      current = new Date(current.getTime() + ms);
    },
  };
}
