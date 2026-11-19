import { Search } from "lucide-react";
import { useId, useState } from "react";
import { CHEATSHEET } from "../terminal/cheatsheet";

/** What each terminal tool is for, with examples. Generic on purpose: it teaches the tools, not the case. */
export function CheatSheet() {
  const [query, setQuery] = useState("");
  const id = useId();
  const q = query.trim().toLowerCase();
  const sections = CHEATSHEET.map((s) => ({
    ...s,
    entries: s.entries.filter((e) => !q || e.cmd.toLowerCase().includes(q) || e.what.toLowerCase().includes(q) || e.examples.some(([x, w]) => x.toLowerCase().includes(q) || w.toLowerCase().includes(q))),
  })).filter((s) => s.entries.length);

  return (
    <div className="cheatsheet">
      <div className="cheat-head">
        <h2>Cheat sheet</h2>
        <label className="cheat-search" htmlFor={`${id}-q`}>
          <Search aria-hidden="true" />
          <span className="visually-hidden">Find a command</span>
          <input id={`${id}-q`} className="input" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a command, e.g. metadata" />
        </label>
      </div>
      <p className="muted small">
        Type these in the terminal. <span className="mono">help</span> lists every command; <span className="mono">help grep</span> shows one command's options and examples. File names below are only examples.
      </p>
      {sections.length === 0 && <p className="muted">Nothing matches “{query}”.</p>}
      {sections.map((s) => (
        <section key={s.title} className="cheat-section" aria-labelledby={`${id}-${s.title}`}>
          <h3 id={`${id}-${s.title}`}>{s.title}</h3>
          {s.intro && <p className="small">{s.intro}</p>}
          <dl className="cheat-list">
            {s.entries.map((e) => (
              <div key={e.cmd} className="cheat-entry">
                <dt>
                  <span className="mono">{e.cmd}</span>
                  <span>{e.what}</span>
                </dt>
                {e.examples.map(([example, what]) => (
                  <dd key={example}>
                    <code>{example}</code>
                    <span className="muted">{what}</span>
                  </dd>
                ))}
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}
