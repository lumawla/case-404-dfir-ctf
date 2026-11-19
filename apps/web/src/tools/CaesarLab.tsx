import { caesar } from "@case404/shared";
import { Copy, Minus, Plus } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { useTeam } from "../state/team";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

type LabState = { input: string; shift: number; mode: "decode" | "encode" };
const EMPTY: LabState = { input: "", shift: 0, mode: "decode" };

/**
 * A plain Caesar shift tool. It starts empty, knows nothing about the case and never suggests a
 * shift: players paste text and turn the dial themselves.
 */
export function CaesarLab() {
  const { state } = useTeam();
  const key = `c404.caesar.${state?.team.id ?? "anon"}`;
  const [lab, setLab] = useState<LabState>(() => {
    try {
      return { ...EMPTY, ...JSON.parse(localStorage.getItem(key) ?? "{}") };
    } catch {
      return EMPTY;
    }
  });
  const [copied, setCopied] = useState(false);
  const id = useId();

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(lab));
    } catch {
      /* not persisted */
    }
  }, [key, lab]);

  const setShift = (n: number) => setLab((l) => ({ ...l, shift: ((n % 26) + 26) % 26 }));
  const output = caesar(lab.input, lab.shift, lab.mode === "decode");
  const shifted = caesar(ALPHABET, lab.shift, lab.mode === "decode");

  return (
    <div className="lab">
      <h2>Caesar Lab</h2>
      <div className="field">
        <label htmlFor={`${id}-in`}>Input</label>
        <textarea
          id={`${id}-in`}
          className="textarea"
          value={lab.input}
          onChange={(e) => setLab((l) => ({ ...l, input: e.target.value }))}
          placeholder="Paste text here"
          spellCheck={false}
        />
      </div>

      <div className="lab-controls">
        <div className="shift-control">
          <span className="field-label" id={`${id}-shift-label`}>
            Shift
          </span>
          <button type="button" className="icon-btn" onClick={() => setShift(lab.shift - 1)} aria-label="Shift down by one">
            <Minus />
          </button>
          <output htmlFor={`${id}-range`} aria-live="off">
            {lab.shift}
          </output>
          <button type="button" className="icon-btn" onClick={() => setShift(lab.shift + 1)} aria-label="Shift up by one">
            <Plus />
          </button>
          <input id={`${id}-range`} type="range" min={0} max={25} value={lab.shift} onChange={(e) => setShift(Number(e.target.value))} aria-labelledby={`${id}-shift-label`} />
        </div>
        <div className="segmented" role="group" aria-label="Direction">
          {(["decode", "encode"] as const).map((m) => (
            <button key={m} type="button" aria-pressed={lab.mode === m} onClick={() => setLab((l) => ({ ...l, mode: m }))}>
              {m === "decode" ? "Shift back" : "Shift forward"}
            </button>
          ))}
        </div>
      </div>

      <div className="alphabet" aria-label={`Letter mapping: A becomes ${shifted[0]}`}>
        <span className="row-label">in</span>
        <span className="letters">{ALPHABET}</span>
        <span className="row-label">out</span>
        <span className="letters shifted">{shifted}</span>
      </div>

      <div className="field">
        <div className="spread">
          <span className="field-label" id={`${id}-out-label`}>
            Output
          </span>
          <button
            type="button"
            className="btn btn-sm"
            disabled={!output}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(output);
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1500);
              } catch {
                setCopied(false);
              }
            }}
          >
            <Copy aria-hidden="true" /> {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <pre className="lab-output" aria-labelledby={`${id}-out-label`}>
          {output}
        </pre>
      </div>
    </div>
  );
}
