import { describe, expect, test } from "bun:test";
import type { Person } from "./model";
import {
  applyResponse,
  decodeRequest,
  decodeResponse,
  encodeRequest,
  encodeResponse,
  fromDeltas,
  ShareError,
  shareUrl,
  toDeltas,
  type ShareRequest,
  type ShareResponse,
} from "./share";

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
