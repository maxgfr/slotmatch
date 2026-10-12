import { useState, type FormEvent } from "react";
import { isValidTimeZone, zonedTime } from "../../core/expand";
import { parseIcs } from "../../core/ics";
import { DAY, type AvailabilityException, type Person, type WeeklyBlock } from "../../core/model";
import { newId } from "../../core/store";
import { href, navigate } from "../router";
import { browserTimeZone, fmtSlot, isoDate, parseMinutes, TimeZoneSelect, useStore } from "../state";
import { WeekGrid, type Cell } from "../WeekGrid";

const STEP = 30;
const ROWS = (24 * 60) / STEP;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const COLUMNS = WEEKDAYS.map((d) => ({ key: d, label: d }));

function blocksToCells(weekly: readonly WeeklyBlock[]): Cell[] {
  const cells: Cell[] = new Array(7 * ROWS).fill(0);
  for (const b of weekly) {
    for (let r = 0; r < ROWS; r++) {
      const s = r * STEP;
      if (s < b.endMin && s + STEP > b.startMin) {
        const i = b.day * ROWS + r;
        cells[i] = Math.max(cells[i]!, b.level === "preferred" ? 2 : 1) as Cell;
      }
    }
  }
  return cells;
}

function cellsToBlocks(cells: readonly Cell[]): WeeklyBlock[] {
  const out: WeeklyBlock[] = [];
  for (let day = 0; day < 7; day++) {
    let r = 0;
    while (r < ROWS) {
      const v = cells[day * ROWS + r]!;
      if (!v) {
        r++;
        continue;
      }
      const start = r;
      while (r < ROWS && cells[day * ROWS + r] === v) r++;
      out.push({ day: day as WeeklyBlock["day"], startMin: start * STEP, endMin: r * STEP, level: v === 2 ? "preferred" : "available" });
    }
  }
  return out;
}

function blankPerson(timeZone: string): Person {
  return { id: newId(), name: "", kind: "member", tags: [], timeZone, weekly: [], exceptions: [], busy: [] };
}

export function PersonEditPage({ id }: { id: string }) {
  const { state, update } = useStore();
  const isNew = id === "new";
  const existing = state.people.find((p) => p.id === id);
  const [draft, setDraft] = useState<Person | undefined>(() => (isNew ? blankPerson(browserTimeZone()) : existing && structuredClone(existing)));
  const [tagsText, setTagsText] = useState(() => draft?.tags.join(", ") ?? "");
  const [cells, setCells] = useState<Cell[]>(() => blocksToCells(draft?.weekly ?? []));
  const [icsNote, setIcsNote] = useState<{ text: string; warnings: string[] } | null>(null);
  const [error, setError] = useState("");

  if (!draft) {
    return (
      <section className="page">
        <h1>Person not found</h1>
        <p>
          <a href={href("/people")}>Back to people</a>
        </p>
      </section>
    );
  }

  const set = (patch: Partial<Person>) => setDraft({ ...draft, ...patch });
  const now = Date.now();

  const onSave = (e: FormEvent) => {
    e.preventDefault();
    if (!draft.name.trim()) {
      setError("Give this person a name.");
      return;
    }
    const person: Person = {
      ...draft,
      name: draft.name.trim(),
      email: draft.email?.trim() || undefined,
      tags: [...new Set(tagsText.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean))],
    };
    if (!person.email) delete person.email;
    update((s) => ({
      ...s,
      people: s.people.some((p) => p.id === person.id) ? s.people.map((p) => (p.id === person.id ? person : p)) : [...s.people, person],
    }));
    navigate("/people");
  };

  const onDelete = () => {
    if (!confirm(`Delete ${draft.name || "this person"}? Their booked meetings stay, without them.`)) return;
    update((s) => ({
      ...s,
      people: s.people.filter((p) => p.id !== draft.id),
      meetings: s.meetings.map((m) => ({ ...m, attendeeIds: m.attendeeIds.filter((a) => a !== draft.id) })),
    }));
    navigate("/people");
  };

  const onIcs = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    const range = { start: now - 7 * DAY, end: now + 120 * DAY };
    const { events, warnings } = parseIcs(text, { range, defaultTimeZone: draft.timeZone });
    set({ busy: events });
    setIcsNote({ text: `Imported ${events.length} busy ${events.length === 1 ? "event" : "events"} for the next 4 months.`, warnings });
  };

  const upcomingBusy = draft.busy.filter((b) => b.end > now).slice(0, 6);
  const exceptions = [...draft.exceptions].sort((a, b) => a.start - b.start);

  return (
    <section className="page">
      <p className="crumbs">
        <a href={href("/people")}>People</a> / {isNew ? "New person" : existing?.name}
      </p>
      <form onSubmit={onSave} className="stack">
        <div className="page-head">
          <h1>{isNew ? "New person" : "Edit person"}</h1>
          <div className="actions">
            {!isNew && (
              <button type="button" className="danger" onClick={onDelete}>
                Delete
              </button>
            )}
            <button type="button" onClick={() => navigate("/people")}>
              Cancel
            </button>
            <button type="submit" className="primary">
              Save
            </button>
          </div>
        </div>
        {error && (
          <p className="banner warn" role="alert">
            {error}
          </p>
        )}

        <fieldset className="card form-grid">
          <legend>Identity</legend>
          <label>
            Name
            <input value={draft.name} onChange={(e) => set({ name: e.target.value })} required autoFocus={isNew} />
          </label>
          <label>
            Email <span className="muted">(optional, used in .ics invites)</span>
            <input type="email" value={draft.email ?? ""} onChange={(e) => set({ email: e.target.value })} />
          </label>
          <label>
            Tags <span className="muted">(comma separated)</span>
            <input value={tagsText} onChange={(e) => setTagsText(e.target.value)} placeholder="engineering, hr, candidate" />
          </label>
          <label>
            Time zone
            <TimeZoneSelect value={draft.timeZone} onChange={(tz) => isValidTimeZone(tz) && set({ timeZone: tz })} />
          </label>
          <div className="radio-row" role="radiogroup" aria-label="Kind">
            <span>Kind</span>
            <label>
              <input type="radio" checked={draft.kind === "member"} onChange={() => set({ kind: "member" })} /> Member
            </label>
            <label>
              <input type="radio" checked={draft.kind === "external"} onChange={() => set({ kind: "external" })} /> External (candidate, client…)
            </label>
          </div>
        </fieldset>

        <fieldset className="card">
          <legend>Weekly hours</legend>
          <p className="muted">Recurring every week, in {draft.timeZone.replace(/_/g, " ")} time.</p>
          <WeekGrid
            label={`Weekly availability of ${draft.name || "this person"}`}
            columns={COLUMNS}
            stepMin={STEP}
            rows={ROWS}
            value={cells}
            onChange={(next) => {
              setCells(next);
              set({ weekly: cellsToBlocks(next) });
            }}
            scrollToMin={state.settings.dayStartMin}
          />
        </fieldset>

        <fieldset className="card">
          <legend>Exceptions</legend>
          <p className="muted">One-off changes: a day off, an extra evening, a candidate's answer.</p>
          {exceptions.length > 0 ? (
            <ul className="plain-list">
              {exceptions.map((x) => (
                <li key={x.id}>
                  <span className={`badge ex-${x.kind}`}>{x.kind}</span> {fmtSlot(x.start, x.end, draft.timeZone)}
                  {x.end - x.start > DAY ? ` → ${isoDate(x.end, draft.timeZone)}` : ""}
                  {x.note ? <span className="muted"> · {x.note}</span> : null}
                  <button type="button" className="link" onClick={() => set({ exceptions: draft.exceptions.filter((e) => e.id !== x.id) })}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">None.</p>
          )}
          <ExceptionForm timeZone={draft.timeZone} onAdd={(x) => set({ exceptions: [...draft.exceptions, x] })} />
        </fieldset>

        <fieldset className="card">
          <legend>Calendar (.ics)</legend>
          <p className="muted">
            Import an export from Google Calendar, Outlook or Apple Calendar. Events marked busy block matching; daily and weekly repeats
            are expanded.
          </p>
          <div className="actions">
            <label className="file-button">
              Import .ics file
              <input type="file" accept=".ics,text/calendar" onChange={(e) => void onIcs(e.target.files?.[0])} />
            </label>
            {draft.busy.length > 0 && (
              <button type="button" onClick={() => (set({ busy: [] }), setIcsNote(null))}>
                Clear {draft.busy.length} imported events
              </button>
            )}
          </div>
          {icsNote && (
            <div className="banner" role="status">
              {icsNote.text}
              {icsNote.warnings.map((w) => (
                <div key={w} className="muted">
                  {w}
                </div>
              ))}
            </div>
          )}
          {upcomingBusy.length > 0 && (
            <ul className="plain-list">
              {upcomingBusy.map((b, i) => (
                <li key={i}>
                  {fmtSlot(b.start, b.end, draft.timeZone)} {b.title ? <span className="muted">· {b.title}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </fieldset>
      </form>
    </section>
  );
}

function ExceptionForm({ timeZone, onAdd }: { timeZone: string; onAdd: (x: AvailabilityException) => void }) {
  const [date, setDate] = useState(() => isoDate(Date.now(), timeZone));
  const [from, setFrom] = useState("09:00");
  const [to, setTo] = useState("17:00");
  const [kind, setKind] = useState<AvailabilityException["kind"]>("busy");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  const add = () => {
    const [y, m, d] = date.split("-").map(Number);
    const a = parseMinutes(from);
    let b = parseMinutes(to);
    if (b === 0) b = 1440;
    if (!y || !m || !d || Number.isNaN(a) || Number.isNaN(b) || b <= a) {
      setError("Pick a date and an end time after the start time.");
      return;
    }
    setError("");
    onAdd({
      id: newId(),
      start: zonedTime(y, m - 1, d, a, timeZone),
      end: zonedTime(y, m - 1, d, b, timeZone),
      kind,
      ...(note.trim() ? { note: note.trim() } : {}),
    });
    setNote("");
  };

  return (
    <div className="inline-form">
      <label>
        Date
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <label>
        From
        <input type="time" step={900} value={from} onChange={(e) => setFrom(e.target.value)} />
      </label>
      <label>
        To
        <input type="time" step={900} value={to} onChange={(e) => setTo(e.target.value)} />
      </label>
      <label>
        Type
        <select value={kind} onChange={(e) => setKind(e.target.value as AvailabilityException["kind"])}>
          <option value="busy">Busy</option>
          <option value="available">Available</option>
          <option value="preferred">Preferred</option>
        </select>
      </label>
      <label className="grow">
        Note
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
      </label>
      <button type="button" onClick={add}>
        Add
      </button>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
