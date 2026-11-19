import { BookOpenText, History, KeyRound, NotebookPen, SquareTerminal } from "lucide-react";
import { useState } from "react";
import { CheatSheet } from "../../components/CheatSheet";
import { useCaseData } from "../../state/caseData";
import { Terminal } from "../../terminal/Terminal";
import { CaesarLab } from "../../tools/CaesarLab";
import { ChallengeBoard } from "./ChallengeBoard";
import { NotesPanel } from "./NotesPanel";
import { TimelinePanel } from "./TimelinePanel";

type Tool = "terminal" | "caesar" | "timeline" | "cheatsheet" | "notes";
const TOOLS: { id: Tool; label: string; short: string; icon: typeof SquareTerminal }[] = [
  { id: "terminal", label: "Terminal", short: "Terminal", icon: SquareTerminal },
  { id: "caesar", label: "Caesar Lab", short: "Caesar", icon: KeyRound },
  { id: "timeline", label: "Timeline", short: "Timeline", icon: History },
  { id: "cheatsheet", label: "Cheat sheet", short: "Cheat sheet", icon: BookOpenText },
  { id: "notes", label: "Notes", short: "Notes", icon: NotebookPen },
];

/**
 * The main screen: challenges on the left, the investigator's tools on the right.
 * On narrow screens one switch picks what fills the screen.
 */
export default function Workspace() {
  const { terminal } = useCaseData();
  const [tool, setTool] = useState<Tool>(() => (sessionStorage.getItem("c404.tool") as Tool) || "terminal");
  const [view, setView] = useState<"board" | "tools">("board");
  const pick = (t: Tool) => {
    setTool(t);
    try {
      sessionStorage.setItem("c404.tool", t);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="workspace" data-view={view}>
      <div className="mobile-switch">
        <div className="segmented segmented-grid" role="group" aria-label="Show">
          <button type="button" aria-pressed={view === "board"} onClick={() => setView("board")}>
            Challenges
          </button>
          {TOOLS.map((t) => (
            <button
              key={t.id}
              type="button"
              aria-pressed={view === "tools" && tool === t.id}
              onClick={() => {
                setView("tools");
                pick(t.id);
              }}
            >
              {t.short}
            </button>
          ))}
        </div>
      </div>
      <section className="board" aria-label="Challenges">
        <ChallengeBoard />
      </section>
      <section className="tools" aria-label="Tools">
        <div className="tools-tabs" role="tablist" aria-label="Tools">
          {TOOLS.map((t) => (
            <button key={t.id} type="button" role="tab" id={`tab-${t.id}`} aria-selected={tool === t.id} aria-controls={`panel-${t.id}`} onClick={() => pick(t.id)}>
              <t.icon aria-hidden="true" /> {t.label}
            </button>
          ))}
        </div>
        {TOOLS.map((t) => (
          <div key={t.id} className="tool-panel" role="tabpanel" id={`panel-${t.id}`} aria-labelledby={`tab-${t.id}`} hidden={tool !== t.id}>
            {t.id === "terminal" ? (
              <Terminal session={terminal} />
            ) : t.id === "caesar" ? (
              <CaesarLab />
            ) : t.id === "timeline" ? (
              tool === "timeline" && <TimelinePanel />
            ) : t.id === "cheatsheet" ? (
              <CheatSheet />
            ) : (
              <NotesPanel />
            )}
          </div>
        ))}
      </section>
    </div>
  );
}
