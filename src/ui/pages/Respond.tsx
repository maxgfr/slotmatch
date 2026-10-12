import { useEffect, useMemo, useState } from "react";
import { isValidTimeZone, localDays } from "../../core/expand";
import { clip, totalDuration } from "../../core/intervals";
import type { Interval } from "../../core/model";
import { decodeRequest, encodeResponse, ShareError, shareUrl, type ShareRequest } from "../../core/share";
import { appBaseUrl } from "../router";
import { browserTimeZone, copyText, fmtDay, fmtDuration, fmtSlot, TimeZoneSelect } from "../state";
import { cellInterval, cellsToIntervals, intervalsToCells, WeekGrid } from "../WeekGrid";

const STEP = 30;
const ROWS = (24 * 60) / STEP;

/** The page a respondent sees. It never reads or writes the organiser's local data. */
export function RespondPage({ data }: { data: string }) {
  const [request, setRequest] = useState<ShareRequest | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    decodeRequest(data)
      .then((r) => live && setRequest(r))
      .catch((e: unknown) => live && setError(e instanceof ShareError ? e.message : "This link could not be read."));
    return () => {
      live = false;
    };
  }, [data]);

  return (
    <div className="app respond">
      <header className="topbar slim">
        <span className="brand">
          <span className="brand-mark" aria-hidden="true" />
          slotmatch
        </span>
      </header>
      <main id="main">
        {error ? (
          <section className="page narrow">
            <h1>This link does not work</h1>
            <p>{error}</p>
            <p className="muted">Ask the person who sent it for a fresh link. It may have been cut when copied.</p>
          </section>
        ) : !request ? (
          <section className="page narrow">
            <p className="muted">Opening the request…</p>
          </section>
        ) : (
          <RespondForm request={request} />
        )}
      </main>
    </div>
  );
}

function RespondForm({ request }: { request: ShareRequest }) {
  const [tz, setTz] = useState(browserTimeZone());
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [available, setAvailable] = useState<Interval[]>([]);
  const [preferred, setPreferred] = useState<Interval[]>([]);
  const [link, setLink] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  const days = useMemo(() => localDays(request.range, tz), [request.range, tz]);
  const columns = days.map((d) => ({ key: String(d), label: fmtDay(d, tz) }));

  const { disabled, highlight } = useMemo(() => {
    const disabled: boolean[] = [];
    const highlight: boolean[] = [];
    for (const day of days) {
      for (let r = 0; r < ROWS; r++) {
        const iv = cellInterval(day, r, STEP, tz);
        disabled.push(iv.start < request.range.start || iv.end > request.range.end);
        highlight.push((request.slots ?? []).some((s) => s.start < iv.end && iv.start < s.end));
      }
    }
    return { disabled, highlight };
  }, [days, tz, request]);

  const cells = useMemo(() => intervalsToCells(days, ROWS, STEP, tz, available, preferred), [days, tz, available, preferred]);
  const hours = totalDuration(available) / 3_600_000;

  const generate = async () => {
    if (!name.trim()) {
      setError("Add your name so the organiser knows who answered.");
      return;
    }
    if (!available.length) {
      setError("Paint at least one time when you are free.");
      return;
    }
    setError("");
    const data = await encodeResponse({
      name: name.trim(),
      ...(email.trim() ? { email: email.trim() } : {}),
      timeZone: tz,
      range: request.range,
      available: clip(available, request.range),
      preferred: clip(preferred, request.range),
      title: request.title,
    });
    setLink(shareUrl(appBaseUrl(), "import", data));
    setCopied(false);
  };

  return (
    <section className="page">
      <h1>{request.title}</h1>
      <p className="lead">
        When could you meet for {fmtDuration(request.durationMin)}? Paint every time that works for you between {fmtDay(request.range.start, tz)}{" "}
        and {fmtDay(request.range.end - 1, tz)}. Use <em>Preferred</em> for the times you like best.
      </p>

      <div className="form-grid compact card">
        <label>
          Your name
          <input value={name} onChange={(e) => (setName(e.target.value), setLink(""))} autoComplete="name" />
        </label>
        <label>
          Email <span className="muted">(optional)</span>
          <input type="email" value={email} onChange={(e) => (setEmail(e.target.value), setLink(""))} autoComplete="email" />
        </label>
        <label>
          Your time zone
          <TimeZoneSelect value={tz} onChange={(z) => isValidTimeZone(z) && setTz(z)} />
        </label>
        <p className="muted small span-2">
          The organiser is in {request.timeZone.replace(/_/g, " ")}. Times below are shown in yours; they convert automatically.
        </p>
      </div>

      {request.slots && request.slots.length > 0 && (
        <div className="banner">
          Suggested times (outlined in the grid):{" "}
          {request.slots.map((s) => fmtSlot(s.start, s.end, tz)).join(" · ")}
        </div>
      )}

      <WeekGrid
        label="Your availability"
        columns={columns}
        stepMin={STEP}
        rows={ROWS}
        value={cells}
        disabled={disabled}
        highlight={highlight}
        scrollToMin={8 * 60}
        onChange={(next) => {
          const r = cellsToIntervals(days, ROWS, STEP, tz, next);
          setAvailable(r.available);
          setPreferred(r.preferred);
          setLink("");
        }}
      />
      <p className="muted small" aria-live="polite">
        {hours ? `${hours} h selected.` : "Nothing selected yet."}
      </p>

      <div className="card stack">
        <h2 className="h3">Send your answer</h2>
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        <div className="actions">
          <button className="primary" onClick={() => void generate()}>
            Create answer link
          </button>
        </div>
        {link && (
          <div className="share-box">
            <label>
              Send this link back to the organiser
              <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
            </label>
            <div className="actions">
              <button onClick={async () => setCopied(await copyText(link))}>{copied ? "Copied" : "Copy link"}</button>
            </div>
            <p className="muted small">Your answer lives only inside this link. Nothing was sent anywhere.</p>
          </div>
        )}
      </div>
    </section>
  );
}
