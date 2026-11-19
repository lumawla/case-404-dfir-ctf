import type { FileListing, PracticeTask } from "@case404/shared";
import { ArrowLeft, BookOpenText, Check, KeyRound, ListChecks, SquareTerminal } from "lucide-react";
import { useEffect, useId, useState, type FormEvent } from "react";
import { Link, Navigate } from "react-router-dom";
import { ApiError, api, practiceFileUrl } from "../api";
import { CheatSheet } from "../components/CheatSheet";
import { Lightbox } from "../components/Lightbox";
import { ErrorNote, Loading } from "../components/ui";
import { useTeam } from "../state/team";
import { Terminal } from "../terminal/Terminal";
import { useTermSession } from "../terminal/session";
import type { Out } from "../terminal/shell";
import { CaesarLab } from "../tools/CaesarLab";

const MOTD: Out[] = [
  {
    kind: "rich",
    lines: [
      [{ t: "Practice room", c: "bold" }, { t: " · nothing here is scored, and the clock isn't running", c: "muted" }],
      [{ t: "The practice folder is at " }, { t: "~/training", c: "dir" }, { t: ". Try " }, { t: "ls", c: "bold" }, { t: ", then " }, { t: "cat README.txt", c: "bold" }, { t: "." }],
      [{ t: "Type " }, { t: "help", c: "bold" }, { t: " for every command, or open the Cheat sheet tab." }],
      [],
    ],
  },
];

const URLS = { raw: practiceFileUrl };

type Tool = "terminal" | "caesar" | "cheatsheet";
const TOOLS: { id: Tool; label: string; short: string; icon: typeof SquareTerminal }[] = [
  { id: "terminal", label: "Terminal", short: "Terminal", icon: SquareTerminal },
  { id: "caesar", label: "Caesar Lab", short: "Caesar", icon: KeyRound },
  { id: "cheatsheet", label: "Cheat sheet", short: "Cheat sheet", icon: BookOpenText },
];

function TaskCard({ task, solved, onSolved }: { task: PracticeTask; solved: boolean; onSolved: () => void }) {
  const [value, setValue] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const id = useId();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!value.trim() || busy) return;
    setBusy(true);
    setFeedback(null);
    try {
      const res = await api.practice.submit(task.id, value);
      setFeedback(res.message);
      if (res.status === "correct") {
        setValue("");
        onSolved();
      }
    } catch (err) {
      setFeedback((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className={`challenge open${solved ? " owned" : ""}`}>
      <div className="challenge-toggle" style={{ cursor: "default" }}>
        <span className="challenge-meta">
          <span className="badge">Practice</span>
        </span>
        <span className="challenge-title">
          <span>{task.title}</span>
        </span>
      </div>
      {solved && (
        <span className="stamp" aria-hidden="true">
          Owned
        </span>
      )}
      <div className="challenge-body">
        <p className="description">{task.description}</p>
        <div className="format">{task.format}</div>
        {solved ? (
          <p className="owned-note">
            <Check aria-hidden="true" width={16} height={16} /> Solved.
          </p>
        ) : (
          <form onSubmit={submit} className="stack-sm">
            <label htmlFor={`${id}-flag`} className="visually-hidden">
              Answer for {task.title}
            </label>
            <div className="flag-form">
              <input id={`${id}-flag`} className="input mono" value={value} onChange={(e) => setValue(e.target.value)} placeholder="FLAG{...}" autoComplete="off" autoCapitalize="characters" spellCheck={false} />
              <button className="btn btn-primary" disabled={busy || !value.trim()} aria-busy={busy}>
                Check
              </button>
            </div>
            {feedback && (
              <p className="flag-feedback" role="status">
                {feedback}
              </p>
            )}
          </form>
        )}
      </div>
    </li>
  );
}

/** The lobby's practice room: a small folder, four warm-up tasks, the terminal and the cheat sheet. Unscored. */
export default function Practice() {
  const { state, loading } = useTeam();
  const teamId = state?.team.id ?? null;
  const [listing, setListing] = useState<FileListing | null>(null);
  const [tasks, setTasks] = useState<PracticeTask[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<{ src: string; name: string } | null>(null);
  const [tool, setTool] = useState<Tool>("terminal");
  const [view, setView] = useState<"board" | "tools">("board");
  const [solved, setSolved] = useState<string[]>([]);
  const solvedKey = `c404.practice.${teamId}`;

  useEffect(() => {
    if (!teamId) return;
    Promise.all([api.practice.files(), api.practice.tasks()])
      .then(([l, t]) => {
        setListing(l);
        setTasks(t);
      })
      .catch((e: ApiError) => setError(e.message));
    try {
      setSolved(JSON.parse(localStorage.getItem(solvedKey) ?? "[]"));
    } catch {
      /* start fresh */
    }
  }, [teamId, solvedKey]);

  const terminal = useTermSession({ listing, urls: URLS, storageKey: teamId ? `c404.practice-term.${teamId}` : null, motd: MOTD, showImage: setLightbox });

  if (loading && !state)
    return (
      <div className="page">
        <Loading />
      </div>
    );
  if (!state) return <Navigate to="/join" replace />;

  const markSolved = (id: string) =>
    setSolved((prev) => {
      const next = [...new Set([...prev, id])];
      try {
        localStorage.setItem(solvedKey, JSON.stringify(next));
      } catch {
        /* kept in memory */
      }
      return next;
    });

  return (
    <>
      <div className="app">
        <a className="skip-link" href="#practice-main">
          Skip to content
        </a>
        <header className="topbar">
          <Link to="/team" className="brand" aria-label="Back to the team lobby">
            <img src="/favicon.svg" alt="" width={26} height={26} />
            <span>Practice room</span>
          </Link>
          <nav className="topnav" aria-label="Practice">
            <Link to="/team">
              <ArrowLeft aria-hidden="true" /> Lobby
            </Link>
          </nav>
          <div className="topbar-right">
            <span className="badge">Unscored · clock not running</span>
          </div>
        </header>
        <main id="practice-main" className="app-main" tabIndex={-1}>
          <div className="workspace" data-view={view}>
            <div className="mobile-switch">
              <div className="segmented segmented-grid" role="group" aria-label="Show">
                <button type="button" aria-pressed={view === "board"} onClick={() => setView("board")}>
                  Tasks
                </button>
                {TOOLS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    aria-pressed={view === "tools" && tool === t.id}
                    onClick={() => {
                      setView("tools");
                      setTool(t.id);
                    }}
                  >
                    {t.short}
                  </button>
                ))}
              </div>
            </div>
            <section className="board" aria-label="Practice tasks">
              <div className="board-head">
                <h2>Practice</h2>
                <span className="label">
                  <ListChecks aria-hidden="true" width={14} height={14} /> {solved.length}/{tasks?.length ?? 4} solved
                </span>
              </div>
              <p className="small muted">Get used to the tools before the real case. Use the terminal on the right; the cheat sheet explains each command.</p>
              {error && <ErrorNote>{error}</ErrorNote>}
              {!tasks && !error && <Loading label="Loading tasks" />}
              {tasks && (
                <ul className="challenge-list">
                  {tasks.map((t) => (
                    <TaskCard key={t.id} task={t} solved={solved.includes(t.id)} onSolved={() => markSolved(t.id)} />
                  ))}
                </ul>
              )}
            </section>
            <section className="tools" aria-label="Tools">
              <div className="tools-tabs" role="tablist" aria-label="Tools">
                {TOOLS.map((t) => (
                  <button key={t.id} type="button" role="tab" id={`ptab-${t.id}`} aria-selected={tool === t.id} aria-controls={`ppanel-${t.id}`} onClick={() => setTool(t.id)}>
                    <t.icon aria-hidden="true" /> {t.label}
                  </button>
                ))}
              </div>
              {TOOLS.map((t) => (
                <div key={t.id} className="tool-panel" role="tabpanel" id={`ppanel-${t.id}`} aria-labelledby={`ptab-${t.id}`} hidden={tool !== t.id}>
                  {t.id === "terminal" ? <Terminal session={terminal} /> : t.id === "caesar" ? <CaesarLab /> : <CheatSheet />}
                </div>
              ))}
            </section>
          </div>
        </main>
      </div>
      <Lightbox image={lightbox} onClose={() => setLightbox(null)} />
    </>
  );
}
