import { isValidTimeZone, localParts, zonedTime } from "./expand";
import {
  type AvailabilityException,
  type BusyEvent,
  type Meeting,
  type Ms,
  type Person,
  type WeeklyBlock,
} from "./model";

export const STATE_VERSION = 1;
export const STORAGE_KEY = "slotmatch:v1";

export interface Settings {
  /** Zone used to display results and for day windows. */
  timeZone: string;
  /** Visible hours in grids, minutes since midnight. */
  dayStartMin: number;
  dayEndMin: number;
  defaultDurationMin: number;
}

export interface AppState {
  version: typeof STATE_VERSION;
  people: Person[];
  meetings: Meeting[];
  settings: Settings;
}

export function defaultSettings(timeZone = "UTC"): Settings {
  return { timeZone: isValidTimeZone(timeZone) ? timeZone : "UTC", dayStartMin: 7 * 60, dayEndMin: 20 * 60, defaultDurationMin: 45 };
}

export function emptyState(timeZone = "UTC"): AppState {
  return { version: STATE_VERSION, people: [], meetings: [], settings: defaultSettings(timeZone) };
}

export function newId(): string {
  return crypto.randomUUID();
}

/* ---------- validation ---------- */

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

function block(v: unknown): WeeklyBlock | null {
  if (!isObj(v) || !isNum(v.day) || !isNum(v.startMin) || !isNum(v.endMin)) return null;
  if (v.day < 0 || v.day > 6 || v.startMin < 0 || v.endMin > 1440 || v.endMin <= v.startMin) return null;
  return {
    day: Math.floor(v.day) as WeeklyBlock["day"],
    startMin: v.startMin,
    endMin: v.endMin,
    level: v.level === "preferred" ? "preferred" : "available",
  };
}

function exception(v: unknown): AvailabilityException | null {
  if (!isObj(v) || !isNum(v.start) || !isNum(v.end) || v.end <= v.start) return null;
  const kind = v.kind === "busy" || v.kind === "preferred" ? v.kind : "available";
  return { id: isStr(v.id) ? v.id : newId(), start: v.start, end: v.end, kind, ...(isStr(v.note) ? { note: v.note } : {}) };
}

function busyEvent(v: unknown): BusyEvent | null {
  if (!isObj(v) || !isNum(v.start) || !isNum(v.end) || v.end <= v.start) return null;
  return { start: v.start, end: v.end, ...(isStr(v.title) ? { title: v.title } : {}) };
}

const present = <T>(x: T | null): x is T => x !== null;

function person(v: unknown): Person | null {
  if (!isObj(v) || !isStr(v.id) || !isStr(v.name)) return null;
  return {
    id: v.id,
    name: v.name,
    ...(isStr(v.email) && v.email ? { email: v.email } : {}),
    kind: v.kind === "external" ? "external" : "member",
    tags: [...new Set(arr(v.tags).filter(isStr))],
    timeZone: isStr(v.timeZone) && isValidTimeZone(v.timeZone) ? v.timeZone : "UTC",
    weekly: arr(v.weekly).map(block).filter(present),
    exceptions: arr(v.exceptions).map(exception).filter(present),
    busy: arr(v.busy).map(busyEvent).filter(present),
  };
}

function meeting(v: unknown): Meeting | null {
  if (!isObj(v) || !isStr(v.id) || !isNum(v.start) || !isNum(v.end) || v.end <= v.start) return null;
  return {
    id: v.id,
    title: isStr(v.title) ? v.title : "",
    start: v.start,
    end: v.end,
    attendeeIds: arr(v.attendeeIds).filter(isStr),
    createdAt: isNum(v.createdAt) ? v.createdAt : 0,
  };
}

function settings(v: unknown, fallback: Settings): Settings {
  if (!isObj(v)) return fallback;
  const minutes = (x: unknown, d: number) => (isNum(x) && x >= 0 && x <= 1440 ? x : d);
  const dayStartMin = minutes(v.dayStartMin, fallback.dayStartMin);
  const dayEndMin = minutes(v.dayEndMin, fallback.dayEndMin);
  return {
    timeZone: isStr(v.timeZone) && isValidTimeZone(v.timeZone) ? v.timeZone : fallback.timeZone,
    dayStartMin: dayEndMin > dayStartMin ? dayStartMin : fallback.dayStartMin,
    dayEndMin: dayEndMin > dayStartMin ? dayEndMin : fallback.dayEndMin,
    defaultDurationMin: isNum(v.defaultDurationMin) && v.defaultDurationMin > 0 ? v.defaultDurationMin : fallback.defaultDurationMin,
  };
}

/**
 * Bring any stored shape up to the current version, dropping what cannot be
 * read. Returns null when the input is not slotmatch data at all.
 *
 * - v0 (no `version`): `{ people, meetings }` without settings.
 * - v1: current.
 */
export function migrate(raw: unknown, fallbackTz = "UTC"): AppState | null {
  if (!isObj(raw)) return null;
  const version = raw.version ?? 0;
  if (version !== 0 && version !== 1) return null;
  if (!Array.isArray(raw.people)) return null;
  const people = raw.people.map(person).filter(present);
  const ids = new Set<string>();
  const unique = people.filter((p) => !ids.has(p.id) && ids.add(p.id));
  return {
    version: STATE_VERSION,
    people: unique,
    meetings: arr(raw.meetings).map(meeting).filter(present),
    settings: settings(version === 1 ? raw.settings : undefined, defaultSettings(fallbackTz)),
  };
}

/* ---------- storage ---------- */

export function load(storage: Pick<Storage, "getItem">, fallbackTz = "UTC"): AppState {
  try {
    const text = storage.getItem(STORAGE_KEY);
    if (!text) return emptyState(fallbackTz);
    return migrate(JSON.parse(text), fallbackTz) ?? emptyState(fallbackTz);
  } catch {
    return emptyState(fallbackTz);
  }
}

export const UNREADABLE_KEY = `${STORAGE_KEY}:unreadable`;

/**
 * If the stored value exists but cannot be read (damaged, or written by a newer
 * version), copy it aside before the app saves over it. Returns true when a
 * copy was made.
 */
export function preserveUnreadable(storage: Pick<Storage, "getItem" | "setItem">): boolean {
  try {
    const text = storage.getItem(STORAGE_KEY);
    if (!text) return false;
    let readable = false;
    try {
      readable = migrate(JSON.parse(text)) !== null;
    } catch {
      readable = false;
    }
    if (readable) return false;
    storage.setItem(UNREADABLE_KEY, text);
    return true;
  } catch {
    return false;
  }
}

/** Returns false when the browser refuses to store (quota, private mode…). */
export function save(state: AppState, storage: Pick<Storage, "setItem">): boolean {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

/* ---------- JSON backup ---------- */

export function exportJson(state: AppState): string {
  return JSON.stringify({ app: "slotmatch", ...state }, null, 2);
}

export class ImportError extends Error {
  override name = "ImportError";
}

/** `replace` swaps people and meetings; `merge` upserts them by id. Settings are kept. */
export function importJson(current: AppState, text: string, mode: "merge" | "replace"): AppState {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ImportError("The file is not valid JSON.");
  }
  const incoming = migrate(raw, current.settings.timeZone);
  if (!incoming) throw new ImportError("The file is not a slotmatch backup.");
  if (mode === "replace") return { ...current, people: incoming.people, meetings: incoming.meetings };
  const upsert = <T extends { id: string }>(base: T[], add: T[]) => {
    const byId = new Map(base.map((x) => [x.id, x]));
    for (const x of add) byId.set(x.id, x);
    return [...byId.values()];
  };
  return {
    ...current,
    people: upsert(current.people, incoming.people),
    meetings: upsert(current.meetings, incoming.meetings),
  };
}

/* ---------- demo ---------- */

const weekdays = (days: number[], startH: number, endH: number, level: WeeklyBlock["level"] = "available"): WeeklyBlock[] =>
  days.map((day) => ({ day: day as WeeklyBlock["day"], startMin: startH * 60, endMin: endH * 60, level }));

/** Absolute interval on the `n`-th working day after today (0 = the next one), local time in `tz`. */
function workday(now: Ms, tz: string, n: number, startH: number, endH: number) {
  const today = localParts(now, tz);
  let seen = -1;
  for (let offset = 1; offset < 30; offset++) {
    const p = localParts(zonedTime(today.year, today.month, today.day + offset, 12 * 60, tz), tz);
    if (p.weekday > 4 || ++seen < n) continue;
    return {
      start: zonedTime(p.year, p.month, p.day, startH * 60, tz),
      end: zonedTime(p.year, p.month, p.day, endH * 60, tz),
    };
  }
  throw new Error("unreachable: a working day exists within 30 days");
}

/** Six team members across zones and two candidates who answered for the next working days. */
export function demoState(now: Ms, timeZone = "Europe/Paris"): AppState {
  const MON_FRI = [0, 1, 2, 3, 4];
  const member = (id: string, name: string, tags: string[], tz: string, weekly: WeeklyBlock[], email?: string): Person => ({
    id,
    name,
    ...(email ? { email } : {}),
    kind: "member",
    tags,
    timeZone: tz,
    weekly,
    exceptions: [],
    busy: [],
  });
  const people: Person[] = [
    member("demo-alice", "Alice Martin", ["engineering", "backend"], "Europe/Paris", [
      ...weekdays(MON_FRI, 9, 12),
      ...weekdays(MON_FRI, 14, 18, "preferred"),
    ], "alice@example.com"),
    member("demo-bruno", "Bruno Costa", ["engineering", "frontend"], "Europe/Lisbon", [
      ...weekdays([0, 1, 2, 3], 9, 13),
      ...weekdays([1, 3], 14, 17, "preferred"),
    ], "bruno@example.com"),
    member("demo-chen", "Chen Wei", ["engineering", "backend"], "Asia/Singapore", weekdays(MON_FRI, 10, 19)),
    member("demo-dana", "Dana Brooks", ["hr"], "America/New_York", [
      ...weekdays(MON_FRI, 8, 10, "preferred"),
      ...weekdays(MON_FRI, 10, 16),
    ], "dana@example.com"),
    member("demo-elif", "Elif Kaya", ["hr", "recruiting"], "Europe/Istanbul", weekdays(MON_FRI, 9, 17)),
    member("demo-farid", "Farid Haddad", ["design"], "Europe/Paris", weekdays([0, 2, 4], 9, 17)),
  ];
  const alice = people[0]!;
  const sprint = workday(now, alice.timeZone, 1, 10, 11);
  alice.exceptions.push({ id: "demo-alice-sprint", ...sprint, kind: "busy", note: "Sprint review" });

  const candidate = (id: string, name: string, tz: string, slots: [number, number, number, ("available" | "preferred")?][], email?: string): Person => ({
    id,
    name,
    ...(email ? { email } : {}),
    kind: "external",
    tags: ["candidate"],
    timeZone: tz,
    weekly: [],
    exceptions: slots.map(([day, a, b, kind], i) => ({ id: `${id}-${i}`, ...workday(now, tz, day, a, b), kind: kind ?? "available" })),
    busy: [],
  });
  people.push(
    candidate("demo-gabriel", "Gabriel Silva", "America/Sao_Paulo", [
      [0, 9, 12],
      [1, 8, 10],
      [1, 10, 12, "preferred"],
      [2, 9, 13],
    ], "gabriel@example.net"),
    candidate("demo-hana", "Hana Sato", "Asia/Tokyo", [
      [0, 16, 21],
      [2, 17, 22, "preferred"],
      [3, 16, 20],
    ]),
  );
  return { version: STATE_VERSION, people, meetings: [], settings: defaultSettings(timeZone) };
}
