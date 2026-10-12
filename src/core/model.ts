/**
 * Domain model. All instants are epoch milliseconds (UTC). Every interval is
 * half-open: `[start, end)`.
 */

export type Ms = number;

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

export interface Interval {
  start: Ms;
  end: Ms;
}

/** Availability levels. `preferred` is always a subset of `available`. */
export type Level = "available" | "preferred";

/** 0 = Monday … 6 = Sunday, in the person's own time zone. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** A recurring weekly block, expressed in the person's local wall-clock time. */
export interface WeeklyBlock {
  day: Weekday;
  /** Minutes since local midnight, 0–1439. */
  startMin: number;
  /** Minutes since local midnight, 1–1440. Must be greater than `startMin`. */
  endMin: number;
  level: Level;
}

/** A one-off override on absolute instants. */
export interface AvailabilityException {
  id: string;
  start: Ms;
  end: Ms;
  kind: "available" | "preferred" | "busy";
  note?: string;
}

/** A busy period from an imported calendar. */
export interface BusyEvent {
  start: Ms;
  end: Ms;
  title?: string;
}

export type PersonKind = "member" | "external";

export interface Person {
  id: string;
  name: string;
  email?: string;
  /** `member` = part of the organisation, `external` = candidate, client… */
  kind: PersonKind;
  tags: string[];
  /** IANA time zone, e.g. `Europe/Paris`. */
  timeZone: string;
  weekly: WeeklyBlock[];
  exceptions: AvailabilityException[];
  busy: BusyEvent[];
}

export interface Meeting {
  id: string;
  title: string;
  start: Ms;
  end: Ms;
  attendeeIds: string[];
  createdAt: Ms;
}

export type Requirement =
  | { kind: "person"; id: string }
  | { kind: "anyOf"; ids: string[]; count: number }
  | { kind: "tag"; tag: string; count: number };

/** A daily window in `MatchQuery.timeZone`, in minutes since local midnight. */
export interface DayWindow {
  startMin: number;
  endMin: number;
}

export interface MatchQuery {
  range: Interval;
  durationMin: number;
  /** Granularity of candidate start times. Defaults to 15. */
  stepMin?: number;
  /** Minimum gap kept between the slot and any busy period. Defaults to 0. */
  bufferMin?: number;
  dayWindow?: DayWindow;
  /** Reference zone for `dayWindow` and step alignment. Defaults to UTC. */
  timeZone?: string;
  requirements: Requirement[];
}

export interface Slot {
  start: Ms;
  end: Ms;
  /** Everyone assigned, in requirement order. */
  attendees: string[];
  /** People assigned to each requirement (same index as `requirements`). */
  picks: string[][];
  /** Eligible free people not assigned, per requirement. */
  alternates: string[][];
}

/** Person availability resolved to UTC intervals over a range. */
export interface Expanded {
  available: Interval[];
  preferred: Interval[];
  busy: Interval[];
}
