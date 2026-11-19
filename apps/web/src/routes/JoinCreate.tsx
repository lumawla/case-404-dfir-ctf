import { Copy, KeyRound, Users } from "lucide-react";
import { useEffect, useId, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ApiError, api, type PublicEvent } from "../api";
import { ErrorNote } from "../components/ui";
import { useTeam } from "../state/team";
import { PublicLayout } from "./PublicLayout";

export function JoinTeam() {
  const [params] = useSearchParams();
  const [recoveryKey, setRecoveryKey] = useState("");
  const [code, setCode] = useState(params.get("code") ?? "");
  const [nickname, setNickname] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { apply, rememberCode } = useTeam();
  const navigate = useNavigate();
  const codeId = useId();
  const nickId = useId();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.joinTeam(code, nickname, recoveryKey || undefined);
      rememberCode(code.trim().toUpperCase());
      apply(res.state);
      navigate(res.state.team.status === "NOT_STARTED" ? "/team" : "/case");
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <PublicLayout>
      <div className="narrow card stack">
        <div>
          <h1 style={{ marginBottom: 4 }}>Join a team</h1>
          <p className="muted">Enter the 12-character code from whoever created your team. Rejoining on another device? Use the same nickname and your private recovery key from the team lobby.</p>
        </div>
        <form className="stack" onSubmit={submit}>
          <div className="field">
            <label htmlFor={codeId}>Team code</label>
            <input
              id={codeId}
              className="input mono"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="XXXX-XXXX-XXXX"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              required
            />
          </div>
          <div className="field">
            <label htmlFor={nickId}>Your nickname</label>
            <input id={nickId} className="input" value={nickname} onChange={(e) => setNickname(e.target.value)} maxLength={24} autoComplete="nickname" required />
            <p className="help" style={{ margin: 0 }}>
              Shown to your teammates and nobody else. A nickname is fine — no real name needed.
            </p>
          </div>
          <details><summary>Recover my existing membership</summary>
            <label className="field">Private recovery key
              <input className="input mono" type="password" value={recoveryKey} onChange={(e) => setRecoveryKey(e.target.value)} autoComplete="off" />
            </label>
          </details>
          {error && <ErrorNote>{error}</ErrorNote>}
          <button className="btn btn-primary btn-lg btn-block" disabled={busy} aria-busy={busy}>
            <KeyRound aria-hidden="true" /> Join team
          </button>
        </form>
        <p className="small muted" style={{ margin: 0 }}>
          No team yet? <Link to="/create">Create one</Link>.
        </p>
      </div>
    </PublicLayout>
  );
}

export function CreateTeam() {
  const [teamName, setTeamName] = useState("");
  const [nickname, setNickname] = useState("");
  const [registrationCode, setRegistrationCode] = useState("");
  const [event, setEvent] = useState<PublicEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const { apply, rememberCode } = useTeam();
  const navigate = useNavigate();
  const teamId = useId();
  const nickId = useId();
  const regId = useId();

  useEffect(() => {
    api.event().then(setEvent).catch(() => {});
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.createTeam(teamName, nickname, registrationCode || undefined);
      rememberCode(res.joinCode);
      apply(res.state);
      setCreated(res.joinCode);
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  if (created) {
    return (
      <PublicLayout>
        <div className="narrow card stack" role="status">
          <h1 style={{ marginBottom: 0 }}>Team created</h1>
          <p className="muted" style={{ margin: 0 }}>Share this code with your teammates.</p>
          <p className="paper join-code" style={{ margin: 0 }}>
            {created}
          </p>
          <div className="row">
            <button
              className="btn"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(created);
                  setCopied(true);
                } catch {
                  setCopied(false);
                }
              }}
            >
              <Copy aria-hidden="true" /> {copied ? "Copied" : "Copy code"}
            </button>
            <button className="btn btn-primary" onClick={() => navigate("/team")}>
              Go to team lobby
            </button>
          </div>
          <p className="small muted" style={{ margin: 0 }}>
            Anyone with this code can join your team, so share it only with teammates. The lobby shows it again.
          </p>
        </div>
      </PublicLayout>
    );
  }

  const closed = event && (!event.registrationOpen || !event.createTeamEnabled);
  return (
    <PublicLayout>
      <div className="narrow card stack">
        <div>
          <h1 style={{ marginBottom: 4 }}>New team</h1>
          <p className="muted">
            {event ? `${event.minTeamSize}–${event.maxTeamSize}` : "2–3"} investigators per team. You'll get a code to invite the others.
          </p>
        </div>
        {closed ? (
          <ErrorNote>Team creation is closed. Ask an organizer for a team code, then use Join a Team.</ErrorNote>
        ) : (
          <form className="stack" onSubmit={submit}>
            <div className="field">
              <label htmlFor={teamId}>Team name</label>
              <input id={teamId} className="input" value={teamName} onChange={(e) => setTeamName(e.target.value)} minLength={2} maxLength={40} required />
              <p className="help" style={{ margin: 0 }}>Shown on the scoreboard.</p>
            </div>
            <div className="field">
              <label htmlFor={nickId}>Your nickname</label>
              <input id={nickId} className="input" value={nickname} onChange={(e) => setNickname(e.target.value)} maxLength={24} autoComplete="nickname" required />
            </div>
            {event?.requiresRegistrationCode && (
              <div className="field">
                <label htmlFor={regId}>Event code</label>
                <input id={regId} className="input mono" value={registrationCode} onChange={(e) => setRegistrationCode(e.target.value)} autoComplete="off" required />
                <p className="help" style={{ margin: 0 }}>Shown on the screen at the front of the room.</p>
              </div>
            )}
            {error && <ErrorNote>{error}</ErrorNote>}
            <button className="btn btn-primary btn-lg btn-block" disabled={busy} aria-busy={busy}>
              <Users aria-hidden="true" /> Create team
            </button>
          </form>
        )}
        <p className="small muted" style={{ margin: 0 }}>
          Already have a code? <Link to="/join">Join a team</Link>.
        </p>
      </div>
    </PublicLayout>
  );
}
