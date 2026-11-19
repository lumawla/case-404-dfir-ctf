import { Settings2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Dialog } from "../components/Dialog";
import { SettingsPanel } from "../components/SettingsPanel";

export function PublicLayout({ children }: { children: ReactNode }) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  return (
    <div className="public-shell">
      <a className="skip-link" href="#main">
        Skip to main content
      </a>
      <header className="public-header">
        <Link to="/" className="brand" aria-label="Case 404 home">
          <img src="/favicon.svg" alt="" width={26} height={26} />
          <span>Case 404</span>
        </Link>
        <nav aria-label="Site" className="row" style={{ gap: 4 }}>
          <Link className="btn btn-ghost btn-sm" to="/leaderboard">
            Scoreboard
          </Link>
          <button type="button" className="icon-btn" onClick={() => setSettingsOpen(true)} aria-label="Display settings">
            <Settings2 />
          </button>
        </nav>
      </header>
      <main id="main" className="public-main" tabIndex={-1}>
        {children}
      </main>
      <footer className="footer">GDG × Criminology &amp; Forensics Club · A work of fiction: every person, account, payment and place in this case is invented.</footer>
      <Dialog open={settingsOpen} onClose={() => setSettingsOpen(false)} title="Display settings" variant="drawer">
        <SettingsPanel />
      </Dialog>
    </div>
  );
}
