import { TZDate } from "@date-fns/tz";
import { clip, intersect, normalize, subtract, union } from "./intervals";
import {
  DAY,
  MINUTE,
  type Expanded,
  type Interval,
  type Meeting,
  type Ms,
  type Person,
  type Weekday,
} from "./model";

/* ---------- time zone helpers ---------- */

export interface LocalParts {
  year: number;
  /** 0-based, like `Date#getMonth`. */
  month: number;
  day: number;
  /** 0 = Monday … 6 = Sunday. */
  weekday: Weekday;
  /** Minutes since local midnight. */
  minutes: number;
}

/** Wall-clock parts of an instant in `timeZone`. */
export function localParts(ms: Ms, timeZone: string): LocalParts {
  const d = new TZDate(ms, timeZone);
  return {
    year: d.getFullYear(),
    month: d.getMonth(),
    day: d.getDate(),
    weekday: ((d.getDay() + 6) % 7) as Weekday,
    minutes: d.getHours() * 60 + d.getMinutes(),
  };
}

/**
 * Instant of a local wall-clock time. `day` and `minutes` may overflow
 * (`minutes = 1440` is the next midnight). Non-existent times (DST gap) shift
 * forward like the platform `Date` does.
 */
export function zonedTime(year: number, month: number, day: number, minutes: number, timeZone: string): Ms {
  return new TZDate(year, month, day, Math.floor(minutes / 60), minutes % 60, timeZone).getTime();
}

/** Instant of local midnight starting the day that contains `ms`. */
export function startOfLocalDay(ms: Ms, timeZone: string): Ms {
  const p = localParts(ms, timeZone);
  return zonedTime(p.year, p.month, p.day, 0, timeZone);
}

/** Instant of local midnight starting the Monday of the week that contains `ms`. */
export function startOfLocalWeek(ms: Ms, timeZone: string): Ms {
  const p = localParts(ms, timeZone);
  return zonedTime(p.year, p.month, p.day - p.weekday, 0, timeZone);
}

/** Local midnights from the day containing `range.start` to the one containing `range.end - 1`. */
export function localDays(range: Interval, timeZone: string): Ms[] {
  if (range.end <= range.start) return [];
  const first = localParts(range.start, timeZone);
  const days: Ms[] = [];
  for (let i = 0; ; i++) {
    const midnight = zonedTime(first.year, first.month, first.day + i, 0, timeZone);
    if (midnight >= range.end) break;
    days.push(midnight);
    if (i > 3660) break;
  }
  return days;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/* ---------- expansion ---------- */

export interface ExpandOptions {
  /** Booked meetings; only those the person attends are used. */
  meetings?: readonly Meeting[];
  /** Extra margin around each booked meeting and busy event, in minutes. */
  bufferMin?: number;
}

/**
 * Resolve a person's weekly rules, exceptions, imported busy events and booked
 * meetings into UTC intervals clipped to `range`.
 *
 * available = (weekly ∪ available exceptions) − busy
 * preferred = (weekly preferred ∪ preferred exceptions) ∩ available
 * busy      = busy exceptions ∪ imported events ∪ meetings (each widened by the buffer)
 */
export function expandPerson(person: Person, range: Interval, opts: ExpandOptions = {}): Expanded {
  const tz = person.timeZone;
  const weeklyAvail: Interval[] = [];
  const weeklyPref: Interval[] = [];
  // One day of margin on each side so blocks crossing the range edge are kept.
  const days = localDays({ start: range.start - DAY, end: range.end + DAY }, tz);
  for (const midnight of days) {
    const p = localParts(midnight, tz);
    for (const block of person.weekly) {
      if (block.day !== p.weekday) continue;
      const iv = {
        start: zonedTime(p.year, p.month, p.day, block.startMin, tz),
        end: zonedTime(p.year, p.month, p.day, block.endMin, tz),
      };
      weeklyAvail.push(iv);
      if (block.level === "preferred") weeklyPref.push(iv);
    }
  }

  const buffer = (opts.bufferMin ?? 0) * MINUTE;
  const widen = (iv: Interval): Interval => ({ start: iv.start - buffer, end: iv.end + buffer });

  const extraAvail: Interval[] = [];
  const extraPref: Interval[] = [];
  const busyRaw: Interval[] = [];
  for (const ex of person.exceptions) {
    if (ex.kind === "busy") busyRaw.push(ex);
    else {
      extraAvail.push(ex);
      if (ex.kind === "preferred") extraPref.push(ex);
    }
  }
  for (const ev of person.busy) busyRaw.push(widen(ev));
  for (const m of opts.meetings ?? []) {
    if (m.attendeeIds.includes(person.id)) busyRaw.push(widen(m));
  }

  const busy = clip(normalize(busyRaw), range);
  const available = subtract(clip(union(normalize(weeklyAvail), extraAvail), range), busy);
  const preferred = clip(union(normalize(weeklyPref), extraPref), range);
  return {
    available,
    preferred: intersect(preferred, available),
    busy,
  };
}
