import { describe, expect, test } from "bun:test";
import type { Meeting, Person } from "./model";
import {
  applyCalendar,
  applyResponse,
  buildCalendar,
  decodeCalendar,
  decodeRequest,
  decodeResponse,
  encodeCalendar,
  encodeRequest,
  encodeResponse,
  fromDeltas,
  ShareError,
  shareUrl,
  toDeltas,
  type ShareCalendar,
  type ShareRequest,
  type ShareResponse,
} from "./share";
import { emptyState } from "./store";

const utc = (iso: string) => Date.parse(iso);
const H = 3_600_000;
const RANGE = { start: utc("2026-10-12T00:00:00Z"), end: utc("2026-10-19T00:00:00Z") };

async function rejects(p: Promise<unknown>): Promise<ShareError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ShareError);
    return e as ShareError;
  }
  throw new Error("expected a rejection");
}

describe("deltas", () => {
  test("round-trip, normalized", () => {
    const list = [
      { start: RANGE.start + 9 * H, end: RANGE.start + 10 * H },
      { start: RANGE.start + 8 * H, end: RANGE.start + 9 * H }, // adjacent, merged
      { start: RANGE.start + 30 * H, end: RANGE.start + 31.5 * H },
    ];
    const d = toDeltas(list, RANGE.start);
    expect(d).toEqual([480, 120, 1200, 90]);
    expect(fromDeltas(d, RANGE.start)).toEqual([
      { start: RANGE.start + 8 * H, end: RANGE.start + 10 * H },
      { start: RANGE.start + 30 * H, end: RANGE.start + 31.5 * H },
    ]);
  });
});

describe("request links", () => {
  test("round-trip", async () => {
    const req: ShareRequest = {
      title: "Interview — Backend engineer",
      range: RANGE,
      durationMin: 45,
      timeZone: "Europe/Paris",
      slots: [{ start: RANGE.start + 9 * H, end: RANGE.start + 9.75 * H }],
    };
    expect(await decodeRequest(await encodeRequest(req))).toEqual(req);
    const { slots: _omit, ...plain } = req;
    expect(await decodeRequest(await encodeRequest(plain))).toEqual(plain);
  });
});

describe("response links", () => {
  /** A busy week: 15-minute fragments every working day, many preferred blocks. */
  function busyWeek(): ShareResponse {
    const available = [];
    const preferred = [];
    for (let day = 0; day < 5; day++) {
      for (let q = 0; q < 36; q += 3) {
        const start = RANGE.start + day * 24 * H + 8 * H + q * 15 * 60_000;
        available.push({ start, end: start + 30 * 60_000 });
        if (q % 6 === 0) preferred.push({ start, end: start + 15 * 60_000 });
      }
    }
    return {
      name: "Camille Durand-Okafor",
      email: "camille.durand@example.org",
      timeZone: "America/Argentina/Buenos_Aires",
      range: RANGE,
      available,
      preferred,
      title: "Interview — Backend engineer",
    };
  }

  test("round-trip", async () => {
    const res = busyWeek();
    expect(await decodeResponse(await encodeResponse(res))).toEqual(res);
  });

  test("a busy week fits in a URL under 2000 characters", async () => {
    const url = shareUrl("https://maxgfr.github.io/slotmatch/", "import", await encodeResponse(busyWeek()));
    expect(url.startsWith("https://maxgfr.github.io/slotmatch/#/import?d=")).toBe(true);
    expect(url.length).toBeLessThan(2000);
  });

  test("optional fields are omitted", async () => {
    const res: ShareResponse = { name: "A", timeZone: "UTC", range: RANGE, available: [], preferred: [] };
    expect(await decodeResponse(await encodeResponse(res))).toEqual(res);
  });
});

describe("errors are typed", () => {
  test("garbage", async () => {
    expect((await rejects(decodeResponse("not base64 at all!"))).code).toBe("malformed");
    expect((await rejects(decodeResponse("AAAA"))).code).toBe("malformed");
  });
  test("truncated link", async () => {
    const d = await encodeResponse({ name: "A", timeZone: "UTC", range: RANGE, available: [], preferred: [] });
    expect((await rejects(decodeResponse(d.slice(0, d.length - 6)))).code).toBe("malformed");
  });
  test("wrong kind", async () => {
    const d = await encodeRequest({ title: "x", range: RANGE, durationMin: 30, timeZone: "UTC" });
    expect((await rejects(decodeResponse(d))).code).toBe("kind");
  });
  test("future version", async () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ v: 99, k: "r" }));
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"));
    const packed = new Uint8Array(await new Response(stream).arrayBuffer());
    const d = btoa(String.fromCharCode(...packed)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect((await rejects(decodeResponse(d))).code).toBe("version");
  });
});

describe("zones are validated", () => {
  test("an unknown time zone in a response is rejected", async () => {
    const d = await encodeResponse({ name: "A", timeZone: "Mars/Olympus", range: RANGE, available: [], preferred: [] });
    const e = await rejects(decodeResponse(d));
    expect(e.code).toBe("malformed");
    expect(e.message).toContain("time zone");
  });
  test("an unknown time zone in a request is rejected", async () => {
    const d = await encodeRequest({ title: "x", range: RANGE, durationMin: 30, timeZone: "Not/AZone" });
    expect((await rejects(decodeRequest(d))).code).toBe("malformed");
  });
});

describe("applyResponse", () => {
  const bob: Person = {
    id: "bob",
    name: "Bob",
    kind: "member",
    tags: [],
    timeZone: "Europe/Paris",
    weekly: [{ day: 1, startMin: 540, endMin: 1020, level: "available" }],
    exceptions: [
      { id: "old-in", start: RANGE.start + 2 * H, end: RANGE.start + 3 * H, kind: "available" },
      { id: "old-out", start: RANGE.end + 2 * H, end: RANGE.end + 3 * H, kind: "available" },
      { id: "busy-in", start: RANGE.start + 5 * H, end: RANGE.start + 6 * H, kind: "busy" },
    ],
    busy: [],
    absences: [],
  };
  const answer: ShareResponse = {
    name: "Bob",
    email: "bob@example.com",
    timeZone: "America/New_York",
    range: RANGE,
    available: [{ start: RANGE.start + 9 * H, end: RANGE.start + 11 * H }],
    preferred: [{ start: RANGE.start + 9 * H, end: RANGE.start + 10 * H }],
  };

  test("keeps the person's own zone and weekly hours", () => {
    const out = applyResponse(bob, answer);
    expect(out.timeZone).toBe("Europe/Paris");
    expect(out.weekly).toEqual(bob.weekly);
    expect(out.email).toBe("bob@example.com");
  });

  test("replaces earlier answers inside the range only, keeps busy times", () => {
    const ids = applyResponse(bob, answer).exceptions.map((x) => x.id);
    expect(ids).toContain("old-out");
    expect(ids).toContain("busy-in");
    expect(ids).not.toContain("old-in");
    const kinds = applyResponse(bob, answer).exceptions.filter((x) => x.note === "From response link").map((x) => x.kind);
    expect(kinds).toEqual(["available", "preferred"]);
  });
});

describe("calendar link", () => {
  const person = (id: string, over: Partial<Person> = {}): Person => ({
    id,
    name: id,
    kind: "member",
    tags: ["team"],
    timeZone: "Europe/Paris",
    weekly: [{ day: 0, startMin: 540, endMin: 1020, level: "available" }],
    exceptions: [{ id: `${id}-x`, start: RANGE.start, end: RANGE.start + H, kind: "busy" }],
    busy: [{ start: RANGE.start, end: RANGE.start + H, title: "Private" }],
    absences: [],
    ...over,
  });
  const ana = person("Ana", {
    email: "ana@example.com",
    absences: [
      { id: "in", kind: "vacation", from: "2026-10-14", to: "2026-10-16", fromPm: true, note: "Trip" },
      { id: "out", kind: "sick", from: "2026-11-02", to: "2026-11-02" },
    ],
  });
  const ben = person("Ben");
  const cyd = person("Cyd");
  const meetings: Meeting[] = [
    { id: "m1", title: "Sync", start: RANGE.start - H, end: RANGE.start + H, attendeeIds: ["Ben", "gone"], createdAt: 5 },
    { id: "m2", title: "Later", start: RANGE.end + H, end: RANGE.end + 2 * H, attendeeIds: ["Cyd"], createdAt: 5 },
  ];
  const cal = buildCalendar([ana, ben, cyd], meetings, RANGE, "Team", "Europe/Paris");

  test("only shares absences and meetings inside the range", () => {
    expect(cal.people.map((p) => p.name)).toEqual(["Ana", "Ben"]);
    expect(cal.people[0]!.absences.map((a) => a.id)).toEqual(["in"]);
    expect(cal.meetings).toEqual([{ id: "m1", title: "Sync", start: RANGE.start - H, end: RANGE.start + H, attendees: [1] }]);
    expect(JSON.stringify(cal)).not.toContain("Private");
    expect(JSON.stringify(cal)).not.toContain("weekly");
  });

  test("round-trip", async () => {
    const d = await encodeCalendar(cal);
    expect(await decodeCalendar(d)).toEqual(cal);
    expect(shareUrl("https://x.dev/app/", "calendar-view", d)).toBe(`https://x.dev/app/#/calendar-view?d=${d}`);
  });

  test("rejects other kinds and broken content", async () => {
    const req = await encodeRequest({ title: "x", range: RANGE, durationMin: 30, timeZone: "UTC" });
    expect((await rejects(decodeCalendar(req))).code).toBe("kind");
    const badIndex: ShareCalendar = { ...cal, meetings: [{ ...cal.meetings[0]!, attendees: [7] }] };
    expect((await rejects(decodeCalendar(await encodeCalendar(badIndex)))).message).toContain("meeting");
    const badDate: ShareCalendar = { ...cal, people: [{ ...cal.people[0]!, absences: [{ id: "z", kind: "other", from: "2026-02-30", to: "2026-03-01" }] }] };
    expect((await rejects(decodeCalendar(await encodeCalendar(badDate)))).message).toContain("absence");
  });

  test("applyCalendar matches people, creates the rest, and is idempotent", () => {
    const base = { ...emptyState("UTC"), people: [person("local-ana", { name: "ANA", email: "Ana@Example.com" })] };
    const first = applyCalendar(base, cal, 42);
    expect([first.newPeople, first.absences, first.meetings]).toEqual([1, 1, 1]);
    expect(first.state.people.map((p) => p.name)).toEqual(["ANA", "Ben"]);
    expect(first.state.people[0]!.absences.map((a) => a.id)).toEqual(["in"]);
    const newBen = first.state.people[1]!;
    expect(newBen).toMatchObject({ kind: "member", weekly: [], exceptions: [], busy: [], tags: ["team"] });
    expect(first.state.meetings).toEqual([{ ...meetings[0]!, attendeeIds: [newBen.id], createdAt: 42 }]);
    const again = applyCalendar(first.state, cal, 99);
    expect([again.newPeople, again.absences, again.meetings]).toEqual([0, 0, 0]);
    expect(again.state).toEqual(first.state);
  });
});
