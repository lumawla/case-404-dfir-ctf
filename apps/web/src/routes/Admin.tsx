import { CHALLENGE_IDS } from "@case404/shared";
import { Download, LogOut, Megaphone, Pause, Play, RefreshCw, ShieldAlert, Timer, Undo2, Unlock, Users, Eye } from "lucide-react";
import { useCallback, useEffect, useId, useState, type FormEvent } from "react";
import { ApiError, api, type AdminEventConfig, type AdminOverview, type AdminTeam } from "../api";
import { Dialog } from "../components/Dialog";
import { ErrorNote, Loading, ROMAN, formatDuration } from "../components/ui";
import { PublicLayout } from "./PublicLayout";

function Login({ onDone }: { onDone: () => void }) {
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await api.admin.login(token);
      onDone();
    } catch (err) {
      setError((err as ApiError).message);
    }
  }
  return (
    <form className="narrow card stack" onSubmit={submit}>
      <div>
        <p className="eyebrow">Organizers only</p>
        <h1>Facilitator dashboard</h1>
      </div>
      <div className="field">
        <label htmlFor={id}>Organizer token</label>
        <input id={id} className="input mono" type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="current-password" required />
        <p className="help" style={{ margin: 0 }}>
          The ADMIN_TOKEN configured on the server.
        </p>
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
      <button className="btn btn-primary">Sign in</button>
    </form>
  );
}

export function EventSettings({ event, onSaved }: { event: AdminEventConfig; onSaved: () => void }) {
  const [patch, setPatch] = useState<Partial<AdminEventConfig>>({});
  const form = { ...event, ...patch };
  const setForm = (next: AdminEventConfig) => setPatch((old) => ({ ...old, ...Object.fromEntries(Object.entries(next).filter(([k, v]) => v !== form[k as keyof AdminEventConfig])) }));
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const id = useId();
  async function save(e: FormEvent) {
    e.preventDefault();
    try {
      setSaving(true);
      await api.admin.updateEvent(patch);
      setPatch((current) => Object.fromEntries(Object.entries(current).filter(([k, v]) => v !== patch[k as keyof AdminEventConfig])));

      setMsg("Saved.");
      onSaved();
    } catch (err) {
      setMsg((err as ApiError).message);
    } finally { setSaving(false); }
  }
  const localReveal = form.revealAt ? new Date(Date.parse(form.revealAt) - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "";
  const bool = (k: keyof AdminEventConfig, label: string) => (
    <label className="checkbox">
      <input type="checkbox" checked={!!form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.checked })} />
      {label}
    </label>
  );
  return (
    <form className="card stack-sm" onSubmit={save} aria-labelledby={`${id}-t`}>
      <h2 id={`${id}-t`} style={{ fontSize: "var(--text-xl)" }}>
        Event settings
      </h2>
      <div className="field">
        <label htmlFor={`${id}-title`}>Title</label>
        <input id={`${id}-title`} className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
      </div>
      <div className="row">
        <div className="field" style={{ width: 150 }}>
          <label htmlFor={`${id}-dur`}>Duration (min)</label>
          <input id={`${id}-dur`} className="input" type="number" min={5} max={240} value={Math.round(form.durationSeconds / 60)} onChange={(e) => setForm({ ...form, durationSeconds: Number(e.target.value) * 60 })} />
        </div>
        <div className="field" style={{ width: 120 }}>
          <label htmlFor={`${id}-min`}>Min team</label>
          <input id={`${id}-min`} className="input" type="number" min={1} max={4} value={form.minTeamSize} onChange={(e) => setForm({ ...form, minTeamSize: Number(e.target.value) })} />
        </div>
        <div className="field" style={{ width: 120 }}>
          <label htmlFor={`${id}-max`}>Max team</label>
          <input id={`${id}-max`} className="input" type="number" min={1} max={4} value={form.maxTeamSize} onChange={(e) => setForm({ ...form, maxTeamSize: Number(e.target.value) })} />
        </div>
      </div>
      <div className="field">
        <label htmlFor={`${id}-code`}>Event code required to create teams (blank = none)</label>
        <input id={`${id}-code`} className="input mono" value={form.registrationCode ?? ""} onChange={(e) => setForm({ ...form, registrationCode: e.target.value })} />
      </div>
      <div className="field">
        <label htmlFor={`${id}-reveal`}>Spoiler reveal time (your local time; blank = not scheduled)</label>
        <input
          id={`${id}-reveal`}
          className="input"
          type="datetime-local"
          value={localReveal}
          onChange={(e) => setForm({ ...form, revealAt: e.target.value ? new Date(e.target.value).toISOString() : null })}
        />
      </div>
      {bool("registrationOpen", "Registration open (teams can join)")}
      {bool("createTeamEnabled", "Players can create teams")}
      {bool("startOpen", "Teams may press Begin")}
      {bool("leaderboardPublic", "Scoreboard visible to players")}
      <div className="row">
        <button className="btn btn-primary" disabled={saving || !Object.keys(patch).length}>Save settings</button>
        <span className="small muted" role="status">
          {msg}
        </span>
      </div>
    </form>
  );
}

function TeamDetail({ team, onClose, onChanged }: { team: AdminTeam; onClose: () => void; onChanged: () => void }) {
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof api.admin.team>> | null>(null);
  const [minutes, setMinutes] = useState(5);
  const [reason, setReason] = useState("");
  const [confirmName, setConfirmName] = useState("");
  const [code, setCode] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const id = useId();
  const load = useCallback(() => api.admin.team(team.id).then(setDetail).catch((e: ApiError) => setMsg(e.message)), [team.id]);
  useEffect(() => {
    load();
  }, [load]);
  const act = async (fn: () => Promise<unknown>, done: string) => {
    try {
      await fn();
      setMsg(done);
      load();
      onChanged();
    } catch (err) {
      setMsg((err as ApiError).message);
    }
  };
  return (
    <Dialog open onClose={onClose} title={`Team: ${team.name}`} variant="drawer">
      {!detail ? (
        <Loading />
      ) : (
        <div className="stack">
          <p className="small muted" role="status">
            {msg}
          </p>
          <section className="stack-sm">
            <h3>Members</h3>
            {detail.members.map((m) => (
              <div key={m.id} className="panel spread">
                <span>
                  {m.nickname} · {m.connected ? "online" : "away"} · {m.role}
                </span>
                <button className="btn btn-sm" onClick={() => window.confirm(`Remove ${m.nickname} from ${team.name}?`) && act(() => api.admin.revokeMember(team.id, m.id), `${m.nickname} removed.`)}>
                  Remove
                </button>
              </div>
            ))}
          </section>
          <section className="stack-sm">
            <h3>Accusations</h3>
            {detail.verdicts.length === 0 && <p className="muted small">None yet.</p>}
            {detail.verdicts.map((v) => (
              <div key={v.attemptNo} className="panel small">
                <p style={{ margin: 0 }}>
                  <strong>
                    #{v.attemptNo} {v.suspectId}
                  </strong>{" "}
                  — {v.correct ? "held" : "did not hold"} · by {v.by ?? "?"} · {new Date(v.at).toLocaleTimeString()}
                </p>
                <p style={{ margin: "4px 0 0" }}>
                  Motive: {v.motiveId} · Accomplice: {v.accompliceId ?? "none"}
                  {v.bonus ? ` (+${v.bonus})` : ""}
                </p>
                <p className="mono" style={{ margin: "4px 0 0" }}>
                  {v.files.join(", ")}
                </p>
              </div>
            ))}
          </section>
          <section className="stack-sm">
            <h3>Flag submissions (correct/total)</h3>
            <p className="small mono" style={{ margin: 0 }}>
              {detail.submissions.map((s) => `${s.challenge_id}: ${s.correct}/${s.total}`).join(" · ") || "None"}
            </p>
          </section>
          <section className="card stack-sm">
            <h3>Acts</h3>
            <p className="small muted" style={{ margin: 0 }}>
              This team is in Act {ROMAN[detail.act]}. Open the next act for a team that is stuck; it mounts that act's evidence and challenges. Acts never close again. Uses the reason below.
            </p>
            <div className="row">
              {([2, 3] as const).map((n) => (
                <button
                  key={n}
                  className="btn"
                  disabled={detail.act >= n || detail.status === "NOT_STARTED" || reason.trim().length < 3}
                  onClick={() => act(() => api.admin.openAct(team.id, n, reason), `Act ${ROMAN[n]} opened.`)}
                >
                  <Unlock aria-hidden="true" /> Open Act {ROMAN[n]}
                </button>
              ))}
            </div>
          </section>
          <section className="card stack-sm">
            <h3>Time extension</h3>
            <div className="row" style={{ alignItems: "flex-end" }}>
              <div className="field" style={{ width: 110 }}>
                <label htmlFor={`${id}-m`}>Minutes</label>
                <input id={`${id}-m`} className="input" type="number" min={1} max={60} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} />
              </div>
              <div className="field" style={{ flex: 1, minWidth: 160 }}>
                <label htmlFor={`${id}-r`}>Reason (audit log)</label>
                <input id={`${id}-r`} className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
              </div>
              <button className="btn" onClick={() => act(() => api.admin.extend(team.id, minutes, reason), `Added ${minutes} min.`)} disabled={reason.trim().length < 3}>
                <Timer aria-hidden="true" /> Extend
              </button>
            </div>
          </section>
          <section className="card stack-sm">
            <h3>Join code</h3>
            <p className="small muted" style={{ margin: 0 }}>
              Codes are stored hashed, so the old code can't be shown. Regenerating invalidates it; existing members stay signed in.
            </p>
            {code && <p className="paper mono" style={{ margin: 0, fontSize: "1.3rem", textAlign: "center" }}>{code}</p>}
            <button className="btn" style={{ justifySelf: "start" }} onClick={() => act(async () => setCode((await api.admin.regenerateCode(team.id)).joinCode), "New code generated.")}>
              <RefreshCw aria-hidden="true" /> Regenerate join code
            </button>
          </section>
          <section className="card stack-sm" style={{ borderColor: "var(--danger)" }}>
            <h3>
              <ShieldAlert aria-hidden="true" width={18} style={{ verticalAlign: "-3px", color: "var(--danger-text)" }} /> Reset progress
            </h3>
            <p className="small muted" style={{ margin: 0 }}>
              Deletes this team's flags, accusations and timer. Notes are kept. Type the team name to confirm.
            </p>
            <div className="row" style={{ alignItems: "flex-end" }}>
              <div className="field" style={{ flex: 1, minWidth: 160 }}>
                <label htmlFor={`${id}-c`}>Team name</label>
                <input id={`${id}-c`} className="input" value={confirmName} onChange={(e) => setConfirmName(e.target.value)} />
              </div>
              <button className="btn btn-danger" disabled={confirmName !== team.name || reason.trim().length < 3} onClick={() => act(() => api.admin.reset(team.id, confirmName, reason), "Team reset.")}>
                <Undo2 aria-hidden="true" /> Reset team
              </button>
            </div>
            <p className="small faint" style={{ margin: 0 }}>Uses the reason entered above.</p>
          </section>
        </div>
      )}
    </Dialog>
  );
}

function Dashboard({ onLogout }: { onLogout: () => void }) {
  const [data, setData] = useState<AdminOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [pauseReason, setPauseReason] = useState("");
  const [selected, setSelected] = useState<AdminTeam | null>(null);
  const [confirmReveal, setConfirmReveal] = useState(false);
  const id = useId();

  const load = useCallback(
    () =>
      api.admin
        .overview()
        .then((d) => {
          setData(d);
          setError(null);
        })
        .catch((e: ApiError) => (e.status === 401 ? onLogout() : setError(e.message))),
    [onLogout],
  );
  useEffect(() => {
    load();
    const t = window.setInterval(load, 5000);
    return () => window.clearInterval(t);
  }, [load]);

  if (!data) return error ? <ErrorNote>{error}</ErrorNote> : <Loading />;
  const ev = data.event;
  const paused = !!ev.pausedAt;

  return (
    <div className="stack">
      <div className="spread">
        <div>
          <p className="eyebrow">{ev.title}</p>
          <h1 style={{ margin: 0 }}>Facilitator dashboard</h1>
          <p className="small muted" style={{ margin: 0 }}>
            Server time {new Date(data.serverNow).toLocaleTimeString()} · {data.teams.length} teams · refreshes every 5 s
          </p>
        </div>
        <div className="row">
          <a className="btn" href="/api/admin/export">
            <Download aria-hidden="true" /> Export CSV
          </a>
          <button
            className="btn btn-ghost"
            onClick={async () => {
              await api.admin.logout().catch(() => {});
              onLogout();
            }}
          >
            <LogOut aria-hidden="true" /> Sign out
          </button>
        </div>
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}

      <section className="card stack-sm" aria-labelledby="teams-title">
        <h2 id="teams-title" style={{ fontSize: "var(--text-xl)" }}>
          <Users aria-hidden="true" width={20} style={{ verticalAlign: "-3px" }} /> Teams
        </h2>
        <div className="table-wrap">
          <table className="data">
            <caption className="visually-hidden">Teams</caption>
            <thead>
              <tr>
                <th scope="col">Team</th>
                <th scope="col">Status</th>
                <th scope="col">Remaining</th>
                <th scope="col">Elapsed</th>
                <th scope="col">Score</th>
                <th scope="col">Act</th>
                <th scope="col">Flags</th>
                <th scope="col">Accusations</th>
                <th scope="col">Online</th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.teams.map((t) => (
                <tr key={t.id}>
                  <td style={{ fontWeight: 650 }}>{t.name}</td>
                  <td>{t.status}</td>
                  <td>{t.remainingSeconds === null ? "—" : formatDuration(t.remainingSeconds)}</td>
                  <td>{formatDuration(t.elapsedSeconds)}</td>
                  <td>{t.score}</td>
                  <td>{t.status === "NOT_STARTED" ? "—" : ROMAN[t.act]}</td>
                  <td>
                    {t.solvedIds.length}/{CHALLENGE_IDS.length}
                  </td>
                  <td>{t.verdictAttempts}/2</td>
                  <td>
                    {t.members.filter((m) => m.connected).length}/{t.members.length}
                  </td>
                  <td>
                    <button className="btn btn-sm" onClick={() => setSelected(t)}>
                      Manage
                    </button>
                  </td>
                </tr>
              ))}
              {data.teams.length === 0 && (
                <tr>
                  <td colSpan={10} className="muted">
                    No teams yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className="admin-grid">
        <section className="card stack-sm" aria-labelledby={`${id}-ctl`}>
          <h2 id={`${id}-ctl`} style={{ fontSize: "var(--text-xl)" }}>
            Emergency controls
          </h2>
          <p className="small muted" style={{ margin: 0 }}>
            Pausing freezes every team's clock and blocks submissions. Resuming shifts all active deadlines by the paused time. Both are audit-logged.
          </p>
          <div className="field">
            <label htmlFor={`${id}-pr`}>Reason</label>
            <input id={`${id}-pr`} className="input" value={pauseReason} onChange={(e) => setPauseReason(e.target.value)} placeholder="e.g. venue Wi-Fi outage" />
          </div>
          {paused ? (
            <button className="btn btn-primary" onClick={() => api.admin.resume(pauseReason).then(load)}>
              <Play aria-hidden="true" /> Resume event (paused since {new Date(ev.pausedAt!).toLocaleTimeString()})
            </button>
          ) : (
            <button className="btn btn-danger" onClick={() => window.confirm("Pause the event for ALL teams?") && api.admin.pause(pauseReason).then(load)}>
              <Pause aria-hidden="true" /> Pause event for everyone
            </button>
          )}
          <hr className="divider" />
          <p className="small muted" style={{ margin: 0 }}>
            Reveal: {ev.revealAt ? `scheduled/active since ${new Date(ev.revealAt).toLocaleString()}` : "not scheduled"}. After the reveal every finished team sees the full reconstruction and flags.
          </p>
          <button className="btn" onClick={() => setConfirmReveal(true)}>
            <Eye aria-hidden="true" /> Reveal solution now
          </button>
        </section>

        <form
          className="card stack-sm"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!announcement.trim()) return;
            await api.admin.announce(announcement);
            setAnnouncement("");
            load();
          }}
        >
          <h2 style={{ fontSize: "var(--text-xl)" }}>
            <Megaphone aria-hidden="true" width={20} style={{ verticalAlign: "-3px" }} /> Announcement
          </h2>
          <div className="field">
            <label htmlFor={`${id}-ann`}>Message to all teams</label>
            <textarea id={`${id}-ann`} className="textarea" style={{ minHeight: 80 }} value={announcement} onChange={(e) => setAnnouncement(e.target.value)} maxLength={500} />
          </div>
          <button className="btn btn-primary" style={{ justifySelf: "start" }}>
            Publish
          </button>
          <ul className="feed">
            {data.announcements.map((a) => (
              <li key={a.id}>
                {a.body}
                <time>{new Date(a.at).toLocaleTimeString()}</time>
              </li>
            ))}
          </ul>
        </form>

        <EventSettings event={ev} onSaved={load} />

        <section className="card stack-sm" aria-labelledby={`${id}-audit`}>
          <h2 id={`${id}-audit`} style={{ fontSize: "var(--text-xl)" }}>
            Audit log
          </h2>
          <ul className="feed" style={{ maxHeight: 420, overflow: "auto" }}>
            {data.audit.map((a) => (
              <li key={a.id}>
                <strong>{a.action}</strong> <span className="mono small">{JSON.stringify(a.payload)}</span>
                <time>{new Date(a.at).toLocaleString()}</time>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {selected && <TeamDetail team={selected} onClose={() => setSelected(null)} onChanged={load} />}
      <Dialog
        open={confirmReveal}
        onClose={() => setConfirmReveal(false)}
        title="Reveal the solution to finished teams?"
        footer={
          <>
            <button className="btn" onClick={() => setConfirmReveal(false)}>
              Cancel
            </button>
            <button
              className="btn btn-danger"
              onClick={async () => {
                await api.admin.reveal();
                setConfirmReveal(false);
                load();
              }}
            >
              Reveal now
            </button>
          </>
        }
      >
        <p>Teams still playing won't see the reconstruction until they finish, but finished teams could tell them. Only reveal when every team is done.</p>
      </Dialog>
    </div>
  );
}

export default function Admin() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  useEffect(() => {
    api.admin
      .overview()
      .then(() => setAuthed(true))
      .catch(() => setAuthed(false));
  }, []);
  return (
    <PublicLayout>
      {authed === null ? <Loading /> : authed ? <Dashboard onLogout={() => setAuthed(false)} /> : <Login onDone={() => setAuthed(true)} />}
    </PublicLayout>
  );
}
