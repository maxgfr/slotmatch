import { useState } from "react";
import { demoState, emptyState, exportJson, ImportError, importJson } from "../../core/store";
import { download, fmtDuration, fmtMinutes, isoDate, parseMinutes, TimeZoneSelect, useStore } from "../state";

export function DataPage() {
  const { state, update } = useStore();
  const [mode, setMode] = useState<"merge" | "replace">("merge");
  const [message, setMessage] = useState<{ kind: "ok" | "warn"; text: string } | null>(null);
  const s = state.settings;
  const setSettings = (patch: Partial<typeof s>) => update((st) => ({ ...st, settings: { ...st.settings, ...patch } }));

  const onImport = async (file: File | undefined) => {
    if (!file) return;
    try {
      const next = importJson(state, await file.text(), mode);
      update(() => next);
      setMessage({ kind: "ok", text: `Imported ${file.name} (${mode}).` });
    } catch (e) {
      setMessage({ kind: "warn", text: e instanceof ImportError ? e.message : "The file could not be read." });
    }
  };

  const loadDemo = () => {
    const demo = demoState(Date.now(), s.timeZone);
    update((st) => importJson(st, JSON.stringify(demo), "merge"));
    setMessage({ kind: "ok", text: "Demo people added: 6 team members across 5 time zones and 2 candidates who answered for the next working days." });
  };

  const reset = () => {
    if (!confirm("Delete all people and meetings from this browser? Export a backup first if you need one.")) return;
    update((st) => ({ ...emptyState(st.settings.timeZone), settings: st.settings }));
    setMessage({ kind: "ok", text: "All data deleted." });
  };

  return (
    <section className="page">
      <h1>Data & settings</h1>
      {message && (
        <p className={`banner ${message.kind}`} role="status">
          {message.text}
        </p>
      )}
      <div className="split">
        <fieldset className="card form-grid">
          <legend>Display</legend>
          <label className="span-2">
            Time zone for results, coverage and requests
            <TimeZoneSelect value={s.timeZone} onChange={(timeZone) => setSettings({ timeZone })} />
          </label>
          <label>
            Day starts
            <input
              type="time"
              step={1800}
              value={fmtMinutes(s.dayStartMin)}
              onChange={(e) => {
                const v = parseMinutes(e.target.value);
                if (!Number.isNaN(v) && v < s.dayEndMin) setSettings({ dayStartMin: v });
              }}
            />
          </label>
          <label>
            Day ends
            <input
              type="time"
              step={1800}
              value={fmtMinutes(s.dayEndMin)}
              onChange={(e) => {
                let v = parseMinutes(e.target.value);
                if (v === 0) v = 1440;
                if (!Number.isNaN(v) && v > s.dayStartMin) setSettings({ dayEndMin: v });
              }}
            />
          </label>
          <label>
            Default meeting length
            <select value={s.defaultDurationMin} onChange={(e) => setSettings({ defaultDurationMin: Number(e.target.value) })}>
              {[15, 30, 45, 60, 90].map((m) => (
                <option key={m} value={m}>
                  {fmtDuration(m)}
                </option>
              ))}
            </select>
          </label>
        </fieldset>

        <div className="stack">
          <fieldset className="card stack">
            <legend>Backup</legend>
            <p className="muted">
              {state.people.length} people and {state.meetings.length} meetings are stored in this browser only. Export a JSON backup to keep
              them or move them to another device.
            </p>
            <div className="actions">
              <button className="primary" onClick={() => download(`slotmatch-backup-${isoDate(Date.now(), s.timeZone)}.json`, exportJson(state), "application/json")}>
                Export JSON
              </button>
              <label className="file-button">
                Import JSON
                <input type="file" accept=".json,application/json" onChange={(e) => (void onImport(e.target.files?.[0]), (e.target.value = ""))} />
              </label>
            </div>
            <div className="radio-row" role="radiogroup" aria-label="Import mode">
              <label>
                <input type="radio" checked={mode === "merge"} onChange={() => setMode("merge")} /> Merge (update by id)
              </label>
              <label>
                <input type="radio" checked={mode === "replace"} onChange={() => setMode("replace")} /> Replace everything
              </label>
            </div>
          </fieldset>

          <fieldset className="card stack">
            <legend>Demo and reset</legend>
            <div className="actions">
              <button onClick={loadDemo}>Load demo data</button>
              <button className="danger" onClick={reset}>
                Delete all data
              </button>
            </div>
          </fieldset>
        </div>
      </div>
    </section>
  );
}
