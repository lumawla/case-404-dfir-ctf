import type { Note } from "@case404/shared";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ApiError, api } from "../../api";
import { ErrorNote, clockTime } from "../../components/ui";
import { useTeam } from "../../state/team";

const AUTOSAVE_MS = 900;

export function NoteEditor({ note, onSaved, onClose }: { note: Note; onSaved: (n: Note) => void; onClose: () => void }) {
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body);
  const [status, setStatus] = useState<"saved" | "saving" | "dirty" | "conflict" | "error">("saved");
  const [theirs, setTheirs] = useState<Note | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = useRef({ title: note.title, body: note.body });
  const saved = useRef({ title: note.title, body: note.body });
  const version = useRef(note.version);
  const blocked = useRef(false);
  const inFlight = useRef<Promise<boolean> | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const callbacks = useRef({ onSaved, onClose });
  callbacks.current = { onSaved, onClose };
  const id = useId();
  const dirty = () => current.current.title !== saved.current.title || current.current.body !== saved.current.body;

  // One writer per editor. Edits made during a request are sent afterwards using
  // the returned version, never the version captured by a debounce timer.
  const save = () : Promise<boolean> => {
    window.clearTimeout(timer.current);
    if (inFlight.current) return inFlight.current;
    if (blocked.current) return Promise.resolve(false);
    const run = async () => {
      while (dirty()) {
        const draft = { ...current.current };
        setStatus("saving");
        setError(null);
        try {
          const result = await api.updateNote(note.id, { ...draft, version: version.current });
          version.current = result.version;
          saved.current = draft;
          callbacks.current.onSaved(result);
        } catch (err) {
          const e = err as ApiError;
          if (e.status === 409 && e.data.current) {
            blocked.current = true;
            setTheirs(e.data.current as Note);
            setStatus("conflict");
          } else {
            setError(e.message || "Save failed. Your changes are still here. Retry before leaving.");
            setStatus("error");
          }
          return false;
        }
      }
      setStatus("saved");
      return true;
    };
    const pending = run();
    inFlight.current = pending;
    void pending.finally(() => { inFlight.current = null; });
    return pending;
  };
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (dirty()) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => {
      window.clearTimeout(timer.current);
      window.removeEventListener("beforeunload", warn);
      void saveRef.current();
    };
  }, []);

  const change = (t: string, b: string) => {
    current.current = { title: t, body: b };
    setTitle(t);
    setBody(b);
    if (blocked.current) return;
    setStatus("dirty");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { void saveRef.current(); }, AUTOSAVE_MS);
  };

  return (
    <div className="stack-sm">
      <div className="field">
        <label htmlFor={`${id}-t`}>Title</label>
        <input id={`${id}-t`} className="input" value={title} onChange={(e) => change(e.target.value, current.current.body)} maxLength={120} />
      </div>
      <div className="field">
        <label htmlFor={`${id}-b`}>Note</label>
        <textarea id={`${id}-b`} className="textarea" value={body} onChange={(e) => change(current.current.title, e.target.value)} maxLength={5000} />
      </div>
      <div className="spread">
        <span className="small muted" role="status">
          {status === "saving" ? "Saving…" : status === "saved" ? "Saved" : status === "conflict" ? "Review conflicting edits" : "Unsaved changes"}
        </span>
        <button type="button" className="btn btn-sm" disabled={status === "conflict"} onClick={async () => {
          if (await save()) callbacks.current.onClose();
        }}>Done</button>
      </div>
      {error && <ErrorNote>{error} <button className="btn btn-sm" onClick={() => { void save(); }}>Retry save</button></ErrorNote>}
      {status === "conflict" && theirs && (
        <div className="alert" role="alert">
          <Pencil aria-hidden="true" />
          <div className="stack-sm">
            <p><strong>{theirs.lastEditor ?? "A teammate"} edited this note while you were typing.</strong> Keep which version?</p>
            <pre className="panel pre-wrap" style={{ maxHeight: 160, overflow: "auto", margin: 0 }}>{theirs.title}{"\n"}{theirs.body}</pre>
            <div className="row">
              <button type="button" className="btn btn-sm" onClick={() => {
                current.current = saved.current = { title: theirs.title, body: theirs.body };
                setTitle(theirs.title); setBody(theirs.body); version.current = theirs.version;
                blocked.current = false; setTheirs(null); setStatus("saved");
                callbacks.current.onSaved(theirs);
              }}>Theirs</button>
              <button type="button" className="btn btn-sm btn-primary" onClick={() => {
                version.current = theirs.version; saved.current = { title: theirs.title, body: theirs.body }; blocked.current = false; setTheirs(null);
                void save();
              }}>Mine</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Shared team notes: everyone on the team sees and edits the same list. */
export function NotesPanel() {
  const { state } = useTeam();
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const id = useId();

  const load = useCallback(() => api.notes().then((r) => setNotes(r.notes)).catch((e: ApiError) => setError(e.message)), []);
  const rev = state?.revisions.notes;
  useEffect(() => {
    if (!editing) load();
  }, [load, rev, editing]);

  async function create(e: FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body) return;
    try {
      await api.createNote({ title: "", body });
      setDraft("");
      load();
    } catch (err) {
      setError((err as ApiError).message);
    }
  }

  return (
    <div className="notes">
      <h2>Team notes</h2>
      <form className="stack-sm" onSubmit={create}>
        <label htmlFor={`${id}-new`} className="field-label">
          New note <span className="muted small">(shared with your team)</span>
        </label>
        <textarea id={`${id}-new`} className="textarea" value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={5000} />
        <button className="btn btn-primary" style={{ justifySelf: "start" }} disabled={!draft.trim()}>
          <Plus aria-hidden="true" /> Add note
        </button>
      </form>
      {error && <ErrorNote>{error}</ErrorNote>}
      {notes?.length === 0 && <p className="empty">No notes yet.</p>}
      {notes?.map((n) => (
        <article key={n.id} className="note">
          {editing === n.id ? (
            <NoteEditor
              note={n}
              onSaved={(saved) => setNotes((all) => all?.map((x) => (x.id === saved.id ? saved : x)) ?? null)}
              onClose={() => {
                setEditing(null);
                load();
              }}
            />
          ) : (
            <>
              <div className="spread">
                <h3>{n.title}</h3>
                <span className="row" style={{ gap: 2 }}>
                  <button type="button" className="icon-btn" aria-label={`Edit “${n.title}”`} disabled={editing !== null} onClick={() => setEditing(n.id)}>
                    <Pencil />
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Delete “${n.title}”`}
                    onClick={async () => {
                      if (!window.confirm(`Delete “${n.title}” for your whole team?`)) return;
                      try {
                        await api.deleteNote(n.id, n.version);
                      } catch (err) {
                        setError((err as ApiError).message);
                      }
                      load();
                    }}
                  >
                    <Trash2 />
                  </button>
                </span>
              </div>
              {n.body && n.body !== n.title && <p className="pre-wrap">{n.body}</p>}
              <p className="xs muted">
                {n.author ?? "Someone"}
                {n.lastEditor && n.lastEditor !== n.author ? `, edited by ${n.lastEditor}` : ""} · {clockTime(n.updatedAt)}
              </p>
            </>
          )}
        </article>
      ))}
    </div>
  );
}
