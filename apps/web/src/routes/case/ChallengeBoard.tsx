import type { ActView, ChallengeView } from "@case404/shared";
import { Droplet, Flag, Lock, Users } from "lucide-react";
import { useCallback, useId, useState, type FormEvent } from "react";
import { ApiError, api } from "../../api";
import { OwnedOverlay, type OwnedInfo } from "../../components/OwnedOverlay";
import { ErrorNote, Loading, ROMAN, clockTime } from "../../components/ui";
import { useCaseData } from "../../state/caseData";
import { useChime } from "../../state/settings";
import { useTeam } from "../../state/team";

const PIPS = { Easy: 1, Medium: 2, Hard: 3 } as const;

function Difficulty({ level }: { level: ChallengeView["difficulty"] }) {
  return (
    <span className="pips" title={level}>
      {[1, 2, 3].map((n) => (
        <i key={n} className={n <= PIPS[level] ? "on" : undefined} aria-hidden="true" />
      ))}
      <span>{level}</span>
    </span>
  );
}

function FlagForm({ challenge, disabled, onOwned }: { challenge: ChallengeView; disabled: string | null; onOwned: (o: OwnedInfo) => void }) {
  const { refresh } = useTeam();
  const [value, setValue] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [shaking, setShaking] = useState(false);
  const [busy, setBusy] = useState(false);
  const id = useId();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!value.trim() || busy) return;
    setBusy(true);
    setFeedback(null);
    try {
      const res = await api.submitFlag(challenge.id, value);
      if (res.status === "correct") {
        setValue("");
        onOwned({ title: challenge.title ?? "", points: res.awardedPoints, firstBlood: res.firstBlood, actOpened: res.actOpened ?? null });
      } else {
        setFeedback(res.message);
        if (res.status === "incorrect") {
          setShaking(true);
          window.setTimeout(() => setShaking(false), 400);
        }
      }
      await refresh();
    } catch (err) {
      setFeedback((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  if (disabled) return <p className="owned-note">{disabled}</p>;
  return (
    <form onSubmit={submit} className="stack-sm">
      <label htmlFor={`${id}-flag`} className="visually-hidden">
        Flag for {challenge.title}
      </label>
      <div className="flag-form">
        <input
          id={`${id}-flag`}
          className={`input mono${shaking ? " shake" : ""}`}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="FLAG{...}"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          aria-describedby={feedback ? `${id}-fb` : undefined}
        />
        <button className="btn btn-primary" disabled={busy || !value.trim()} aria-busy={busy}>
          <Flag aria-hidden="true" /> Submit
        </button>
      </div>
      {feedback && (
        <p id={`${id}-fb`} className="flag-feedback" role="alert">
          {feedback}
        </p>
      )}
    </form>
  );
}

function SealedCard({ c }: { c: ChallengeView }) {
  return (
    <li className="challenge locked" aria-label={`Sealed ${c.category} challenge, ${c.difficulty}, ${c.points} points`}>
      <div className="challenge-toggle" aria-hidden="true">
        <span className="challenge-meta">
          <span className="badge">{c.category}</span>
          <Difficulty level={c.difficulty} />
        </span>
        <span className="challenge-title">
          <span className="sealed-title">
            <Lock /> Sealed
          </span>
          <span className="points">{c.points} pts</span>
        </span>
      </div>
    </li>
  );
}

function ActHeading({ act, id }: { act: ActView; id: string }) {
  return (
    <div className="act-head">
      <span className="act-num">Act {ROMAN[act.n]}</span>
      <h3 id={id}>{act.open ? act.title : "Sealed"}</h3>
    </div>
  );
}

export function ChallengeBoard() {
  const { state } = useTeam();
  const { challenges, error, reloadChallenges, setOverlayBusy } = useCaseData();
  const [open, setOpen] = useState<string | null>(null);
  const [owned, setOwned] = useState<OwnedInfo | null>(null);
  const chime = useChime();
  const done = useCallback(() => {
    setOwned(null);
    setOverlayBusy(false);
  }, [setOverlayBusy]);

  if (error && !challenges) return <ErrorNote>{error}</ErrorNote>;
  if (!challenges || !state) return <Loading label="Loading challenges" />;

  const solved = challenges.filter((c) => c.solved);
  const points = solved.reduce((n, c) => n + c.points, 0);
  const total = challenges.reduce((n, c) => n + c.points, 0);
  const status = state.team.status;
  const closedReason =
    status === "TIME_EXPIRED" ? "Time is up. Submissions are closed." : status !== "ACTIVE" ? "Your case is closed." : state.clock.paused ? "Paused by the organizers." : null;

  const card = (c: ChallengeView) => {
    if (c.locked) return <SealedCard key={c.id} c={c} />;
    const isOpen = open === c.id;
    const bodyId = `challenge-${c.id}`;
    return (
      <li key={c.id} className={`challenge${isOpen ? " open" : ""}${c.solved ? " owned" : ""}`}>
        <button type="button" className="challenge-toggle" aria-expanded={isOpen} aria-controls={bodyId} onClick={() => setOpen(isOpen ? null : c.id)}>
          <span className="challenge-meta">
            <span className="badge">{c.category}</span>
            <Difficulty level={c.difficulty} />
          </span>
          <span className="challenge-title">
            <span>{c.title}</span>
            <span className="points">{c.points} pts</span>
          </span>
          <span className="challenge-foot">
            <span>
              <Users aria-hidden="true" /> {c.solves} {c.solves === 1 ? "solve" : "solves"}
            </span>
            {c.firstBlood && (
              <span className="blood">
                <Droplet aria-hidden="true" /> {c.firstBlood}
              </span>
            )}
            {c.solved && <span className="visually-hidden">Owned by your team.</span>}
          </span>
        </button>
        {c.solved && (
          <span className="stamp" aria-hidden="true">
            Owned
          </span>
        )}
        {isOpen && (
          <div className="challenge-body" id={bodyId}>
            <p className="description">{c.description}</p>
            <div className="format">{c.format}</div>
            {c.solved ? (
              <p className="owned-note">
                Owned{c.solvedBy ? ` by ${c.solvedBy}` : ""}
                {c.solvedAt ? ` at ${clockTime(c.solvedAt)}` : ""}.
              </p>
            ) : (
              <FlagForm
                challenge={c}
                disabled={closedReason}
                onOwned={(o) => {
                  chime("solve");
                  setOverlayBusy(true);
                  setOwned(o);
                  reloadChallenges();
                }}
              />
            )}
          </div>
        )}
      </li>
    );
  };

  return (
    <>
      <div className="board-head">
        <h2>Challenges</h2>
        <span className="label">
          {solved.length}/{challenges.length} owned · {points}/{total} pts
        </span>
      </div>
      <div className="progress" aria-hidden="true">
        <span style={{ width: `${(points / total) * 100}%` }} />
      </div>
      {state.acts.list.map((act) => (
        <section key={act.n} className={`act-group${act.open ? "" : " sealed"}`} aria-labelledby={`act-${act.n}`}>
          <ActHeading act={act} id={`act-${act.n}`} />
          {act.open ? (
            act.intro && (
              <details className="act-intro">
                <summary>Briefing</summary>
                <p>{act.intro}</p>
              </details>
            )
          ) : (
            <p className="act-unlock">
              <Lock aria-hidden="true" /> {act.unlock}.
            </p>
          )}
          <ul className="challenge-list">{challenges.filter((c) => c.act === act.n).map(card)}</ul>
        </section>
      ))}
      <OwnedOverlay owned={owned} onDone={done} />
    </>
  );
}
