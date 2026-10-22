import { useMemo, useState, type ReactNode } from "react";
import { zonedTime } from "../../core/expand";
import { exportIcs } from "../../core/ics";
import { findSlots } from "../../core/match";
import { DAY, type Meeting, type Person, type Requirement } from "../../core/model";
import { DEFAULT_WEIGHTS, rankSlots, type PartOfDay, type RankedSlot, type ScoreWeights } from "../../core/score";
import { newId } from "../../core/store";
import { href } from "../router";
import { allTags, download, fmtDuration, fmtMinutes, fmtSlot, fmtTime, isoDate, parseMinutes, useSessionState, useStore } from "../state";

/* ---------- shared form pieces (also used by the planner) ---------- */

export function describeRequirement(req: Requirement, people: readonly Person[]): string {
  const name = (id: string) => people.find((p) => p.id === id)?.name ?? "unknown person";
  switch (req.kind) {
    case "person":
      return name(req.id);
    case "anyOf":
      return `${req.count} of ${req.ids.map(name).join(", ") || "nobody"}`;
    case "tag":
      return `${req.count} × ${req.tag}`;
  }
}

export function RequirementsEditor({
  value,
  onChange,
  people,
  allowPerson = true,
}: {
  value: Requirement[];
  onChange: (next: Requirement[]) => void;
  people: readonly Person[];
  allowPerson?: boolean;
}) {
  const tags = allTags(people);
  const sorted = [...people].sort((a, b) => a.name.localeCompare(b.name));
  const setAt = (i: number, r: Requirement) => onChange(value.map((x, j) => (j === i ? r : x)));
  const blank = (kind: Requirement["kind"]): Requirement =>
    kind === "person"
      ? { kind, id: sorted[0]?.id ?? "" }
      : kind === "tag"
        ? { kind, tag: tags[0] ?? "", count: 1 }
        : { kind, ids: [], count: 1 };

  return (
    <div className="requirements">
      {value.length === 0 && <p className="muted">No rules yet. Add who must attend.</p>}
      <ol>
        {value.map((r, i) => (
          <li key={i} className="requirement">
            <select aria-label={`Rule ${i + 1} type`} value={r.kind} onChange={(e) => setAt(i, blank(e.target.value as Requirement["kind"]))}>
              {allowPerson && <option value="person">Specific person</option>}
              <option value="tag">People with tag</option>
              <option value="anyOf">Some of a group</option>
            </select>
            {r.kind === "person" && (
              <select aria-label={`Rule ${i + 1} person`} value={r.id} onChange={(e) => setAt(i, { ...r, id: e.target.value })}>
                {sorted.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.kind === "external" ? " (external)" : ""}
                  </option>
                ))}
              </select>
            )}
            {r.kind !== "person" && (
              <label className="count">
                <input
                  type="number"
                  min={1}
                  max={20}
                  aria-label={`Rule ${i + 1} how many`}
                  value={r.count}
                  onChange={(e) => setAt(i, { ...r, count: Math.max(1, Number(e.target.value) || 1) })}
                />
                <span>{r.kind === "tag" ? "with tag" : "from"}</span>
              </label>
            )}
            {r.kind === "tag" && (
              <select aria-label={`Rule ${i + 1} tag`} value={r.tag} onChange={(e) => setAt(i, { ...r, tag: e.target.value })}>
                {tags.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            )}
            {r.kind === "anyOf" && (
              <details className="group-picker">
                <summary>{r.ids.length ? `${r.ids.length} people` : "Choose people"}</summary>
                <div className="checks">
                  {sorted.map((p) => (
                    <label key={p.id}>
                      <input
                        type="checkbox"
                        checked={r.ids.includes(p.id)}
                        onChange={(e) => setAt(i, { ...r, ids: e.target.checked ? [...r.ids, p.id] : r.ids.filter((x) => x !== p.id) })}
                      />
                      {p.name}
                    </label>
                  ))}
                </div>
              </details>
            )}
            <button type="button" className="link" onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label={`Remove rule ${i + 1}`}>
              Remove
            </button>
          </li>
        ))}
      </ol>
      <div className="actions">
        {allowPerson && (
          <button type="button" onClick={() => onChange([...value, blank("person")])} disabled={!people.length}>
            + Person
          </button>
        )}
        <button type="button" onClick={() => onChange([...value, blank("tag")])} disabled={!tags.length}>
          + Tag
        </button>
        <button type="button" onClick={() => onChange([...value, blank("anyOf")])} disabled={!people.length}>
          + Group
        </button>
      </div>
    </div>
  );
}

export interface WhenForm {
  durationMin: number;
  bufferMin: number;
  from: string;
  days: number;
  windowFrom: string;
  windowTo: string;
}

/** Search range starting at local midnight of `from`, never in the past. */
export function formRange(f: WhenForm, timeZone: string, now = Date.now()) {
  const [y, m, d] = f.from.split("-").map(Number);
  const start = y && m && d ? zonedTime(y, m - 1, d, 0, timeZone) : now;
  const end = y && m && d ? zonedTime(y, m - 1, d + Math.max(1, f.days), 0, timeZone) : now + 7 * DAY;
  return { start: Math.max(start, now), end };
}

export function formWindow(f: WhenForm) {
  const startMin = parseMinutes(f.windowFrom);
  let endMin = parseMinutes(f.windowTo);
  if (endMin === 0) endMin = 1440;
  return Number.isNaN(startMin) || Number.isNaN(endMin) || endMin <= startMin ? undefined : { startMin, endMin };
}

export function WhenFields({ value, onChange }: { value: WhenForm; onChange: (v: WhenForm) => void }) {
  const set = (patch: Partial<WhenForm>) => onChange({ ...value, ...patch });
  return (
    <div className="form-grid compact">
      <label>
        Duration
        <select value={value.durationMin} onChange={(e) => set({ durationMin: Number(e.target.value) })}>
          {[15, 20, 30, 45, 60, 75, 90, 120].map((m) => (
            <option key={m} value={m}>
              {fmtDuration(m)}
            </option>
          ))}
        </select>
      </label>
      <label>
        Buffer around
        <select value={value.bufferMin} onChange={(e) => set({ bufferMin: Number(e.target.value) })}>
          {[0, 5, 10, 15, 30].map((m) => (
            <option key={m} value={m}>
              {m ? `${m} min` : "None"}
            </option>
          ))}
        </select>
      </label>
      <label>
        From
        <input type="date" value={value.from} onChange={(e) => set({ from: e.target.value })} />
      </label>
      <label>
        Days
        <input type="number" min={1} max={31} value={value.days} onChange={(e) => set({ days: Math.min(31, Math.max(1, Number(e.target.value) || 1)) })} />
      </label>
      <label>
        Not before
        <input type="time" step={900} value={value.windowFrom} onChange={(e) => set({ windowFrom: e.target.value })} />
      </label>
      <label>
        Not after
        <input type="time" step={900} value={value.windowTo} onChange={(e) => set({ windowTo: e.target.value })} />
      </label>
    </div>
  );
}

/** Default panel: the first candidate, one engineer, one HR person — when those exist. */
export function defaultRequirements(people: readonly Person[], withCandidate: boolean): Requirement[] {
  const tags = allTags(people);
  const reqs: Requirement[] = [];
  const candidate = people.find((p) => p.kind === "external");
  if (withCandidate && candidate) reqs.push({ kind: "person", id: candidate.id });
  for (const t of ["engineering", "hr"]) if (tags.includes(t)) reqs.push({ kind: "tag", tag: t, count: 1 });
  return reqs;
}

export function bookingTitle(base: string, attendees: readonly string[], people: readonly Person[]): string {
  const external = attendees.map((id) => people.find((p) => p.id === id)).find((p) => p?.kind === "external");
  return base.trim() || (external ? `Interview: ${external.name}` : "Meeting");
}

/* ---------- page ---------- */

interface MatchForm extends WhenForm {
  title: string;
  stepMin: number;
  partOfDay: PartOfDay;
  weights: ScoreWeights;
  requirements: Requirement[] | null;
}

const WEIGHT_LABELS: Record<keyof ScoreWeights, string> = {
  preferred: "Preferred time",
  timeOfDay: "Part of day",
  fairness: "Fairness",
  earliness: "Sooner",
};

export function MatchPage() {
  const { state, update } = useStore();
  const tz = state.settings.timeZone;
  const [form, setForm] = useSessionState<MatchForm>("match", () => ({
    title: "",
    durationMin: state.settings.defaultDurationMin,
    bufferMin: 0,
    stepMin: 15,
    from: isoDate(Date.now(), tz),
    days: 7,
    windowFrom: fmtMinutes(state.settings.dayStartMin),
    windowTo: fmtMinutes(state.settings.dayEndMin),
    partOfDay: "any",
    weights: DEFAULT_WEIGHTS,
    requirements: null,
  }));
  const [flash, setFlash] = useState("");
  const set = (patch: Partial<MatchForm>) => setForm((f) => ({ ...f, ...patch }));
  const requirements = useMemo(() => form.requirements ?? defaultRequirements(state.people, true), [form.requirements, state.people]);

  const result = useMemo(() => {
    const range = formRange(form, tz);
    const query = {
      range,
      durationMin: form.durationMin,
      stepMin: form.stepMin,
      bufferMin: form.bufferMin,
      timeZone: tz,
      dayWindow: formWindow(form),
      requirements,
    };
    const res = findSlots(query, state.people, { meetings: state.meetings });
    const fixed = new Set(requirements.flatMap((r) => (r.kind === "person" ? [r.id] : [])));
    const ranked = rankSlots(
      res.slots,
      { expanded: res.expanded, meetings: state.meetings, range, timeZone: tz, partOfDay: form.partOfDay, fixed },
      form.weights,
      { limit: 12 },
    );
    return { ranked, total: res.slots.length, problems: res.problems };
  }, [form, requirements, state.people, state.meetings, tz]);

  const book = (slot: RankedSlot) => {
    const meeting: Meeting = {
      id: newId(),
      title: bookingTitle(form.title, slot.attendees, state.people),
      start: slot.start,
      end: slot.end,
      attendeeIds: slot.attendees,
      createdAt: Date.now(),
    };
    update((s) => ({ ...s, meetings: [...s.meetings, meeting] }));
    setFlash(`Booked “${meeting.title}” on ${fmtSlot(meeting.start, meeting.end, tz)}.`);
  };

  const icsFor = (slot: RankedSlot) => {
    const m: Meeting = {
      id: `slot-${slot.start}`,
      title: bookingTitle(form.title, slot.attendees, state.people),
      start: slot.start,
      end: slot.end,
      attendeeIds: slot.attendees,
      createdAt: Date.now(),
    };
    download(`slotmatch-${isoDate(slot.start, tz)}.ics`, exportIcs([m], state.people), "text/calendar");
  };

  if (state.people.length === 0) {
    return (
      <section className="page">
        <h1>Match</h1>
        <div className="empty">
          <p>
            Add people first, or <a href={href("/settings")}>load the demo data</a>.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="page">
      <h1>Match</h1>
      <div className="split">
        <div className="stack">
          <fieldset className="card">
            <legend>Who</legend>
            <RequirementsEditor value={requirements} onChange={(r) => set({ requirements: r })} people={state.people} />
          </fieldset>
          <fieldset className="card">
            <legend>When</legend>
            <WhenFields value={form} onChange={(w) => setForm((f) => ({ ...f, ...w }))} />
            <p className="muted small">Dates and hours are in {tz.replace(/_/g, " ")}.</p>
          </fieldset>
          <details className="card">
            <summary>Ranking and booking</summary>
            <div className="form-grid compact">
              <label className="span-2">
                Meeting title
                <input value={form.title} onChange={(e) => set({ title: e.target.value })} placeholder="Interview: candidate name" />
              </label>
              <label>
                Start times every
                <select value={form.stepMin} onChange={(e) => set({ stepMin: Number(e.target.value) })}>
                  {[15, 30, 60].map((m) => (
                    <option key={m} value={m}>
                      {m} min
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Prefer
                <select value={form.partOfDay} onChange={(e) => set({ partOfDay: e.target.value as PartOfDay })}>
                  <option value="any">Any time</option>
                  <option value="morning">Mornings</option>
                  <option value="afternoon">Afternoons</option>
                </select>
              </label>
              {(Object.keys(WEIGHT_LABELS) as (keyof ScoreWeights)[]).map((k) => (
                <label key={k}>
                  {WEIGHT_LABELS[k]} <output>{form.weights[k]}</output>
                  <input
                    type="range"
                    min={0}
                    max={5}
                    step={1}
                    value={form.weights[k]}
                    onChange={(e) => set({ weights: { ...form.weights, [k]: Number(e.target.value) } })}
                  />
                </label>
              ))}
            </div>
          </details>
        </div>

        <div className="stack">
          <div className="results-head">
            <h2>Best slots</h2>
            <span className="muted" aria-live="polite">
              {result.total ? `${result.total} possible start times` : ""}
            </span>
          </div>
          {flash && (
            <p className="banner ok" role="status">
              {flash}
            </p>
          )}
          {result.problems.length > 0 ? (
            <div className="banner warn" role="alert">
              {result.problems.map((p) => (
                <div key={p}>{p}</div>
              ))}
            </div>
          ) : result.ranked.length === 0 ? (
            <div className="empty small">
              <p>No time works for everyone. Try more days, a shorter meeting, a wider window or a smaller panel.</p>
            </div>
          ) : (
            <ol className="slots">
              {result.ranked.map((slot) => (
                <SlotCard key={`${slot.start}-${slot.attendees.join()}`} slot={slot} requirements={requirements} people={state.people} timeZone={tz}>
                  <button className="primary" onClick={() => book(slot)}>
                    Book
                  </button>
                  <button onClick={() => icsFor(slot)}>Download .ics</button>
                </SlotCard>
              ))}
            </ol>
          )}
          <MeetingsList />
        </div>
      </div>
    </section>
  );
}

export function SlotCard({
  slot,
  requirements,
  people,
  timeZone,
  children,
  heading,
}: {
  slot: RankedSlot;
  requirements: readonly Requirement[];
  people: readonly Person[];
  timeZone: string;
  children?: ReactNode;
  heading?: string;
}) {
  const byId = (id: string) => people.find((p) => p.id === id);
  return (
    <li className="slot card">
      <div className="slot-head">
        <div>
          {heading && <div className="muted small">{heading}</div>}
          <strong className="slot-time">{fmtSlot(slot.start, slot.end, timeZone)}</strong>
        </div>
        <span className="score" title="Overall score">
          {Math.round(slot.score * 100)}
        </span>
      </div>
      <ul className="attendees" aria-label="Attendees">
        {slot.attendees.map((id) => {
          const p = byId(id);
          if (!p) return null;
          const sameZone = p.timeZone === timeZone;
          return (
            <li key={id} className="chip">
              {p.name}
              {!sameZone && <span className="muted">{fmtTime(slot.start, p.timeZone)} local</span>}
            </li>
          );
        })}
      </ul>
      <dl className="breakdown">
        {(Object.keys(WEIGHT_LABELS) as (keyof ScoreWeights)[]).map((k) => (
          <div key={k}>
            <dt>{WEIGHT_LABELS[k]}</dt>
            <dd>
              <meter min={0} max={1} value={slot.breakdown[k]} aria-label={`${WEIGHT_LABELS[k]} ${Math.round(slot.breakdown[k] * 100)}%`} />
            </dd>
          </div>
        ))}
      </dl>
      {slot.alternates.some((a) => a.length > 0) && (
        <p className="alternates small">
          {slot.alternates.map((alts, i) =>
            alts.length ? (
              <span key={i}>
                Instead for {describeRequirement(requirements[i]!, people)}: {alts.map((id) => byId(id)?.name ?? id).join(", ")}.{" "}
              </span>
            ) : null,
          )}
        </p>
      )}
      {children && <div className="actions">{children}</div>}
    </li>
  );
}

export function MeetingsList() {
  const { state, update } = useStore();
  const tz = state.settings.timeZone;
  const now = Date.now();
  const upcoming = state.meetings.filter((m) => m.end > now).sort((a, b) => a.start - b.start);
  if (!upcoming.length) return null;
  const name = (id: string) => state.people.find((p) => p.id === id)?.name ?? "removed";
  return (
    <section className="card">
      <div className="results-head">
        <h2>Booked</h2>
        <button onClick={() => download("slotmatch-meetings.ics", exportIcs(upcoming, state.people), "text/calendar")}>
          Download all .ics
        </button>
      </div>
      <ul className="plain-list">
        {upcoming.map((m) => (
          <li key={m.id}>
            <strong>{fmtSlot(m.start, m.end, tz)}</strong> · {m.title}
            <div className="muted small">{m.attendeeIds.map(name).join(", ")}</div>
            <button className="link" onClick={() => update((s) => ({ ...s, meetings: s.meetings.filter((x) => x.id !== m.id) }))}>
              Cancel
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
