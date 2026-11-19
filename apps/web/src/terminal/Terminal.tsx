import { Eraser, FolderTree } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { Loading } from "../components/ui";
import { FileTree } from "./FileTree";
import type { Out, Shell, Span } from "./shell";
import { prettyPath } from "./vfs";

let nextId = 1;

export type TermEntry = { id: number; prompt?: { user: string; path: string; cmd: string }; outs: Out[] };

/** A terminal's state: the shell and what's on screen. The case and the practice room each have one. */
export type TermSession = {
  shell: Shell | null;
  entries: TermEntry[];
  setEntries: (fn: (prev: TermEntry[]) => TermEntry[]) => void;
  showImage: (img: { src: string; name: string }) => void;
};

/** Appends a block of output to the terminal without a prompt line (notices from the system). */
export function notice(setEntries: TermSession["setEntries"], outs: Out[]) {
  setEntries((prev) => [...prev, { id: nextId++, outs }]);
}

function Spans({ spans }: { spans: Span[] }) {
  return (
    <>
      {spans.map((s, i) =>
        s.c ? (
          <span key={i} className={`t-${s.c}`}>
            {s.t}
          </span>
        ) : (
          s.t
        ),
      )}
    </>
  );
}

function Output({ out, onImage }: { out: Out; onImage: (src: string, name: string) => void }) {
  if (out.kind === "text") return <pre className={out.cls ? `t-${out.cls}` : undefined}>{out.text}</pre>;
  if (out.kind === "rich")
    return (
      <>
        {out.lines.map((line, i) => (
          <pre key={i} className="term-line">
            {line.length ? <Spans spans={line} /> : " "}
          </pre>
        ))}
      </>
    );
  if (out.kind === "image")
    return (
      <div>
        <button type="button" className="t-image" onClick={() => onImage(out.src, out.name)} aria-label={`Enlarge ${out.name}`}>
          <img src={out.src} alt={out.alt} />
        </button>
      </div>
    );
  if (out.kind === "link")
    return (
      <pre>
        <a className="t-link" href={out.href} target="_blank" rel="noopener noreferrer">
          {out.label}
        </a>
      </pre>
    );
  return null;
}

function Prompt({ user, path }: { user: string; path: string }) {
  return (
    <>
      <span className="t-user">{user}</span>
      <span className="t-dollar">:</span>
      <span className="t-path">{path}</span>
      <span className="t-dollar">$ </span>
    </>
  );
}

/** A bash-like terminal over the evidence file system. Commands run in-browser against the real evidence bytes. */
export function Terminal({ session }: { session: TermSession }) {
  const { shell, entries, setEntries, showImage } = session;
  const [line, setLine] = useState("");
  const [busy, setBusy] = useState(false);
  const [treeOpen, setTreeOpen] = useState(() => window.matchMedia?.("(min-width: 1300px)").matches ?? false);
  const histIndex = useRef<number | null>(null);
  const draft = useRef("");
  const screen = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const measure = useRef<HTMLSpanElement>(null);

  // Keep the shell's idea of the terminal width in sync, so ls lays out columns like a real terminal.
  useEffect(() => {
    const el = screen.current;
    if (!el || !shell) return;
    const update = () => {
      const ch = measure.current?.getBoundingClientRect().width || 8.4;
      shell.cols = Math.max(20, Math.floor((el.clientWidth - 32) / ch));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [shell]);

  useLayoutEffect(() => {
    const el = screen.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries, busy]);

  const run = useCallback(
    async (cmd: string) => {
      if (!shell) return;
      const prompt = { ...shell.prompt, cmd };
      histIndex.current = null;
      draft.current = "";
      setLine("");
      if (!cmd.trim()) {
        setEntries((prev) => [...prev, { id: nextId++, prompt, outs: [] }]);
        return;
      }
      setBusy(true);
      const outs = await shell.run(cmd);
      setBusy(false);
      const clearAt = outs.findIndex((o) => o.kind === "clear");
      if (clearAt >= 0) setEntries(() => [{ id: nextId++, outs: outs.slice(clearAt + 1) }]);
      else setEntries((prev) => [...prev, { id: nextId++, prompt, outs }]);
      requestAnimationFrame(() => input.current?.focus({ preventScroll: true }));
    },
    [shell, setEntries],
  );

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!shell) return;
    if (e.key === "Enter") {
      e.preventDefault();
      if (!busy) run(line);
    } else if (e.key === "Tab") {
      e.preventDefault();
      const res = shell.complete(line);
      if (res.line !== line) setLine(res.line);
      else if (res.options.length > 1) {
        setEntries((prev) => [...prev, { id: nextId++, prompt: { ...shell.prompt, cmd: line }, outs: [{ kind: "rich", lines: [res.options.map((o) => ({ t: `${o}  `, c: o.endsWith("/") ? ("dir" as const) : undefined }))] }] }]);
      }
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      const h = shell.history;
      if (!h.length) return;
      e.preventDefault();
      if (histIndex.current === null) {
        if (e.key === "ArrowDown") return;
        draft.current = line;
        histIndex.current = h.length;
      }
      const next = histIndex.current + (e.key === "ArrowUp" ? -1 : 1);
      if (next < 0) return;
      if (next >= h.length) {
        histIndex.current = null;
        setLine(draft.current);
        return;
      }
      histIndex.current = next;
      setLine(h[next]);
    } else if (e.ctrlKey && e.key.toLowerCase() === "l") {
      e.preventDefault();
      setEntries(() => []);
    } else if (e.ctrlKey && e.key.toLowerCase() === "c" && !window.getSelection()?.toString()) {
      e.preventDefault();
      setEntries((prev) => [...prev, { id: nextId++, prompt: { ...shell.prompt, cmd: `${line}^C` }, outs: [] }]);
      setLine("");
      histIndex.current = null;
    } else if (e.ctrlKey && e.key.toLowerCase() === "u") {
      e.preventDefault();
      setLine("");
    }
  };

  if (!shell) return <div style={{ padding: 16 }}><Loading label="Mounting the evidence" /></div>;

  const quote = (p: string) => (/[^\w./~-]/.test(p) ? `'${p}'` : p);
  const prompt = shell.prompt;
  return (
    <div className="term-wrap">
      <FileTree
        hidden={!treeOpen}
        root={shell.vfs.stat(shell.vfs.caseRoot)}
        onOpen={(node) => {
          const rel = `${prettyPath(shell.vfs.caseRoot)}/${node.casePath}`;
          run(`${/\.(jpe?g|png|svg|pdf)$/i.test(node.name) ? "open" : "cat"} ${quote(rel)}`);
          if (window.matchMedia?.("(max-width: 1000px)").matches) setTreeOpen(false);
        }}
      />
      <div className="term">
        <div className="term-bar">
          <button type="button" className="btn btn-ghost" aria-pressed={treeOpen} onClick={() => setTreeOpen((o) => !o)} aria-label={treeOpen ? "Hide file tree" : "Show file tree"}>
            <FolderTree aria-hidden="true" /> Files
          </button>
          <span className="title" aria-hidden="true">
            {prompt.user}: {prompt.path}
          </span>
          <button type="button" className="btn btn-ghost" onClick={() => setEntries(() => [])} aria-label="Clear the terminal">
            <Eraser aria-hidden="true" /> Clear
          </button>
        </div>
        <div
          ref={screen}
          className="term-screen"
          role="log"
          aria-label="Terminal output"
          onMouseUp={() => {
            if (!window.getSelection()?.toString()) input.current?.focus({ preventScroll: true });
          }}
        >
          <span ref={measure} aria-hidden="true" style={{ position: "absolute", visibility: "hidden", whiteSpace: "pre" }}>
            M
          </span>
          {entries.map((entry: TermEntry) => (
            <div key={entry.id} className="term-entry">
              {entry.prompt && (
                <pre className="term-line">
                  <Prompt user={entry.prompt.user} path={entry.prompt.path} />
                  {entry.prompt.cmd}
                </pre>
              )}
              {entry.outs.map((o, i) => (
                <Output key={i} out={o} onImage={(src, name) => showImage({ src, name })} />
              ))}
            </div>
          ))}
          <div className="term-input-row">
            <pre className="term-line">
              <Prompt user={prompt.user} path={prompt.path} />
            </pre>
            {busy ? (
              <span className="term-busy" aria-label="Running" />
            ) : (
              <input
                ref={input}
                className="term-input"
                value={line}
                onChange={(e) => {
                  setLine(e.target.value);
                  histIndex.current = null;
                }}
                onKeyDown={onKeyDown}
                aria-label="Terminal command"
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="go"
                autoFocus
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
