import { ArrowRight, Check, Copy, Crown, Dumbbell, Link as LinkIcon, LogOut, Play } from "lucide-react";
import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { ApiError, api } from "../api";
import { ErrorNote, Loading } from "../components/ui";
import { useTeam } from "../state/team";
import { PublicLayout } from "./PublicLayout";

/** Team lobby and briefing in one place: invite, read the rules, begin. */
export function Lobby() {
  const { state, loading, joinCode, apply, clear } = useTeam();
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  if (loading && !state)
    return (
      <PublicLayout>
        <Loading label="Loading your team" />
      </PublicLayout>
    );
  if (!state) return <Navigate to="/join" replace />;

  const me = state.members.find((m) => m.isMe);
  const enough = state.members.length >= state.event.minTeamSize;
  const started = state.team.status !== "NOT_STARTED";
  const minutes = Math.round(state.event.durationSeconds / 60);
  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
    } catch {
      setCopied(null);
    }
  };

  async function begin() {
    setBusy(true);
    setError(null);
    try {
      apply(await api.start());
      navigate("/case");
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <PublicLayout>
      <div className="medium stack">
        <div>
          <p className="eyebrow">Team lobby</p>
          <h1 style={{ marginBottom: 0 }}>{state.team.name}</h1>
        </div>

        <section className="card stack-sm" aria-labelledby="members-title">
          <div className="spread">
            <h2 id="members-title" style={{ margin: 0 }}>
              Investigators {state.members.length}/{state.event.maxTeamSize}
            </h2>
            {!started && (
              <button type="button" className={`btn btn-sm ${me?.ready ? "btn-primary" : ""}`} aria-pressed={!!me?.ready} onClick={async () => apply(await api.setReady(!me?.ready))}>
                <Check aria-hidden="true" /> {me?.ready ? "Ready" : "Mark me ready"}
              </button>
            )}
          </div>
          <ul className="member-list">
            {state.members.map((m) => (
              <li key={m.id}>
                <span className="row" style={{ gap: 8 }}>
                  <span className={`dot${m.connected ? " on" : ""}`} aria-hidden="true" />
                  <strong>{m.nickname}</strong>
                  {m.isMe && <span className="small muted">(you)</span>}
                  {m.role === "captain" && <Crown aria-label="Created the team" width={16} height={16} color="var(--accent)" />}
                </span>
                <span className="small muted">
                  {m.connected ? "online" : "away"} · {m.ready ? "ready" : "not ready"}
                </span>
              </li>
            ))}
          </ul>
          {joinCode ? (
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span className="mono" style={{ fontSize: "1.2rem", letterSpacing: "0.08em", color: "var(--text-strong)" }}>
                {joinCode}
              </span>
              <span className="row" style={{ gap: 6 }}>
                <button type="button" className="btn btn-sm" onClick={() => copy(joinCode, "code")}>
                  <Copy aria-hidden="true" /> {copied === "code" ? "Copied" : "Copy code"}
                </button>
                <button type="button" className="btn btn-sm" onClick={() => copy(`${window.location.origin}/join?code=${encodeURIComponent(joinCode)}`, "link")}>
                  <LinkIcon aria-hidden="true" /> {copied === "link" ? "Copied" : "Invite link"}
                </button>
              </span>
            </div>
          ) : (
            <p className="small muted" style={{ margin: 0 }}>
              The join code is shown on the device that created the team.
            </p>
          )}
        </section>

        <details className="card stack-sm">
          <summary>My private recovery key</summary>
          <p>Save this privately before switching devices. It gives access as you. Do not share it with teammates or put it in an invite link. Logging out or organizer removal invalidates it.</p>
          <button className="btn btn-sm" onClick={async () => {
            try { setRecoveryKey((await api.recoveryKey()).recoveryKey); }
            catch (err) { setError((err as ApiError).message); }
          }}>Show my recovery key</button>
          {recoveryKey && <input className="input mono" aria-label="My private recovery key" readOnly value={recoveryKey} />}
        </details>

        <section className="card stack-sm" aria-labelledby="rules-title">
          <h2 id="rules-title">How this works</h2>
          <ol className="rules">
            <li>
              You get a Linux terminal with the evidence mounted at <span className="mono">~/case404</span>, a Caesar Lab, a cheat sheet of commands, a case timeline and shared notes.
            </li>
            <li>
              The case opens in three acts. Each act has challenges answered with a flag such as <span className="mono">FLAG{"{...}"}</span>; owning enough of them opens the next act and mounts new evidence.
              Wrong flags cost nothing. There are no hints.
            </li>
            <li>
              In Act III, accuse: one suspect, one motive and up to three files that prove it, plus anyone who helped. Two attempts; a wrong first one costs 10 points.
            </li>
            <li>The {minutes}-minute clock starts for the whole team when anyone presses Begin.</li>
          </ol>
        </section>

        {!started && (
          <section className="card stack-sm practice-callout" aria-labelledby="practice-title">
            <h2 id="practice-title">New to the terminal?</h2>
            <p style={{ margin: 0 }}>
              Warm up in the practice room first: a small folder, four quick tasks and the cheat sheet. Nothing there is scored, and the clock doesn't start.
            </p>
            <div>
              <Link className="btn" to="/team/practice">
                <Dumbbell aria-hidden="true" /> Open the practice room
              </Link>
            </div>
          </section>
        )}

        {error && <ErrorNote>{error}</ErrorNote>}
        <div className="row">
          {started ? (
            <Link className="btn btn-primary btn-lg" to="/case">
              Back to the case <ArrowRight aria-hidden="true" />
            </Link>
          ) : (
            <button type="button" className="btn btn-primary btn-lg" onClick={begin} disabled={!enough || busy || !state.event.startOpen} aria-busy={busy}>
              <Play aria-hidden="true" /> Begin the investigation
            </button>
          )}
          <button
            type="button"
            className="btn btn-ghost"
            onClick={async () => {
              await api.logout().catch(() => {});
              clear();
              navigate("/");
            }}
          >
            <LogOut aria-hidden="true" /> Leave on this device
          </button>
        </div>
        {!started && !enough && <p className="small muted">You need at least {state.event.minTeamSize} investigators to begin.</p>}
        {!started && enough && !state.event.startOpen && <p className="small muted">Waiting for the organizers to open the investigation.</p>}
      </div>
    </PublicLayout>
  );
}
