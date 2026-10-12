import { isValidTimeZone } from "./expand";
import { normalize } from "./intervals";
import { MINUTE, type AvailabilityException, type Interval, type Person } from "./model";
import { newId } from "./store";

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

/* ---------- URLs ---------- */

/** `base` is the app URL without hash, e.g. `https://example.com/slotmatch/`. */
export function shareUrl(base: string, route: "respond" | "import", data: string): string {
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
