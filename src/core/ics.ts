import { isValidTimeZone, zonedTime } from "./expand";
import { DAY, type BusyEvent, type Interval, type Meeting, type Ms, type Person } from "./model";

/*
 * A pragmatic iCalendar (RFC 5545) subset: enough to read busy times from
 * Google Calendar / Outlook exports and to write meetings back out.
 */

/* ---------- lines ---------- */

interface Prop {
  name: string;
  params: Record<string, string>;
  value: string;
}

function unfold(text: string): string[] {
  return text
    .replace(/\r\n|\r/g, "\n")
    .replace(/\n[ \t]/g, "")
    .split("\n")
    .filter((l) => l.length > 0);
}

/** Split on `sep` outside double quotes. */
function splitOutsideQuotes(s: string, sep: string, max = Infinity): string[] {
  const out: string[] = [];
  let quoted = false;
  let from = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"') quoted = !quoted;
    else if (c === sep && !quoted && out.length < max - 1) {
      out.push(s.slice(from, i));
      from = i + 1;
    }
  }
  out.push(s.slice(from));
  return out;
}

function parseLine(line: string): Prop | null {
  const [head, value] = splitOutsideQuotes(line, ":", 2);
  if (value === undefined || head === undefined) return null;
  const [name, ...rawParams] = splitOutsideQuotes(head, ";");
  const params: Record<string, string> = {};
  for (const p of rawParams) {
    const eq = p.indexOf("=");
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, "");
  }
  return { name: (name ?? "").toUpperCase(), params, value };
}

function unescapeText(v: string): string {
  return v.replace(/\\([\\;,nN])/g, (_, c: string) => (c === "n" || c === "N" ? "\n" : c));
}

/* ---------- time zones ---------- */

/** Windows zone names used by Outlook/Exchange exports. */
const WINDOWS_ZONES: Record<string, string> = {
  "Romance Standard Time": "Europe/Paris",
  "W. Europe Standard Time": "Europe/Berlin",
  "Central Europe Standard Time": "Europe/Budapest",
  "Central European Standard Time": "Europe/Warsaw",
  "GMT Standard Time": "Europe/London",
  "Greenwich Standard Time": "Atlantic/Reykjavik",
  "E. Europe Standard Time": "Europe/Chisinau",
  "FLE Standard Time": "Europe/Helsinki",
  "GTB Standard Time": "Europe/Bucharest",
  "Russian Standard Time": "Europe/Moscow",
  "Eastern Standard Time": "America/New_York",
  "Central Standard Time": "America/Chicago",
  "Mountain Standard Time": "America/Denver",
  "Pacific Standard Time": "America/Los_Angeles",
  "Atlantic Standard Time": "America/Halifax",
  "E. South America Standard Time": "America/Sao_Paulo",
  "India Standard Time": "Asia/Kolkata",
  "China Standard Time": "Asia/Shanghai",
  "Tokyo Standard Time": "Asia/Tokyo",
  "Singapore Standard Time": "Asia/Singapore",
  "AUS Eastern Standard Time": "Australia/Sydney",
  "New Zealand Standard Time": "Pacific/Auckland",
  UTC: "UTC",
  "Coordinated Universal Time": "UTC",
};

function resolveZone(tzid: string | undefined, fallback: string, warn: (m: string) => void): string {
  if (!tzid) return fallback;
  if (isValidTimeZone(tzid)) return tzid;
  const win = WINDOWS_ZONES[tzid];
  if (win) return win;
  // e.g. "/mozilla.org/20050126_1/Europe/Paris"
  const tail = tzid.match(/([A-Za-z_]+\/[A-Za-z_+-]+)$/)?.[1];
  if (tail && isValidTimeZone(tail)) return tail;
  warn(`Unknown time zone "${tzid}", read as ${fallback}.`);
  return fallback;
}

/* ---------- dates ---------- */

interface LocalStamp {
  /** Civil date. */
  y: number;
  m: number;
  d: number;
  /** Seconds since local midnight. */
  sec: number;
  /** Zone the wall time is in; "UTC" for `Z` values. */
  tz: string;
  allDay: boolean;
}

function parseStamp(value: string, params: Record<string, string>, fallbackTz: string, warn: (m: string) => void): LocalStamp | null {
  const m = value.trim().match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return null;
  const [, y, mo, d, hh, mm, ss, z] = m;
  const allDay = params.VALUE === "DATE" || hh === undefined;
  return {
    y: Number(y),
    m: Number(mo) - 1,
    d: Number(d),
    sec: allDay ? 0 : Number(hh) * 3600 + Number(mm) * 60 + Number(ss ?? 0),
    tz: z ? "UTC" : resolveZone(params.TZID, fallbackTz, warn),
    allDay,
  };
}

function stampToMs(s: LocalStamp, dayOffset = 0): Ms {
  return zonedTime(s.y, s.m, s.d + dayOffset, Math.floor(s.sec / 60), s.tz) + (s.sec % 60) * 1000;
}

const civilDay = (y: number, m: number, d: number) => Math.round(Date.UTC(y, m, d) / DAY);
/** 0 = Monday. */
const civilWeekday = (n: number) => (((n + 3) % 7) + 7) % 7;

function parseDuration(v: string): { days: number; ms: number } | null {
  const m = v.trim().match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m) return null;
  const sign = m[1] === "-" ? -1 : 1;
  const n = (i: number) => Number(m[i] ?? 0);
  return { days: sign * (n(2) * 7 + n(3)), ms: sign * (n(4) * 3600 + n(5) * 60 + n(6)) * 1000 };
}

/* ---------- recurrence ---------- */

const WEEKDAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];

interface Rule {
  freq: string;
  interval: number;
  count?: number;
  until?: Ms;
  byDay?: number[];
}

function parseRule(value: string, tz: string, warn: (m: string) => void): Rule {
  const parts = Object.fromEntries(
    value.split(";").map((kv) => {
      const [k, v] = kv.split("=");
      return [(k ?? "").toUpperCase(), v ?? ""];
    }),
  );
  const rule: Rule = { freq: (parts.FREQ ?? "").toUpperCase(), interval: Math.max(1, Number(parts.INTERVAL ?? 1) || 1) };
  if (parts.COUNT) rule.count = Number(parts.COUNT);
  if (parts.UNTIL) {
    const s = parseStamp(parts.UNTIL, {}, tz, warn);
    // A date-only UNTIL includes that whole day.
    if (s) rule.until = s.allDay ? stampToMs(s, 1) - 1 : stampToMs(s);
  }
  if (parts.BYDAY) {
    rule.byDay = parts.BYDAY.split(",")
      .map((d) => WEEKDAYS.indexOf(d.replace(/^[+-]?\d+/, "").toUpperCase()))
      .filter((d) => d >= 0);
  }
  return rule;
}

/* ---------- parse ---------- */

export interface ParseOptions {
  /** Only events overlapping this range are returned; recurrences are expanded over it. */
  range: Interval;
  /** Zone for floating times and all-day events. */
  defaultTimeZone: string;
}

export interface ParseResult {
  events: BusyEvent[];
  warnings: string[];
}

type RawEvent = Map<string, Prop[]>;

export function parseIcs(text: string, opts: ParseOptions): ParseResult {
  const warnings: string[] = [];
  const warn = (m: string) => {
    if (!warnings.includes(m)) warnings.push(m);
  };

  const raw: RawEvent[] = [];
  const stack: string[] = [];
  let current: RawEvent | null = null;
  for (const line of unfold(text)) {
    const prop = parseLine(line);
    if (!prop) continue;
    if (prop.name === "BEGIN") {
      stack.push(prop.value.toUpperCase());
      if (prop.value.toUpperCase() === "VEVENT") current = new Map();
    } else if (prop.name === "END") {
      const closed = stack.pop();
      if (closed === "VEVENT" && current) {
        raw.push(current);
        current = null;
      }
    } else if (current && stack[stack.length - 1] === "VEVENT") {
      const list = current.get(prop.name) ?? [];
      list.push(prop);
      current.set(prop.name, list);
    }
  }

  const first = (ev: RawEvent, name: string) => ev.get(name)?.[0];
  const tzOf = (p: Prop) => parseStamp(p.value, p.params, opts.defaultTimeZone, warn);

  // Overridden occurrences of a series: UID -> original start instants.
  const overridden = new Map<string, Set<Ms>>();
  for (const ev of raw) {
    const rid = first(ev, "RECURRENCE-ID");
    const uid = first(ev, "UID")?.value;
    if (!rid || !uid) continue;
    const s = tzOf(rid);
    if (!s) continue;
    const set = overridden.get(uid) ?? new Set();
    set.add(stampToMs(s));
    overridden.set(uid, set);
  }

  const events: BusyEvent[] = [];
  const { range } = opts;
  const emit = (start: Ms, end: Ms, title?: string) => {
    if (end > start && start < range.end && end > range.start) events.push({ start, end, ...(title ? { title } : {}) });
  };

  for (const ev of raw) {
    const title = first(ev, "SUMMARY") ? unescapeText(first(ev, "SUMMARY")!.value) : undefined;
    if (first(ev, "STATUS")?.value.toUpperCase() === "CANCELLED") continue;
    if (first(ev, "TRANSP")?.value.toUpperCase() === "TRANSPARENT") continue;
    const dtstart = first(ev, "DTSTART");
    const start = dtstart && tzOf(dtstart);
    if (!start) {
      warn("Skipped an event without a readable start.");
      continue;
    }

    // Length: whole days (nominal) for all-day events, exact ms otherwise.
    let lenDays = 0;
    let lenMs = 0;
    const dtend = first(ev, "DTEND");
    const duration = first(ev, "DURATION");
    const startMs = stampToMs(start);
    if (dtend) {
      const end = tzOf(dtend);
      if (!end) continue;
      if (start.allDay) lenDays = civilDay(end.y, end.m, end.d) - civilDay(start.y, start.m, start.d);
      else lenMs = stampToMs(end) - startMs;
    } else if (duration) {
      const d = parseDuration(duration.value);
      if (!d) continue;
      lenDays = d.days;
      lenMs = d.ms;
    } else if (start.allDay) {
      lenDays = 1;
    }
    const endOf = (dayOffset: number) =>
      lenDays ? stampToMs(start, dayOffset + lenDays) + lenMs : stampToMs(start, dayOffset) + lenMs;

    const rrule = first(ev, "RRULE");
    if (!rrule || first(ev, "RECURRENCE-ID")) {
      emit(startMs, endOf(0), title);
      continue;
    }

    const rule = parseRule(rrule.value, start.tz, warn);
    if (rule.freq !== "DAILY" && rule.freq !== "WEEKLY") {
      warn(`Only daily and weekly repeats are supported; "${title ?? "untitled"}" (${rule.freq || "?"}) was imported once.`);
      emit(startMs, endOf(0), title);
      continue;
    }

    const excluded = new Set<Ms>(overridden.get(first(ev, "UID")?.value ?? "") ?? []);
    for (const ex of ev.get("EXDATE") ?? []) {
      for (const v of ex.value.split(",")) {
        const s = parseStamp(v, ex.params, start.tz, warn);
        if (s) excluded.add(s.allDay && !start.allDay ? stampToMs({ ...s, sec: start.sec, tz: start.tz }) : stampToMs(s));
      }
    }

    const n0 = civilDay(start.y, start.m, start.d);
    const w0 = civilWeekday(n0);
    const days = rule.byDay?.length ? rule.byDay : rule.freq === "WEEKLY" ? [w0] : undefined;
    let count = 0;
    for (let offset = 0; offset < 366 * 30; offset++) {
      const n = n0 + offset;
      const wd = civilWeekday(n);
      const inPeriod =
        rule.freq === "DAILY"
          ? offset % rule.interval === 0
          : Math.floor((n - (n0 - w0)) / 7) % rule.interval === 0;
      if (!inPeriod || (days && !days.includes(wd))) continue;
      const occStart = stampToMs(start, offset);
      if (rule.until !== undefined && occStart > rule.until) break;
      if (occStart >= range.end) break;
      count++;
      if (rule.count !== undefined && count > rule.count) break;
      if (!excluded.has(occStart)) emit(occStart, endOf(offset), title);
    }
  }

  events.sort((a, b) => a.start - b.start || a.end - b.end);
  return { events, warnings };
}

/* ---------- export ---------- */

function escapeText(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

function utcStamp(ms: Ms): string {
  return new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

const encoder = new TextEncoder();

/** Fold a content line at 75 octets without splitting a UTF-8 sequence. */
export function foldLine(line: string): string {
  const out: string[] = [];
  let current = "";
  let bytes = 0;
  for (const ch of line) {
    const size = encoder.encode(ch).length;
    const limit = out.length === 0 ? 75 : 74; // continuation lines start with a space
    if (bytes + size > limit) {
      out.push(current);
      current = "";
      bytes = 0;
    }
    current += ch;
    bytes += size;
  }
  out.push(current);
  return out.join("\r\n ");
}

export interface ExportOptions {
  /** DTSTAMP value. Defaults to now. */
  now?: Ms;
  calendarName?: string;
}

export function exportIcs(meetings: readonly Meeting[], people: readonly Person[], opts: ExportOptions = {}): string {
  const byId = new Map(people.map((p) => [p.id, p]));
  const stamp = utcStamp(opts.now ?? Date.now());
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//slotmatch//slotmatch//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  if (opts.calendarName) lines.push(`X-WR-CALNAME:${escapeText(opts.calendarName)}`);
  for (const m of meetings) {
    const attendees = m.attendeeIds.map((id) => byId.get(id)).filter((p): p is Person => !!p);
    lines.push(
      "BEGIN:VEVENT",
      `UID:${m.id}@slotmatch`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${utcStamp(m.start)}`,
      `DTEND:${utcStamp(m.end)}`,
      `SUMMARY:${escapeText(m.title || "Meeting")}`,
    );
    if (attendees.length) lines.push(`DESCRIPTION:${escapeText(`Participants: ${attendees.map((p) => p.name).join(", ")}`)}`);
    for (const p of attendees) {
      const cn = p.name.replace(/"/g, "'");
      // ATTENDEE needs a calendar address; people without an email only appear in DESCRIPTION.
      if (p.email) lines.push(`ATTENDEE;CN="${cn}";ROLE=REQ-PARTICIPANT:mailto:${p.email}`);
    }
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
