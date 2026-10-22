import { useEffect, useMemo, useState } from "react";
import { calendarMonth, dateOf, parseDate } from "../../core/calendar";
import type { Meeting, Person } from "../../core/model";
import { applyCalendar, decodeCalendar, ShareError, type ShareCalendar } from "../../core/share";
import { AbsenceLine } from "../AbsenceForm";
import { MonthCalendar } from "../MonthCalendar";
import { href } from "../router";
import { browserTimeZone, fmtDay, fmtMonth, useStore } from "../state";

/** Read-only view of a shared team calendar. Local data is only touched on an explicit import. */
export function CalendarViewPage({ data }: { data: string }) {
  const [cal, setCal] = useState<ShareCalendar | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    decodeCalendar(data)
      .then((c) => live && setCal(c))
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
        ) : !cal ? (
          <section className="page narrow">
            <p className="muted">Opening the calendar…</p>
          </section>
        ) : (
          <SharedCalendar cal={cal} />
        )}
      </main>
    </div>
  );
}

function SharedCalendar({ cal }: { cal: ShareCalendar }) {
  const tz = browserTimeZone();
  const { state, update } = useStore();
  const [imported, setImported] = useState(false);

  // Shared entries as local shapes, so the month grid works on them unchanged.
  const { people, meetings } = useMemo(() => {
    const people: Person[] = cal.people.map((p, i) => ({ id: `shared-${i}`, kind: "member", weekly: [], exceptions: [], busy: [], ...p }));
    const meetings: Meeting[] = cal.meetings.map((m) => ({ ...m, attendeeIds: m.attendees.map((i) => `shared-${i}`), createdAt: 0 }));
    return { people, meetings };
  }, [cal]);

  // Months of the shared period, in the sender's zone.
  const first = parseDate(dateOf(cal.range.start, cal.timeZone));
  const last = parseDate(dateOf(cal.range.end - 1, cal.timeZone));
  const count = (last.year - first.year) * 12 + last.month - first.month + 1;
  const [index, setIndex] = useState(() => {
    const now = parseDate(dateOf(Date.now(), tz));
    return Math.min(count - 1, Math.max(0, (now.year - first.year) * 12 + now.month - first.month));
  });
  const year = first.year + Math.floor((first.month + index) / 12);
  const month = (first.month + index) % 12;
  const days = useMemo(() => calendarMonth(people, meetings, year, month, tz), [people, meetings, year, month, tz]);

  const preview = useMemo(() => applyCalendar(state, cal, Date.now()), [state, cal]);
  const nothingNew = !preview.newPeople && !preview.absences && !preview.meetings;
  const absences = people.flatMap((person) => person.absences.map((absence) => ({ person, absence }))).sort((a, b) => a.absence.from.localeCompare(b.absence.from));

  return (
    <section className="page">
      <div className="page-head">
        <h1>{cal.title || "Team calendar"}</h1>
        {count > 1 && (
          <div className="actions" role="group" aria-label="Month">
            <button onClick={() => setIndex(index - 1)} disabled={index === 0} aria-label="Previous month">
              ←
            </button>
            <span className="week-label">{fmtMonth(year, month)}</span>
            <button onClick={() => setIndex(index + 1)} disabled={index === count - 1} aria-label="Next month">
              →
            </button>
          </div>
        )}
      </div>
      <p className="lead">
        Shared for {fmtDay(cal.range.start, cal.timeZone)} to {fmtDay(cal.range.end - 1, cal.timeZone)}. Meeting times are in your zone (
        {tz.replace(/_/g, " ")}); absences are whole or half days in each person's own zone.
      </p>

      <div className="split wide-left">
        <div className="month-scroll">
          <MonthCalendar
            label={`${fmtMonth(year, month)}: absences and meetings`}
            days={days}
            timeZone={tz}
            today={dateOf(Date.now(), tz)}
            nameOf={(id) => people.find((p) => p.id === id)?.name}
          />
        </div>

        <div className="stack">
          <section className="card">
            <h2 className="h3">Absences</h2>
            {absences.length ? (
              <ul className="plain-list">
                {absences.map(({ person, absence }) => (
                  <li key={`${person.id}-${absence.id}`}>
                    <strong>{person.name}</strong> <AbsenceLine absence={absence} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="ok-text">Nobody is away.</p>
            )}
          </section>

          <section className="card stack">
            <h2 className="h3">Add to my slotmatch</h2>
            {imported ? (
              <p className="banner ok" role="status">
                Imported. <a href={href("/calendar")}>Open your calendar</a>
              </p>
            ) : nothingNew ? (
              <p className="muted">Everything in this link is already in your slotmatch.</p>
            ) : (
              <>
                <p className="muted small">
                  {preview.absences} {preview.absences === 1 ? "absence" : "absences"} and {preview.meetings} {preview.meetings === 1 ? "meeting" : "meetings"} to add or
                  update{preview.newPeople ? `, ${preview.newPeople} new ${preview.newPeople === 1 ? "person" : "people"} (without weekly hours)` : ""}. People are matched
                  by email, then by name.
                </p>
                <div className="actions">
                  <button
                    className="primary"
                    onClick={() => {
                      update((s) => applyCalendar(s, cal, Date.now()).state);
                      setImported(true);
                    }}
                  >
                    Import
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    </section>
  );
}
