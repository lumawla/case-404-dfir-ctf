import { useSettings } from "../state/settings";

export function SettingsPanel() {
  const { settings, update } = useSettings();
  return (
    <div className="stack">
      <fieldset className="stack-sm" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="field-label">Text size</legend>
        <div className="row">
          {(["base", "lg", "xl"] as const).map((v) => (
            <label key={v} className="choice" style={{ flex: 1, minWidth: 90 }}>
              <input type="radio" name="textScale" checked={settings.textScale === v} onChange={() => update({ textScale: v })} />
              {v === "base" ? "Default" : v === "lg" ? "Large" : "Larger"}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="stack-sm" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="field-label">Motion</legend>
        <div className="row">
          {(["system", "reduce", "full"] as const).map((v) => (
            <label key={v} className="choice" style={{ flex: 1, minWidth: 90 }}>
              <input type="radio" name="motion" checked={settings.motion === v} onChange={() => update({ motion: v })} />
              {v === "system" ? "Follow device" : v === "reduce" ? "Reduce" : "Full"}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="checkbox">
        <input type="checkbox" checked={settings.contrast === "high"} onChange={(e) => update({ contrast: e.target.checked ? "high" : "normal" })} />
        <span>
          <strong>Higher contrast</strong>
          <br />
          <span className="small muted">Brighter secondary text and stronger outlines.</span>
        </span>
      </label>
      <label className="checkbox">
        <input type="checkbox" checked={settings.sound} onChange={(e) => update({ sound: e.target.checked })} />
        <span>
          <strong>Sound</strong>
          <br />
          <span className="small muted">A short chime when your team owns a challenge. Off by default.</span>
        </span>
      </label>
      <p className="small muted">Saved on this device only.</p>
    </div>
  );
}
