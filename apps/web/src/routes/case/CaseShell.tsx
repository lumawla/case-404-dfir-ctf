import { FileText, Gavel, Settings2, SquareTerminal, Trophy } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, NavLink, Navigate, Outlet } from "react-router-dom";
import { Countdown } from "../../components/Countdown";
import { Dialog } from "../../components/Dialog";
import { Lightbox } from "../../components/Lightbox";
import { SettingsPanel } from "../../components/SettingsPanel";
import { Loading, ROMAN } from "../../components/ui";
import { CaseDataProvider, useCaseData } from "../../state/caseData";
import { useTeam } from "../../state/team";

function LightboxHost() {
  const { lightbox, showImage } = useCaseData();
  return <Lightbox image={lightbox} onClose={() => showImage(null)} />;
}

/** When a new act opens (for this team, on any device), its briefing is shown once, after any Owned moment. */
function ActHost() {
  const { state } = useTeam();
  const { overlayBusy } = useCaseData();
  const [shown, setShown] = useState<number | null>(null);
  const teamId = state?.team.id;
  const current = state?.acts.current ?? 1;
  const key = `c404.act.${teamId}`;
  const seen = () => {
    try {
      return Number(localStorage.getItem(key) ?? "1") || 1;
    } catch {
      return current;
    }
  };

  useEffect(() => {
    if (teamId && !overlayBusy && shown === null && current > seen()) setShown(current);
    // seen() reads storage; it changes only through close().
  }, [teamId, current, overlayBusy, shown]);

  const close = () => {
    try {
      localStorage.setItem(key, String(shown ?? current));
    } catch {
      /* shown again next time */
    }
    setShown(null);
  };
  const act = state?.acts.list.find((a) => a.n === shown);
  return (
    <Dialog
      open={!!act}
      onClose={close}
      title={act ? `Act ${ROMAN[act.n]}: ${act.title}` : ""}
      footer={
        <button type="button" className="btn btn-primary" onClick={close}>
          Back to the investigation
        </button>
      }
    >
      <p className="act-intro-text">{act?.intro}</p>
      <p className="muted small" style={{ marginBottom: 0 }}>
        New evidence is mounted in <span className="mono">~/case404</span>, and new challenges are on the board.
      </p>
    </Dialog>
  );
}

export default function CaseShell() {
  const { state, loading } = useTeam();
  const [settingsOpen, setSettingsOpen] = useState(false);

  if (loading && !state)
    return (
      <div className="page">
        <Loading label="Loading your case" />
      </div>
    );
  if (!state) return <Navigate to="/join" replace />;
  if (state.team.status === "NOT_STARTED") return <Navigate to="/team" replace />;

  const status = state.team.status;
  const closed = status === "SOLVED" || status === "WRONG_VERDICT" || status === "TIME_EXPIRED";
  return (
    <CaseDataProvider key={state.team.id}>
      <div className="app">
        <a className="skip-link" href="#case-main">
          Skip to content
        </a>
        <header className="topbar">
          <Link to="/case" className="brand" aria-label="Case 404 workspace">
            <img src="/favicon.svg" alt="" width={26} height={26} />
            <span>Case 404</span>
          </Link>
          <nav className="topnav" aria-label="Case">
            <NavLink to="/case" end>
              <SquareTerminal aria-hidden="true" /> Workspace
            </NavLink>
            <NavLink to="/case/file">
              <FileText aria-hidden="true" /> Case file
            </NavLink>
            <NavLink to="/case/accuse">
              <Gavel aria-hidden="true" /> Accuse
            </NavLink>
            <NavLink to="/case/scoreboard">
              <Trophy aria-hidden="true" /> Scores
            </NavLink>
          </nav>
          <div className="topbar-right">
            <span className="score-pill" aria-label={`Score: ${state.team.score.total} points`}>
              {state.team.score.total} <small>pts</small>
            </span>
            <Countdown />
            <Link className="team-link" to="/team" title="Team lobby">
              {state.team.name}
            </Link>
            <button type="button" className="icon-btn" onClick={() => setSettingsOpen(true)} aria-label="Display settings">
              <Settings2 />
            </button>
          </div>
        </header>
        <div>
          {state.clock.paused && <div className="status-banner">The organizers have paused the event. Your clock is frozen.</div>}
          {closed && (
            <div className="status-banner">
              {status === "TIME_EXPIRED" ? "Time is up." : "Your case is closed."} The files stay open for review. <Link to="/case/result">See your result</Link>
            </div>
          )}
        </div>
        <main id="case-main" className="app-main" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
      <LightboxHost />
      <ActHost />
      <Dialog open={settingsOpen} onClose={() => setSettingsOpen(false)} title="Display settings" variant="drawer">
        <SettingsPanel />
      </Dialog>
    </CaseDataProvider>
  );
}
