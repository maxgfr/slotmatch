import { isDate, validAbsence } from "./calendar";
import { absenceInterval, isValidTimeZone } from "./expand";
import { normalize } from "./intervals";
import { MINUTE, type Absence, type AvailabilityException, type Interval, type Meeting, type Ms, type Person } from "./model";
import { newId, type AppState } from "./store";

/*
 * Share links carry their data in the URL hash: JSON → deflate-raw → base64url.
 * Intervals are stored as minute deltas from the range start to stay short.
 */

export const SHARE_VERSION = 1;

/** Sent by the organiser: "tell me when you are free in this range". */
export interface ShareRequest {
  title: string;
  range: Interval;
  durationMin: number;
  /** The organiser's zone, shown to the respondent for context. */
  timeZone: string;
  /** Optional proposals the respondent can pick from. */
  slots?: Interval[];
}

/** Sent back by the respondent. */
export interface ShareResponse {
  name: string;
  email?: string;
  timeZone: string;
  /** Range the answer covers; availability outside it is unknown. */
  range: Interval;
  available: Interval[];
  preferred: Interval[];
  /** Title of the request being answered. */
  title?: string;
}

/** A read-only team calendar: absences and meetings, never weekly hours or calendar imports. */
export interface ShareCalendar {
  title: string;
  /** The sender's display zone. */
  timeZone: string;
  range: Interval;
  people: SharedPerson[];
  meetings: SharedMeeting[];
}

export interface SharedPerson {
  name: string;
  email?: string;
  tags: string[];
  timeZone: string;
  absences: Absence[];
}

export interface SharedMeeting {
  id: string;
  title: string;
  start: Ms;
  end: Ms;
  /** Indexes into `ShareCalendar.people`. */
  attendees: number[];
}

export type ShareErrorCode = "malformed" | "version" | "kind";

export class ShareError extends Error {
  constructor(
    readonly code: ShareErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ShareError";
  }
}

/* ---------- bytes ---------- */

const MAX_BYTES = 512 * 1024;

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const reader = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(stream).getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_BYTES) {
      await reader.cancel();
      throw new ShareError("malformed", "Link payload is too large.");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new ShareError("malformed", "Link contains invalid characters.");
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4);
  let bin: string;
  try {
    bin = atob(b64);
  } catch {
    throw new ShareError("malformed", "Link is not valid base64.");
  }
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function pack(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return toBase64Url(await pipe(bytes, new CompressionStream("deflate-raw")));
}

async function unpack(text: string): Promise<Record<string, unknown>> {
  const compressed = fromBase64Url(text.trim());
  let json: unknown;
  try {
    const bytes = await pipe(compressed, new DecompressionStream("deflate-raw"));
    json = JSON.parse(new TextDecoder().decode(bytes));
  } catch (e) {
    if (e instanceof ShareError) throw e;
    throw new ShareError("malformed", "Link is damaged or incomplete.");
  }
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    throw new ShareError("malformed", "Link does not contain slotmatch data.");
  }
  const obj = json as Record<string, unknown>;
  if (obj.v !== SHARE_VERSION) {
    throw new ShareError("version", `Link version ${String(obj.v)} is not supported (expected ${SHARE_VERSION}).`);
  }
  return obj;
}

/* ---------- interval deltas ---------- */

/** [gap, length, gap, length…] in minutes; each gap counts from the previous end (first from `base`). */
export function toDeltas(list: readonly Interval[], base: number): number[] {
  const out: number[] = [];
  let cursor = base;
  for (const iv of normalize(list)) {
    const start = Math.round((iv.start - cursor) / MINUTE);
    const len = Math.round((iv.end - iv.start) / MINUTE);
    out.push(start, len);
    cursor += (start + len) * MINUTE;
  }
  return out;
}

export function fromDeltas(deltas: readonly number[], base: number): Interval[] {
  const out: Interval[] = [];
  let cursor = base;
  for (let i = 0; i + 1 < deltas.length; i += 2) {
    const start = cursor + deltas[i]! * MINUTE;
    const end = start + deltas[i + 1]! * MINUTE;
    out.push({ start, end });
    cursor = end;
  }
  return out;
}

/* ---------- validation ---------- */

const str = (v: unknown, max = 200): v is string => typeof v === "string" && v.length <= max;
const zone = (v: unknown): v is string => str(v, 64) && isValidTimeZone(v);
const int = (v: unknown): v is number => Number.isSafeInteger(v);
const deltas = (v: unknown): v is number[] =>
  Array.isArray(v) && v.length % 2 === 0 && v.length <= 20_000 && v.every((n) => int(n) && n >= 0);

function fail(what: string): never {
  throw new ShareError("malformed", `Link has an invalid ${what}.`);
}

function kind(obj: Record<string, unknown>, expected: string, label: string) {
  if (obj.k !== expected) throw new ShareError("kind", `This is not a ${label} link.`);
}

/* ---------- request ---------- */

export async function encodeRequest(req: ShareRequest): Promise<string> {
  const s = Math.floor(req.range.start / MINUTE);
  const base = s * MINUTE;
  return pack({
    v: SHARE_VERSION,
    k: "q",
    t: req.title,
    s,
    l: Math.round((req.range.end - base) / MINUTE),
    d: req.durationMin,
    z: req.timeZone,
    ...(req.slots?.length ? { p: toDeltas(req.slots, base) } : {}),
  });
}

export async function decodeRequest(text: string): Promise<ShareRequest> {
  const o = await unpack(text);
  kind(o, "q", "request");
  if (!str(o.t)) fail("title");
  if (!int(o.s) || !int(o.l) || o.l <= 0) fail("range");
  if (!int(o.d) || o.d <= 0) fail("duration");
  if (!zone(o.z)) fail("time zone");
  if (o.p !== undefined && !deltas(o.p)) fail("slot list");
  const base = o.s * MINUTE;
  return {
    title: o.t,
    range: { start: base, end: base + o.l * MINUTE },
    durationMin: o.d,
    timeZone: o.z,
    ...(o.p ? { slots: fromDeltas(o.p, base) } : {}),
  };
}

/* ---------- response ---------- */

export async function encodeResponse(res: ShareResponse): Promise<string> {
  const s = Math.floor(res.range.start / MINUTE);
  const base = s * MINUTE;
  return pack({
    v: SHARE_VERSION,
    k: "r",
    n: res.name,
    ...(res.email ? { m: res.email } : {}),
    z: res.timeZone,
    s,
    l: Math.round((res.range.end - base) / MINUTE),
    a: toDeltas(res.available, base),
    p: toDeltas(res.preferred, base),
    ...(res.title ? { t: res.title } : {}),
  });
}

export async function decodeResponse(text: string): Promise<ShareResponse> {
  const o = await unpack(text);
  kind(o, "r", "response");
  if (!str(o.n) || o.n.trim() === "") fail("name");
  if (o.m !== undefined && !str(o.m)) fail("email");
  if (!zone(o.z)) fail("time zone");
  if (!int(o.s) || !int(o.l) || o.l <= 0) fail("range");
  if (!deltas(o.a) || !deltas(o.p)) fail("availability");
  if (o.t !== undefined && !str(o.t)) fail("title");
  const base = o.s * MINUTE;
  return {
    name: o.n,
    ...(o.m ? { email: o.m } : {}),
    timeZone: o.z,
    range: { start: base, end: base + o.l * MINUTE },
    available: fromDeltas(o.a, base),
    preferred: fromDeltas(o.p, base),
    ...(o.t ? { title: o.t } : {}),
  };
}

/* ---------- calendar ---------- */

const overlaps = (a: Interval, b: Interval) => a.start < b.end && b.start < a.end;

/**
 * The part of the team calendar inside `range`: people appear only when they
 * have an absence or a meeting there.
 */
export function buildCalendar(people: readonly Person[], meetings: readonly Meeting[], range: Interval, title: string, timeZone: string): ShareCalendar {
  const inRange = meetings.filter((m) => overlaps(m, range));
  const attending = new Set(inRange.flatMap((m) => m.attendeeIds));
  const shared: SharedPerson[] = [];
  const index = new Map<string, number>();
  for (const p of people) {
    const absences = p.absences.filter((a) => overlaps(absenceInterval(a, p.timeZone), range));
    if (!absences.length && !attending.has(p.id)) continue;
    index.set(p.id, shared.length);
    shared.push({ name: p.name, ...(p.email ? { email: p.email } : {}), tags: p.tags, timeZone: p.timeZone, absences });
  }
  return {
    title,
    timeZone,
    range,
    people: shared,
    meetings: inRange.map((m) => ({
      id: m.id,
      title: m.title,
      start: m.start,
      end: m.end,
      attendees: m.attendeeIds.map((id) => index.get(id)).filter((i): i is number => i !== undefined),
    })),
  };
}

const ABSENCE_KINDS: readonly Absence["kind"][] = ["vacation", "sick", "other"];

export async function encodeCalendar(cal: ShareCalendar): Promise<string> {
  const s = Math.floor(cal.range.start / MINUTE);
  const base = s * MINUTE;
  return pack({
    v: SHARE_VERSION,
    k: "c",
    t: cal.title,
    z: cal.timeZone,
    s,
    l: Math.round((cal.range.end - base) / MINUTE),
    // [name, email, tags, zone, [[id, kind, from, to, flags (1 = from pm, 2 = to am), note?]]]
    p: cal.people.map((p) => [
      p.name,
      p.email ?? "",
      p.tags,
      p.timeZone,
      p.absences.map((a) => [a.id, a.kind, a.from, a.to, (a.fromPm ? 1 : 0) | (a.toAm ? 2 : 0), ...(a.note ? [a.note] : [])]),
    ]),
    // [id, title, start minutes from range start (may be negative), length, attendee indexes]
    m: cal.meetings.map((m) => [m.id, m.title, Math.round((m.start - base) / MINUTE), Math.round((m.end - m.start) / MINUTE), m.attendees]),
  });
}

const list = (v: unknown, max: number): v is unknown[] => Array.isArray(v) && v.length <= max;

function sharedAbsence(v: unknown): Absence {
  if (!list(v, 6) || v.length < 5) fail("absence");
  const [id, k, from, to, flags, note] = v;
  if (!str(id, 64) || !ABSENCE_KINDS.includes(k as Absence["kind"]) || !isDate(from) || !isDate(to)) fail("absence");
  if (!int(flags) || flags < 0 || flags > 3 || (note !== undefined && !str(note))) fail("absence");
  const a: Absence = {
    id,
    kind: k as Absence["kind"],
    from,
    to,
    ...(flags & 1 ? { fromPm: true } : {}),
    ...(flags & 2 ? { toAm: true } : {}),
    ...(note ? { note } : {}),
  };
  if (!validAbsence(a)) fail("absence");
  return a;
}

function sharedPerson(v: unknown): SharedPerson {
  if (!list(v, 5) || v.length !== 5) fail("person");
  const [name, email, tags, tz, absences] = v;
  if (!str(name) || name.trim() === "" || !str(email) || !list(tags, 50) || !tags.every((t) => str(t, 50))) fail("person");
  if (!zone(tz)) fail("time zone");
  if (!list(absences, 1000)) fail("absence list");
  return { name, ...(email ? { email } : {}), tags: tags as string[], timeZone: tz, absences: absences.map(sharedAbsence) };
}

export async function decodeCalendar(text: string): Promise<ShareCalendar> {
  const o = await unpack(text);
  kind(o, "c", "calendar");
  if (!str(o.t)) fail("title");
  if (!zone(o.z)) fail("time zone");
  if (!int(o.s) || !int(o.l) || o.l <= 0) fail("range");
  if (!list(o.p, 500) || !list(o.m, 5000)) fail("calendar");
  const base = o.s * MINUTE;
  const people = o.p.map(sharedPerson);
  const meetings = o.m.map((v): SharedMeeting => {
    if (!list(v, 5) || v.length !== 5) fail("meeting");
    const [id, title, start, len, attendees] = v;
    if (!str(id, 64) || !str(title) || !int(start) || !int(len) || len <= 0) fail("meeting");
    if (!list(attendees, 500) || !attendees.every((i) => int(i) && i >= 0 && i < people.length)) fail("meeting");
    return { id, title, start: base + start * MINUTE, end: base + (start + len) * MINUTE, attendees: attendees as number[] };
  });
  return { title: o.t, timeZone: o.z, range: { start: base, end: base + o.l * MINUTE }, people, meetings };
}

export interface CalendarImport {
  state: AppState;
  /** People created because nobody matched them by email or name. */
  newPeople: number;
  /** Absences and meetings added or changed. */
  absences: number;
  meetings: number;
}

/**
 * Merge a shared calendar into local data. People are matched by email, then
 * by name; absences and meetings are upserted by id, so importing the same
 * link twice changes nothing.
 */
export function applyCalendar(state: AppState, cal: ShareCalendar, now: Ms): CalendarImport {
  const norm = (s: string) => s.trim().toLowerCase();
  const people = [...state.people];
  let newPeople = 0;
  let absences = 0;
  const localIds = cal.people.map((sp) => {
    let i = sp.email ? people.findIndex((p) => p.email && norm(p.email) === norm(sp.email!)) : -1;
    if (i < 0) i = people.findIndex((p) => norm(p.name) === norm(sp.name));
    if (i < 0) {
      newPeople++;
      i = people.push({
        id: newId(),
        name: sp.name,
        ...(sp.email ? { email: sp.email } : {}),
        kind: "member",
        tags: sp.tags,
        timeZone: sp.timeZone,
        weekly: [],
        exceptions: [],
        busy: [],
        absences: [],
      }) - 1;
    }
    const person = people[i]!;
    const byId = new Map(person.absences.map((a) => [a.id, a]));
    for (const a of sp.absences) {
      if (JSON.stringify(byId.get(a.id)) === JSON.stringify(a)) continue;
      byId.set(a.id, a);
      absences++;
    }
    people[i] = { ...person, absences: [...byId.values()] };
    return person.id;
  });

  const meetings = new Map(state.meetings.map((m) => [m.id, m]));
  let changed = 0;
  for (const sm of cal.meetings) {
    const old = meetings.get(sm.id);
    const m: Meeting = {
      id: sm.id,
      title: sm.title,
      start: sm.start,
      end: sm.end,
      attendeeIds: [...new Set(sm.attendees.map((i) => localIds[i]!))],
      createdAt: old?.createdAt ?? now,
    };
    if (old && JSON.stringify(old) === JSON.stringify(m)) continue;
    meetings.set(m.id, m);
    changed++;
  }
  return { state: { ...state, people, meetings: [...meetings.values()] }, newPeople, absences, meetings: changed };
}

/* ---------- URLs ---------- */

/** `base` is the app URL without hash, e.g. `https://example.com/slotmatch/`. */
export function shareUrl(base: string, route: "respond" | "import" | "calendar-view", data: string): string {
  return `${base.replace(/#.*$/, "")}#/${route}?d=${data}`;
}

/* ---------- applying an answer ---------- */

/**
 * Replace a person's answered availability inside the response range and keep
 * everything else: busy times, earlier answers outside the range, weekly hours
 * and the person's own time zone (their weekly hours are expressed in it).
 */
export function applyResponse(person: Person, res: ShareResponse): Person {
  const keep = (x: AvailabilityException) => x.kind === "busy" || x.end <= res.range.start || x.start >= res.range.end;
  const answered: AvailabilityException[] = [
    ...res.available.map((iv) => ({ id: newId(), ...iv, kind: "available" as const, note: "From response link" })),
    ...res.preferred.map((iv) => ({ id: newId(), ...iv, kind: "preferred" as const, note: "From response link" })),
  ];
  return {
    ...person,
    ...(res.email && !person.email ? { email: res.email } : {}),
    exceptions: [...person.exceptions.filter(keep), ...answered],
  };
}
