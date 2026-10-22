import { useMemo, useState } from "react";
import { absencesBetween, calendarMonth, dateOf, toDate } from "../../core/calendar";
import { absenceInterval, localParts, zonedTime } from "../../core/expand";
import { exportIcs } from "../../core/ics";
import type { Interval } from "../../core/model";
import { buildCalendar, encodeCalendar, shareUrl } from "../../core/share";
import { AbsenceForm, AbsenceLine } from "../AbsenceForm";
import { MonthCalendar } from "../MonthCalendar";
import { appBaseUrl, href } from "../router";
import { allTags, copyText, download, fmtMonth, useSessionState, useStore } from "../state";

export function CalendarPage() {
  const { state, update } = useStore();
  const tz = state.settings.timeZone;
  const [opts, setOpts] = useSessionState("calendar", () => ({ month: 0, tag: "", absences: true, meetings: true, shareMonths: 1, title: "Team calendar" }));
  const [personId, setPersonId] = useState("");
  const [link, setLink] = useState("");
  const [copied, setCopied] = useState(false);
  const set = (patch: Partial<typeof opts>) => {
    setOpts((o) => ({ ...o, ...patch }));
    setLink("");
  };

  const now = Date.now();
  const today = dateOf(now, tz);
  const t = localParts(now, tz);
  const year = new Date(Date.UTC(t.year, t.month + opts.month, 1)).getUTCFullYear();
  const month = (((t.month + opts.month) % 12) + 12) % 12;

  const people = useMemo(
    () => [...state.people].filter((p) => !opts.tag || p.tags.includes(opts.tag)).sort((a, b) => a.name.localeCompare(b.name)),
    [state.people, opts.tag],
  );
  const meetings = useMemo(() => {
    if (!opts.tag) return state.meetings;
    const ids = new Set(people.map((p) => p.id));
    return state.meetings.filter((m) => m.attendeeIds.some((id) => ids.has(id)));
  }, [state.meetings, people, opts.tag]);
  const days = useMemo(() => calendarMonth(people, meetings, year, month, tz), [people, meetings, year, month, tz]);
  const away = absencesBetween(people, toDate(year, month, 1), toDate(year, month + 1, 0));
  const shareRange = { start: zonedTime(year, month, 1, 0, tz), end: zonedTime(year, month + opts.shareMonths, 1, 0, tz) };
  const name = (id: string) => state.people.find((p) => p.id === id)?.name;
  const target = state.people.find((p) => p.id === personId) ?? people[0];
  const tags = allTags(state.people);

  if (state.people.length === 0) {
    return (
      <section className="page">
        <h1>Calendar</h1>
        <div className="empty">
          <p>
            Add people first, or <a href={href("/data")}>load the demo data</a>.
          </p>
        </div>
      </section>
    );
  }

  const createLink = async () => {
    const cal = buildCalendar(people, meetings, shareRange, opts.title.trim() || "Team calendar", tz);
    setLink(shareUrl(appBaseUrl(), "calendar-view", await encodeCalendar(cal)));
    setCopied(false);
  };

  const downloadIcs = () => {
    const inRange = (iv: Interval) => iv.start < shareRange.end && shareRange.start < iv.end;
    const text = exportIcs(
      meetings.filter(inRange),
      people.map((p) => ({ ...p, absences: p.absences.filter((a) => inRange(absenceInterval(a, p.timeZone))) })),
      { absences: true, calendarName: opts.title.trim() || "Team calendar" },
    );
    download("slotmatch-team.ics", text, "text/calendar");
  };

  return (
    <section className="page">
      <div className="page-head">
        <h1>Calendar</h1>
        <div className="actions" role="group" aria-label="Month">
          <button onClick={() => set({ month: opts.month - 1 })} aria-label="Previous month">
            ←
          </button>
          <span className="week-label">{fmtMonth(year, month)}</span>
          <button onClick={() => set({ month: opts.month + 1 })} aria-label="Next month">
            →
          </button>
          {opts.month !== 0 && <button onClick={() => set({ month: 0 })}>This month</button>}
        </div>
      </div>

      <div className="filters">
        <label>
          Who
          <select value={opts.tag} onChange={(e) => set({ tag: e.target.value })}>
            <option value="">Everyone</option>
            {tags.map((tg) => (
              <option key={tg} value={tg}>
                Tag: {tg}
              </option>
            ))}
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={opts.absences} onChange={(e) => set({ absences: e.target.checked })} />
          Absences
        </label>
        <label className="check">
          <input type="checkbox" checked={opts.meetings} onChange={(e) => set({ meetings: e.target.checked })} />
          Meetings
        </label>
      </div>

      <div className="legend" aria-hidden="true">
        <span>
          <i className="abs-swatch abs-vacation" /> vacation
        </span>
        <span>
          <i className="abs-swatch abs-sick" /> sick leave
        </span>
        <span>
          <i className="abs-swatch abs-other" /> other absence
        </span>
        <span>
          <i className="abs-swatch mtg" /> meeting ({tz.replace(/_/g, " ")})
        </span>
      </div>

      <div className="split wide-left">
        <div className="month-scroll">
          <MonthCalendar
            label={`${fmtMonth(year, month)}: absences and meetings`}
            days={days}
            timeZone={tz}
            today={today}
            showAbsences={opts.absences}
            showMeetings={opts.meetings}
            nameOf={name}
            personHref={(p) => href(`/people/${p.id}`)}
          />
          {days.every((d) => !d.inMonth || (!(opts.absences && d.absences.length) && !(opts.meetings && d.meetings.length))) && (
            <p className="muted month-none">Nothing planned in {fmtMonth(year, month)}.</p>
          )}
        </div>

        <div className="stack">
          <section className="card">
            <h2 className="h3">Away in {fmtMonth(year, month)}</h2>
            {away.length ? (
              <ul className="plain-list">
                {away.map(({ person, absence }) => (
                  <li key={absence.id}>
                    <a href={href(`/people/${person.id}`)}>{person.name}</a> <AbsenceLine absence={absence} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="ok-text">Everyone is in.</p>
            )}
          </section>

          <fieldset className="card stack">
            <legend>Add an absence</legend>
            <label>
              Person
              <select value={target?.id ?? ""} onChange={(e) => setPersonId(e.target.value)}>
                {[...state.people]
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </label>
            {target && (
              <>
                <AbsenceForm
                  key={target.id}
                  timeZone={target.timeZone}
                  onAdd={(a) => update((s) => ({ ...s, people: s.people.map((p) => (p.id === target.id ? { ...p, absences: [...p.absences, a] } : p)) }))}
                />
                <p className="muted small">Dates are in {target.timeZone.replace(/_/g, " ")}, the person's zone. Matching and coverage skip these days.</p>
              </>
            )}
          </fieldset>

          <fieldset className="card stack">
            <legend>Share</legend>
            <div className="form-grid compact">
              <label className="span-2">
                Title
                <input value={opts.title} onChange={(e) => set({ title: e.target.value })} />
              </label>
              <label className="span-2">
                Period
                <select value={opts.shareMonths} onChange={(e) => set({ shareMonths: Number(e.target.value) })}>
                  <option value={1}>{fmtMonth(year, month)}</option>
                  <option value={3}>3 months from {fmtMonth(year, month)}</option>
                  <option value={6}>6 months from {fmtMonth(year, month)}</option>
                </select>
              </label>
            </div>
            <p className="muted small">
              {opts.tag ? `People tagged “${opts.tag}”` : "Everyone"}: names, tags, absences and meeting titles. Weekly hours, exceptions and imported
              calendars are never shared.
            </p>
            <div className="actions">
              <button className="primary" onClick={() => void createLink()}>
                Create read-only link
              </button>
              <button onClick={downloadIcs}>Download .ics</button>
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
        </div>
      </div>
    </section>
  );
}
