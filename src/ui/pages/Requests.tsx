import { useState } from "react";
import { zonedTime } from "../../core/expand";
import { encodeRequest, shareUrl } from "../../core/share";
import { appBaseUrl, href, navigate } from "../router";
import { copyText, fmtDay, fmtDuration, isoDate, useSessionState, useStore } from "../state";

export function RequestsPage() {
  const { state } = useStore();
  const tz = state.settings.timeZone;
  const [form, setForm] = useSessionState("requests", () => ({
    title: "",
    from: isoDate(Date.now() + 86_400_000, tz),
    days: 5,
    durationMin: state.settings.defaultDurationMin,
  }));
  const [link, setLink] = useState("");
  const [copied, setCopied] = useState(false);
  const [paste, setPaste] = useState("");
  const [pasteError, setPasteError] = useState("");
  const set = (patch: Partial<typeof form>) => {
    setForm((f) => ({ ...f, ...patch }));
    setLink("");
  };

  const [y, m, d] = form.from.split("-").map(Number);
  const valid = Boolean(y && m && d);
  const range = valid ? { start: zonedTime(y!, m! - 1, d!, 0, tz), end: zonedTime(y!, m! - 1, d! + form.days, 0, tz) } : null;

  const create = async () => {
    if (!range) return;
    const data = await encodeRequest({ title: form.title.trim() || "Availability request", range, durationMin: form.durationMin, timeZone: tz });
    setLink(shareUrl(appBaseUrl(), "respond", data));
    setCopied(false);
  };

  const openResponse = () => {
    const match = paste.match(/[#&?]d=([A-Za-z0-9_-]+)/) ?? paste.trim().match(/^([A-Za-z0-9_-]{8,})$/);
    if (!match) {
      setPasteError("This does not look like a slotmatch response link.");
      return;
    }
    setPasteError("");
    navigate(`/import?d=${match[1]}`);
  };

  return (
    <section className="page">
      <h1>Requests</h1>
      <p className="lead">
        Ask someone outside the team when they are free. They paint their availability in their own time zone and send you back a link.
        Nothing goes through a server: the data travels inside the links.
      </p>
      <ol className="steps">
        <li>Create a link and send it (email, chat…).</li>
        <li>They open it, paint their free time and copy the answer link.</li>
        <li>They send it back; you open it here to add or update the person.</li>
      </ol>

      <div className="split">
        <fieldset className="card stack">
          <legend>1. New request</legend>
          <div className="form-grid compact">
            <label className="span-2">
              Title
              <input value={form.title} onChange={(e) => set({ title: e.target.value })} placeholder="Interview: Backend engineer" />
            </label>
            <label>
              From
              <input type="date" value={form.from} onChange={(e) => set({ from: e.target.value })} />
            </label>
            <label>
              Days
              <input type="number" min={1} max={21} value={form.days} onChange={(e) => set({ days: Math.min(21, Math.max(1, Number(e.target.value) || 1)) })} />
            </label>
            <label>
              Meeting length
              <select value={form.durationMin} onChange={(e) => set({ durationMin: Number(e.target.value) })}>
                {[15, 30, 45, 60, 90, 120].map((m) => (
                  <option key={m} value={m}>
                    {fmtDuration(m)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {range && (
            <p className="muted small">
              Covers {fmtDay(range.start, tz)} to {fmtDay(range.end - 1, tz)} ({tz.replace(/_/g, " ")}).
            </p>
          )}
          <div className="actions">
            <button className="primary" onClick={() => void create()} disabled={!valid}>
              Create link
            </button>
          </div>
          {link && (
            <div className="share-box">
              <label>
                Link to send
                <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
              </label>
              <div className="actions">
                <button onClick={async () => setCopied(await copyText(link))}>{copied ? "Copied" : "Copy"}</button>
                <a className="button" href={link} target="_blank" rel="noopener">
                  Preview
                </a>
              </div>
            </div>
          )}
        </fieldset>

        <fieldset className="card stack">
          <legend>3. Open an answer</legend>
          <label>
            Response link
            <input value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="https://…#/import?d=…" />
          </label>
          {pasteError && (
            <p className="field-error" role="alert">
              {pasteError}
            </p>
          )}
          <div className="actions">
            <button onClick={openResponse} disabled={!paste.trim()}>
              Open
            </button>
          </div>
          <p className="muted small">
            Opening the link directly in this browser works too. Imported people show up in <a href={href("/people")}>People</a>.
          </p>
        </fieldset>
      </div>
    </section>
  );
}
