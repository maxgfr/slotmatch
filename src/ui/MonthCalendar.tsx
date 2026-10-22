import { ABSENCE_LABELS, parseDate, type CalendarDay } from "../core/calendar";
import type { Person } from "../core/model";
import { fmtTime } from "./state";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const PART = { am: "morning", pm: "afternoon" } as const;

export interface MonthCalendarProps {
  label: string;
  days: readonly CalendarDay[];
  /** Zone for meeting times. */
  timeZone: string;
  today: string;
  showAbsences?: boolean;
  showMeetings?: boolean;
  /** Names of attendees by id, for meeting tooltips. */
  nameOf?: (id: string) => string | undefined;
  personHref?: (p: Person) => string;
}

/** Month grid; on narrow screens it reads as an agenda of the days with something on. */
export function MonthCalendar({ label, days, timeZone, today, showAbsences = true, showMeetings = true, nameOf, personHref }: MonthCalendarProps) {
  const weeks: CalendarDay[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));

  return (
    <table className="month">
      <caption className="sr-only">{label}</caption>
      <thead>
        <tr>
          {WEEKDAYS.map((d) => (
            <th scope="col" key={d}>
              {d}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {weeks.map((week) => (
          <tr key={week[0]!.date}>
            {week.map((day) => {
              const absences = showAbsences ? day.absences : [];
              const meetings = showMeetings ? day.meetings : [];
              const empty = !absences.length && !meetings.length;
              const classes = [day.inMonth ? "" : "out", day.weekday > 4 ? "weekend" : "", empty ? "empty-day" : ""].filter(Boolean).join(" ");
              return (
                <td key={day.date} className={classes || undefined} aria-current={day.date === today ? "date" : undefined}>
                  <span className="month-date">
                    <span className="month-dow">{WEEKDAYS[day.weekday]} </span>
                    {parseDate(day.date).day}
                  </span>
                  {!empty && (
                    <ul className="month-items">
                      {absences.map(({ person, absence, part }) => {
                        const what = `${ABSENCE_LABELS[absence.kind]}${part === "full" ? "" : `, ${PART[part]}`}`;
                        const name = personHref ? <a href={personHref(person)}>{person.name}</a> : person.name;
                        return (
                          <li key={`${person.id}-${absence.id}`} className={`abs abs-${absence.kind}`} title={`${person.name}: ${what}${absence.note ? ` · ${absence.note}` : ""}`}>
                            <span className="sr-only">{what}: </span>
                            {name}
                            {part !== "full" && (
                              <span className="half" aria-hidden="true">
                                {part === "am" ? "AM" : "PM"}
                              </span>
                            )}
                          </li>
                        );
                      })}
                      {meetings.map((m) => (
                        <li
                          key={m.id}
                          className="mtg"
                          title={[m.title || "Meeting", m.attendeeIds.map((id) => nameOf?.(id)).filter(Boolean).join(", ")].filter(Boolean).join(" · ")}
                        >
                          <time dateTime={new Date(m.start).toISOString()}>{fmtTime(m.start, timeZone)}</time> {m.title || "Meeting"}
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
