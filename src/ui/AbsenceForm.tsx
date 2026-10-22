import { useState } from "react";
import { ABSENCE_LABELS, absenceLength, validAbsence } from "../core/calendar";
import type { Absence } from "../core/model";
import { newId } from "../core/store";
import { fmtDate, isoDate } from "./state";

/** Dates are local to the person the absence is added to. */
export function AbsenceForm({ timeZone, onAdd, disabled }: { timeZone: string; onAdd: (a: Absence) => void; disabled?: boolean }) {
  const [from, setFrom] = useState(() => isoDate(Date.now(), timeZone));
  const [to, setTo] = useState(from);
  const [fromPm, setFromPm] = useState(false);
  const [toAm, setToAm] = useState(false);
  const [kind, setKind] = useState<Absence["kind"]>("vacation");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const single = from === to;
  const draft: Absence = {
    id: "",
    kind,
    from,
    to,
    ...(fromPm ? { fromPm: true } : {}),
    // On a single day the two flags are one choice: keep only the latest.
    ...(toAm && !(single && fromPm) ? { toAm: true } : {}),
    ...(note.trim() ? { note: note.trim() } : {}),
  };
  const valid = validAbsence(draft);

  const add = () => {
    if (!valid) {
      setError("Pick a last day on or after the first day.");
      return;
    }
    setError("");
    onAdd({ ...draft, id: newId() });
    setNote("");
  };

  return (
    <div className="inline-form">
      <label>
        First day
        <input
          type="date"
          value={from}
          onChange={(e) => {
            setFrom(e.target.value);
            if (e.target.value > to) setTo(e.target.value);
          }}
        />
      </label>
      <label>
        Last day
        <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
      </label>
      <label>
        Type
        <select value={kind} onChange={(e) => setKind(e.target.value as Absence["kind"])}>
          {Object.entries(ABSENCE_LABELS).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="grow">
        Note
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
      </label>
      {single ? (
        <label>
          Part of the day
          <select
            value={fromPm ? "pm" : toAm ? "am" : "full"}
            onChange={(e) => {
              setFromPm(e.target.value === "pm");
              setToAm(e.target.value === "am");
            }}
          >
            <option value="full">Whole day</option>
            <option value="am">Morning only</option>
            <option value="pm">Afternoon only</option>
          </select>
        </label>
      ) : (
        <div className="checks" role="group" aria-label="Half days">
          <label className="check">
            <input type="checkbox" checked={fromPm} onChange={(e) => setFromPm(e.target.checked)} />
            First day: afternoon only
          </label>
          <label className="check">
            <input type="checkbox" checked={toAm} onChange={(e) => setToAm(e.target.checked)} />
            Last day: morning only
          </label>
        </div>
      )}
      <button type="button" onClick={add} disabled={disabled}>
        Add {valid ? fmtDays(absenceLength(draft)) : "absence"}
      </button>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** "1 day", "2.5 days", "½ day" */
export const fmtDays = (n: number) => (n === 0.5 ? "½ day" : `${n} ${n === 1 ? "day" : "days"}`);

/** "Mon 12 Oct afternoon – Wed 14 Oct morning · 2 days" */
export function describeAbsence(a: Absence): string {
  if (a.from === a.to) return `${fmtDate(a.from)}${a.fromPm ? " afternoon" : a.toAm ? " morning" : ""}`;
  return `${fmtDate(a.from)}${a.fromPm ? " afternoon" : ""} – ${fmtDate(a.to)}${a.toAm ? " morning" : ""} · ${fmtDays(absenceLength(a))}`;
}

/** Kind badge, dates and note, for absence lists. */
export function AbsenceLine({ absence }: { absence: Absence }) {
  return (
    <>
      <span className={`badge abs-${absence.kind}`}>{ABSENCE_LABELS[absence.kind]}</span> {describeAbsence(absence)}
      {absence.note ? <span className="muted"> · {absence.note}</span> : null}
    </>
  );
}
