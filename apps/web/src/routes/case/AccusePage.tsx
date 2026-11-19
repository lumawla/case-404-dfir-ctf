import type { AccusationOptions } from "@case404/shared";
import { Gavel, Lock } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError, api } from "../../api";
import { Dialog } from "../../components/Dialog";
import { ErrorNote, Loading, PageHead, Portrait, clockTime } from "../../components/ui";
import { useCaseData } from "../../state/caseData";
import { useTeam } from "../../state/team";

/** Suspect + motive + up to three files, and optionally who helped. The server says only whether it holds, never why. */
export default function AccusePage() {
  const { state, refresh } = useTeam();
  const { listing } = useCaseData();
  const navigate = useNavigate();
  const [options, setOptions] = useState<AccusationOptions | null>(null);
  const [suspect, setSuspect] = useState("");
  const [motive, setMotive] = useState("");
  const [accomplice, setAccomplice] = useState("none");
  const [files, setFiles] = useState(["", "", ""]);
  const [confirm, setConfirm] = useState(false);
  const submitting = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const id = useId();

  const load = () =>
    api
      .accusation()
      .then(setOptions)
      .catch((e: ApiError) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  // Suggest visible files only; anything else can still be typed by path.
  const suggestions = useMemo(() => (listing?.files ?? []).map((f) => f.path).filter((p) => !p.split("/").some((part) => part.startsWith("."))), [listing]);

  if (error && !options) return <div className="page"><ErrorNote>{error}</ErrorNote></div>;
  if (!options || !state) return <div className="page"><Loading /></div>;

  if (!options.open)
    return (
      <div className="page stack">
        <PageHead eyebrow="Sealed" title="Accuse" />
        <div className="alert">
          <Lock aria-hidden="true" />
          <p>Accusations open with Act III. Until then, keep working the evidence.</p>
        </div>
      </div>
    );

  const left = options.attemptsMax - options.attemptsUsed;
  const active = state.team.status === "ACTIVE" && !state.clock.paused;
  const cited = files.map((f) => f.trim()).filter(Boolean);
  const ready = suspect && motive && cited.length > 0;

  async function submit() {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const res = await api.accuse(suspect, motive, accomplice === "none" ? null : accomplice, cited, options!.attemptsUsed + 1);
      setConfirm(false);
      await refresh();
      if (res.status === "incorrect") {
        setMessage(`${res.message}${res.penalty ? ` (−${res.penalty} pts)` : ""}`);
        load();
      } else navigate("/case/result");
    } catch (err) {
      setConfirm(false);
      setError((err as ApiError).message);
      load();
      refresh();
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="page stack">
      <PageHead eyebrow={`${left} of ${options.attemptsMax} attempts left`} title="Accuse">
        Name the killer, the motive, and up to {options.maxFiles} files from <span className="mono">~/case404</span> that prove it. A wrong first accusation costs 10 points; a wrong second one closes the case. Naming
        anyone who helped is optional: +{options.accompliceBonus} points if the accusation holds and you're right.
      </PageHead>

      {message && (
        <div className="alert" role="alert">
          <Gavel aria-hidden="true" />
          <p>{message}</p>
        </div>
      )}
      {error && <ErrorNote>{error}</ErrorNote>}

      <form
        className="stack"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (ready && active && left > 0) setConfirm(true);
        }}
      >
        <fieldset className="stack-sm" style={{ border: 0, margin: 0, padding: 0 }}>
          <legend className="field-label" style={{ marginBottom: 8 }}>
            Who killed Nadia?
          </legend>
          <div className="suspect-pick">
            {options.suspects.map((s) => (
              <label key={s.id}>
                <input
                  type="radio"
                  name="suspect"
                  value={s.id}
                  checked={suspect === s.id}
                  onChange={() => {
                    setSuspect(s.id);
                    if (accomplice === s.id) setAccomplice("none");
                  }}
                />
                <Portrait src={s.portrait} alt="" />
                <span>{s.name}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="stack-sm" style={{ border: 0, margin: 0, padding: 0 }}>
          <legend className="field-label" style={{ marginBottom: 8 }}>
            Why?
          </legend>
          <div className="motives">
            {options.motives.map((m) => (
              <label key={m.id} className="choice">
                <input type="radio" name="motive" value={m.id} checked={motive === m.id} onChange={() => setMotive(m.id)} />
                <span>{m.label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="stack-sm" style={{ border: 0, margin: 0, padding: 0 }}>
          <legend className="field-label" style={{ marginBottom: 8 }}>
            Did anyone help?
          </legend>
          <div className="motives">
            <label className="choice">
              <input type="radio" name="accomplice" value="none" checked={accomplice === "none"} onChange={() => setAccomplice("none")} />
              <span>No one</span>
            </label>
            {options.suspects
              .filter((s) => s.id !== suspect)
              .map((s) => (
                <label key={s.id} className="choice">
                  <input type="radio" name="accomplice" value={s.id} checked={accomplice === s.id} onChange={() => setAccomplice(s.id)} />
                  <span>{s.name}</span>
                </label>
              ))}
          </div>
        </fieldset>

        <fieldset className="stack-sm" style={{ border: 0, margin: 0, padding: 0 }}>
          <legend className="field-label" style={{ marginBottom: 8 }}>
            Evidence (paths relative to ~/case404)
          </legend>
          <div className="file-slots">
            {files.map((f, i) => (
              <input
                key={i}
                className="input mono"
                list={`${id}-files`}
                value={f}
                onChange={(e) => setFiles((all) => all.map((x, j) => (j === i ? e.target.value : x)))}
                placeholder={`file ${i + 1}${i ? " (optional)" : ""}`}
                aria-label={`Evidence file ${i + 1}`}
                autoComplete="off"
                spellCheck={false}
              />
            ))}
          </div>
          <datalist id={`${id}-files`}>
            {suggestions.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </fieldset>

        <div className="row">
          <button className="btn btn-primary btn-lg" disabled={!ready || !active || left <= 0}>
            <Gavel aria-hidden="true" /> File the accusation
          </button>
          {!active && <span className="small muted">{state.team.status === "ACTIVE" ? "Paused by the organizers." : "Your case is closed."}</span>}
        </div>
      </form>

      {options.previous.length > 0 && (
        <section className="stack-sm" aria-labelledby={`${id}-prev`}>
          <h2 id={`${id}-prev`}>Previous accusations</h2>
          {options.previous.map((p) => (
            <div key={p.attemptNo} className="panel small">
              <strong>#{p.attemptNo}</strong> · {options.suspects.find((s) => s.id === p.suspectId)?.name} · {options.motives.find((m) => m.id === p.motiveId)?.label} ·{" "}
              {p.accompliceId ? `helped by ${options.suspects.find((s) => s.id === p.accompliceId)?.name} · ` : ""}
              <span className="mono">{p.files.join(", ")}</span> · {p.correct ? "held" : "did not hold"} · {clockTime(p.at)}
            </div>
          ))}
        </section>
      )}

      <Dialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title="File this accusation?"
        footer={
          <>
            <button type="button" className="btn" onClick={() => setConfirm(false)}>
              Not yet
            </button>
            <button type="button" className="btn btn-primary" onClick={submit} disabled={busy} aria-busy={busy}>
              <Gavel aria-hidden="true" /> Accuse
            </button>
          </>
        }
      >
        <p>
          <strong>{options.suspects.find((s) => s.id === suspect)?.name}</strong>, {options.motives.find((m) => m.id === motive)?.label.toLowerCase()}.
          {accomplice !== "none" && (
            <>
              {" "}
              Helped by <strong>{options.suspects.find((s) => s.id === accomplice)?.name}</strong>.
            </>
          )}
        </p>
        <ul className="mono small">
          {cited.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
        <p className="muted small" style={{ marginBottom: 0 }}>
          This uses attempt {options.attemptsUsed + 1} of {options.attemptsMax}. A successful accusation closes your case immediately and ends further scoring. A final unsuccessful accusation also closes your case. This cannot be undone by players.
        </p>
      </Dialog>
    </div>
  );
}
