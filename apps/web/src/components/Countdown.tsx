import { formatCountdown } from "@case404/shared";
import { Hourglass, Pause } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useChime } from "../state/settings";
import { useTeam } from "../state/team";
import { useToasts } from "../state/toasts";

const MILESTONES = [10 * 60, 5 * 60, 60];

function spoken(ms: number) {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m} minute${m === 1 ? "" : "s"} ${s} second${s === 1 ? "" : "s"} remaining`;
}

/**
 * Visual countdown driven by the server deadline plus a measured clock offset.
 * The display is not a live region (no per-second interruptions); milestones and an
 * on-demand button announce the remaining time instead.
 */
export function Countdown() {
  const { state, offsetMs } = useTeam();
  const { announce, push } = useToasts();
  const chime = useChime();
  const [now, setNow] = useState(() => Date.now());
  const frozen = useRef<number | null>(null);
  const announced = useRef(new Set<number>());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, []);

  const clock = state?.clock;
  const deadline = clock?.deadlineAt ? Date.parse(clock.deadlineAt) : null;
  let remaining = deadline ? deadline - (now + offsetMs) : null;
  if (clock?.paused) {
    if (frozen.current === null) frozen.current = remaining;
    remaining = frozen.current;
  } else frozen.current = null;

  const status = clock?.status;
  const active = status === "ACTIVE";

  useEffect(() => {
    if (!active || remaining === null) return;
    const secs = Math.ceil(remaining / 1000);
    for (const m of MILESTONES) {
      if (secs <= m && secs > m - 5 && !announced.current.has(m)) {
        announced.current.add(m);
        push({ kind: "info", text: `${m / 60} minute${m === 60 ? "" : "s"} left on your case clock.` });
        chime("warn");
      }
    }
  }, [active, remaining, push, chime]);

  if (!clock || !deadline) return null;
  const label =
    status === "SOLVED" ? "Solved" : status === "WRONG_VERDICT" ? "Closed" : status === "TIME_EXPIRED" ? "00:00" : formatCountdown(remaining ?? 0);
  const tone = active && remaining !== null ? (remaining < 5 * 60_000 ? "danger" : remaining < 10 * 60_000 ? "warn" : "") : "";

  return (
    <button
      type="button"
      className={`timer ${tone}`}
      onClick={() => announce(clock.paused ? "Event paused by the organizers." : active ? spoken(remaining ?? 0) : `Case ${label}.`)}
      title="Time remaining — select to hear it read aloud"
      aria-label={`Case clock: ${clock.paused ? "paused" : active ? label : label}. Select to announce time remaining.`}
    >
      {clock.paused ? <Pause aria-hidden="true" /> : <Hourglass aria-hidden="true" />}
      <span role="timer" aria-live="off">
        {clock.paused ? `${label} paused` : label}
      </span>
    </button>
  );
}
