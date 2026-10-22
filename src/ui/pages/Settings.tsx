import { useEffect, useState } from "react";
import { selfTest, type Check } from "../../core/health";
import { demoState, emptyState, exportJson, ImportError, importJson, STATE_VERSION, STORAGE_KEY, type AppState } from "../../core/store";
import { download, fmtDuration, fmtDay, fmtMinutes, fmtTime, isoDate, parseMinutes, TimeZoneSelect, TIME_ZONES, useStore } from "../state";
import { applyUpdate, BUILD, REPOSITORY, useUpdateStatus } from "../update";

export function SettingsPage() {
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
      <h1>Settings</h1>
      {message && (
        <p className={`banner ${message.kind}`} role="status">
          {message.text}
        </p>
      )}
      <div className="split">
        <AppCard timeZone={s.timeZone} />
        <HealthCard state={state} />
      </div>
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

function AppCard({ timeZone }: { timeZone: string }) {
  const { status, recheck } = useUpdateStatus();
  const [updating, setUpdating] = useState(false);
  const commit = (sha: string) =>
    sha === "unknown" ? (
      "unknown commit"
    ) : (
      <a href={`${REPOSITORY}/commit/${sha}`} target="_blank" rel="noopener">
        <code>{sha.slice(0, 7)}</code>
      </a>
    );
  const built = (iso: string) => `${fmtDay(Date.parse(iso), timeZone)} ${fmtTime(Date.parse(iso), timeZone)}`;

  return (
    <section className="card stack">
      <h2 className="h3">App</h2>
      <dl className="facts">
        <dt>This copy</dt>
        <dd>{BUILD ? <>v{BUILD.version} · {commit(BUILD.commit)} · built {built(BUILD.builtAt)}</> : "Development server (not a release build)"}</dd>
        <dt>Online</dt>
        <dd aria-live="polite">
          {!status ? (
            <span className="muted">Checking…</span>
          ) : status.state === "dev" ? (
            <span className="muted">Not checked on the development server.</span>
          ) : status.state === "unknown" ? (
            <span className="warn-text">Could not check: {status.reason}</span>
          ) : status.state === "current" ? (
            <span className="ok-text">✓ Up to date</span>
          ) : (
            <span className="warn-text">
              Update available: v{status.online.version} · {commit(status.online.commit)} · built {built(status.online.builtAt)}
            </span>
          )}
        </dd>
      </dl>
      <div className="actions">
        {status?.state === "available" && (
          <button className="primary" disabled={updating} onClick={() => (setUpdating(true), void applyUpdate())}>
            {updating ? "Updating…" : "Update now"}
          </button>
        )}
        <button onClick={recheck} disabled={!status || status.state === "dev"}>
          Check again
        </button>
        <a className="button" href={`${REPOSITORY}/commits/main`} target="_blank" rel="noopener">
          Changes
        </a>
      </div>
      <p className="muted small">Updating reloads the page with the latest version. People, meetings and settings stay in this browser.</p>
    </section>
  );
}

/** Browser features the app depends on. */
function browserChecks(): Check[] {
  let storage: Check;
  try {
    const key = `${STORAGE_KEY}:probe`;
    localStorage.setItem(key, "1");
    const ok = localStorage.getItem(key) === "1";
    localStorage.removeItem(key);
    const used = new Blob([localStorage.getItem(STORAGE_KEY) ?? ""]).size;
    storage = ok
      ? { label: "Browser storage", ok: true, detail: `Saving works. ${(used / 1024).toFixed(1)} KB used (data format v${STATE_VERSION}).` }
      : { label: "Browser storage", ok: false, detail: "Saved values do not read back." };
  } catch {
    storage = { label: "Browser storage", ok: false, detail: "Blocked: changes are lost when the page closes. Export a backup." };
  }
  const links = typeof CompressionStream === "function" && typeof DecompressionStream === "function";
  const clipboard = typeof navigator.clipboard?.writeText === "function";
  return [
    storage,
    {
      label: "Link compression",
      ok: links,
      detail: links ? "Request, answer and calendar links can be created and opened." : "This browser cannot create or open share links.",
    },
    { label: "Time zones", ok: TIME_ZONES.length > 100, detail: `${TIME_ZONES.length} zones known to this browser.` },
    {
      label: "Clipboard",
      ok: clipboard,
      detail: clipboard ? "Copy buttons work." : "Copy buttons are unavailable: select links by hand.",
    },
  ];
}

function HealthCard({ state }: { state: AppState }) {
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [run, setRun] = useState(0);

  // Runs on open and on demand, on the data as it is at that moment.
  useEffect(() => {
    let live = true;
    setChecks(null);
    void selfTest(state, Date.now()).then((data) => live && setChecks([...browserChecks(), ...data]));
    return () => {
      live = false;
    };
  }, [run]);

  const failed = checks?.filter((c) => !c.ok).length ?? 0;
  return (
    <section className="card stack">
      <h2 className="h3">Health</h2>
      {!checks ? (
        <p className="muted">Running checks…</p>
      ) : (
        <>
          <p className={failed ? "warn-text" : "ok-text"} role="status">
            {failed ? `${failed} of ${checks.length} checks failed.` : `All ${checks.length} checks passed.`}
          </p>
          <ul className="checklist">
            {checks.map((c) => (
              <li key={c.label} className={c.ok ? "ok" : "fail"}>
                <span aria-hidden="true">{c.ok ? "✓" : "✗"}</span>
                <span>
                  <strong>{c.label}</strong>
                  <span className="sr-only">{c.ok ? ": passed" : ": failed"}</span>
                  <span className="muted small"> {c.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="actions">
        <button onClick={() => setRun((n) => n + 1)} disabled={!checks}>
          Run checks again
        </button>
      </div>
    </section>
  );
}
