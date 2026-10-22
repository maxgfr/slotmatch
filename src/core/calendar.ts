import { absenceInterval, localParts } from "./expand";
import type { Absence, Meeting, Ms, Person, Weekday } from "./model";

/*
 * Calendar dates are `YYYY-MM-DD` strings. They compare correctly as strings
 * and their arithmetic runs on UTC so it never depends on a zone.
 */

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isDate(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const m = v.match(DATE_RE);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

/** `month` is 0-based, like `Date#getMonth`; day and month may overflow. */
export function toDate(year: number, month: number, day: number): string {
  return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
}

export function parseDate(date: string): { year: number; month: number; day: number } {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return { year, month: month - 1, day };
}

export function addDays(date: string, n: number): string {
  const p = parseDate(date);
  return toDate(p.year, p.month, p.day + n);
}

/** 0 = Monday … 6 = Sunday. */
export function weekdayOf(date: string): Weekday {
  const p = parseDate(date);
  return ((new Date(Date.UTC(p.year, p.month, p.day)).getUTCDay() + 6) % 7) as Weekday;
}

/** Local date of an instant in `timeZone`. */
export function dateOf(ms: Ms, timeZone: string): string {
  const p = localParts(ms, timeZone);
  return toDate(p.year, p.month, p.day);
}

/* ---------- absences ---------- */

export const ABSENCE_LABELS: Record<Absence["kind"], string> = { vacation: "Vacation", sick: "Sick leave", other: "Absence" };

/** Real dates in order; a single day cannot be both afternoon-only and morning-only. */
export function validAbsence(a: Pick<Absence, "from" | "to" | "fromPm" | "toAm">): boolean {
  return isDate(a.from) && isDate(a.to) && a.from <= a.to && !(a.from === a.to && a.fromPm && a.toAm);
}

export type DayPart = "full" | "am" | "pm";

/** Part of `date` an absence covers, or null when it does not cover it. */
export function absencePart(a: Absence, date: string): DayPart | null {
  if (date < a.from || date > a.to) return null;
  if (date === a.from && a.fromPm) return "pm";
  if (date === a.to && a.toAm) return "am";
  return "full";
}

/** Number of days off, half days counting 0.5. */
export function absenceLength(a: Absence): number {
  const p = parseDate(a.from);
  const q = parseDate(a.to);
  const days = Math.round((Date.UTC(q.year, q.month, q.day) - Date.UTC(p.year, p.month, p.day)) / 86_400_000) + 1;
  return days - (a.fromPm ? 0.5 : 0) - (a.toAm ? 0.5 : 0);
}

/** The absence covering `now` for this person, if any. */
export function absentNow(person: Person, now: Ms): Absence | undefined {
  return person.absences.find((a) => {
    const iv = absenceInterval(a, person.timeZone);
    return iv.start <= now && now < iv.end;
  });
}

/* ---------- month view ---------- */

export interface DayAbsence {
  person: Person;
  absence: Absence;
  part: DayPart;
}

export interface CalendarDay {
  date: string;
  weekday: Weekday;
  /** False for the leading and trailing days of the neighbouring months. */
  inMonth: boolean;
  absences: DayAbsence[];
  /** Meetings starting that day in the display zone, by start time. */
  meetings: Meeting[];
}

/**
 * Whole weeks (Monday first) covering `month` of `year` (0-based). Absences sit
 * on their own dates; meetings on their start date in `timeZone`.
 */
export function calendarMonth(
  people: readonly Person[],
  meetings: readonly Meeting[],
  year: number,
  month: number,
  timeZone: string,
): CalendarDay[] {
  const first = toDate(year, month, 1);
  const last = toDate(year, month + 1, 0);
  const start = addDays(first, -weekdayOf(first));
  const end = addDays(last, 6 - weekdayOf(last));
  const byDate = new Map<string, Meeting[]>();
  for (const m of [...meetings].sort((a, b) => a.start - b.start)) {
    const d = dateOf(m.start, timeZone);
    if (d < start || d > end) continue;
    byDate.set(d, [...(byDate.get(d) ?? []), m]);
  }
  const days: CalendarDay[] = [];
  for (let date = start; date <= end; date = addDays(date, 1)) {
    const absences: DayAbsence[] = [];
    for (const person of people) {
      for (const absence of person.absences) {
        const part = absencePart(absence, date);
        if (part) absences.push({ person, absence, part });
      }
    }
    absences.sort((a, b) => a.person.name.localeCompare(b.person.name));
    days.push({ date, weekday: weekdayOf(date), inMonth: date >= first && date <= last, absences, meetings: byDate.get(date) ?? [] });
  }
  return days;
}

/** Absences overlapping the dates `[from, to]`, by start date then name. */
export function absencesBetween(people: readonly Person[], from: string, to: string): { person: Person; absence: Absence }[] {
  return people
    .flatMap((person) => person.absences.filter((a) => a.to >= from && a.from <= to).map((absence) => ({ person, absence })))
    .sort((a, b) => a.absence.from.localeCompare(b.absence.from) || a.person.name.localeCompare(b.person.name));
}
