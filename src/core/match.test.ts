import { describe, expect, test } from "bun:test";
import { alignUp, assign, findSlots } from "./match";
import type { MatchQuery, Person, WeeklyBlock } from "./model";

const utc = (iso: string) => Date.parse(iso);
const hhmm = (ms: number) => new Date(ms).toISOString().slice(11, 16);

/** Monday 2026-10-12, all in UTC unless stated. */
const MONDAY = { start: utc("2026-10-12T00:00:00Z"), end: utc("2026-10-13T00:00:00Z") };

function mon(startH: number, endH: number, level: WeeklyBlock["level"] = "available"): WeeklyBlock {
  return { day: 0, startMin: startH * 60, endMin: endH * 60, level };
}

function person(id: string, weekly: WeeklyBlock[], tags: string[] = [], timeZone = "UTC"): Person {
  return { id, name: id, kind: "member", tags, timeZone, weekly, exceptions: [], busy: [], absences: [] };
}

function query(over: Partial<MatchQuery>): MatchQuery {
  return { range: MONDAY, durationMin: 60, stepMin: 30, requirements: [], ...over };
}

describe("assign", () => {
  test("finds the matching a greedy pass would miss", () => {
    // Requirement 0 accepts a or b, requirement 1 accepts only a.
    const picks = assign(
      [
        { kind: "anyOf", ids: ["a", "b"], count: 1 },
        { kind: "anyOf", ids: ["a"], count: 1 },
      ],
      [["a", "b"], ["a"]],
    );
    expect(picks).toEqual([["b"], ["a"]]);
  });
  test("returns null when impossible", () => {
    expect(assign([{ kind: "tag", tag: "x", count: 2 }], [["a"]])).toBeNull();
  });
});

describe("findSlots", () => {
  test("a single mandatory person", () => {
    const people = [person("alice", [mon(9, 11)])];
    const { slots } = findSlots(query({ requirements: [{ kind: "person", id: "alice" }] }), people);
    expect(slots.map((s) => hhmm(s.start))).toEqual(["09:00", "09:30", "10:00"]);
    expect(slots[0]!.attendees).toEqual(["alice"]);
  });

  test("2 out of 4", () => {
    const people = [
      person("a", [mon(9, 10)]),
      person("b", [mon(9, 12)]),
      person("c", [mon(11, 12)]),
      person("d", [mon(14, 15)]),
    ];
    const { slots } = findSlots(
      query({ requirements: [{ kind: "anyOf", ids: ["a", "b", "c", "d"], count: 2 }] }),
      people,
    );
    expect(slots.map((s) => hhmm(s.start))).toEqual(["09:00", "11:00"]);
    expect(slots[0]!.attendees.sort()).toEqual(["a", "b"]);
    expect(slots[1]!.attendees.sort()).toEqual(["b", "c"]);
  });

  test("1 engineering + 1 hr, never the same person twice, alternates listed", () => {
    const people = [
      person("eve", [mon(9, 12)], ["engineering", "hr"]),
      person("ed", [mon(10, 12)], ["engineering"]),
      person("hal", [mon(9, 12)], ["hr"]),
    ];
    const { slots } = findSlots(
      query({
        requirements: [
          { kind: "tag", tag: "engineering", count: 1 },
          { kind: "tag", tag: "hr", count: 1 },
        ],
      }),
      people,
    );
    expect(slots.map((s) => hhmm(s.start))).toEqual(["09:00", "09:30", "10:00", "10:30", "11:00"]);
    for (const s of slots) expect(new Set(s.attendees).size).toBe(2);
    const at10 = slots.find((s) => hhmm(s.start) === "10:00")!;
    expect(at10.picks[0]!.length).toBe(1);
    expect([...at10.picks[0]!, ...at10.alternates[0]!].sort()).toEqual(["ed", "eve"].filter((id) => !at10.picks[1]!.includes(id)).sort());
  });

  test("works across time zones", () => {
    // Paris 9–12 local = 07–10 UTC; New York 9–12 local = 13–16 UTC: no overlap.
    const paris = person("paris", [mon(9, 18)], [], "Europe/Paris"); // 07–16 UTC
    const ny = person("ny", [mon(9, 12)], [], "America/New_York"); // 13–16 UTC
    const { slots } = findSlots(
      query({
        requirements: [
          { kind: "person", id: "paris" },
          { kind: "person", id: "ny" },
        ],
      }),
      [paris, ny],
    );
    expect(slots.map((s) => hhmm(s.start))).toEqual(["13:00", "13:30", "14:00", "14:30", "15:00"]);
  });

  test("buffer keeps distance from booked meetings", () => {
    const people = [person("a", [mon(9, 13)])];
    const meetings = [{ id: "m", title: "", start: utc("2026-10-12T11:00:00Z"), end: utc("2026-10-12T11:30:00Z"), attendeeIds: ["a"], createdAt: 0 }];
    const q = query({ requirements: [{ kind: "person", id: "a" }], stepMin: 15 });
    const without = findSlots(q, people, { meetings }).slots.map((s) => hhmm(s.start));
    expect(without).toEqual(["09:00", "09:15", "09:30", "09:45", "10:00", "11:30", "11:45", "12:00"]);
    const withBuffer = findSlots({ ...q, bufferMin: 15 }, people, { meetings }).slots.map((s) => hhmm(s.start));
    expect(withBuffer).toEqual(["09:00", "09:15", "09:30", "09:45", "11:45", "12:00"]);
  });

  test("day window in the query time zone", () => {
    const people = [person("a", [mon(6, 20)])];
    const { slots } = findSlots(
      query({
        requirements: [{ kind: "person", id: "a" }],
        timeZone: "Europe/Paris",
        dayWindow: { startMin: 10 * 60, endMin: 12 * 60 },
      }),
      people,
    );
    // 10:00–12:00 Paris = 08:00–10:00 UTC
    expect(slots.map((s) => hhmm(s.start))).toEqual(["08:00", "08:30", "09:00"]);
  });

  test("no solution", () => {
    const people = [person("a", [mon(9, 10)]), person("b", [mon(10, 11)])];
    const r = findSlots(
      query({
        requirements: [
          { kind: "person", id: "a" },
          { kind: "person", id: "b" },
        ],
      }),
      people,
    );
    expect(r.slots).toEqual([]);
    expect(r.problems).toEqual([]);
  });

  test("impossible requirements are reported", () => {
    const r = findSlots(query({ requirements: [{ kind: "tag", tag: "legal", count: 1 }] }), [person("a", [mon(9, 10)])]);
    expect(r.slots).toEqual([]);
    expect(r.problems[0]).toContain('tag "legal"');
  });

  test("exclude and rank options", () => {
    const people = [person("a", [mon(9, 10)], ["eng"]), person("b", [mon(9, 10)], ["eng"])];
    const q = query({ requirements: [{ kind: "tag", tag: "eng", count: 1 }] });
    expect(findSlots(q, people).slots[0]!.attendees).toEqual(["a"]);
    expect(findSlots(q, people, { rank: (id) => (id === "b" ? 0 : 1) }).slots[0]!.attendees).toEqual(["b"]);
    expect(findSlots(q, people, { exclude: (id) => id === "a" }).slots[0]!.attendees).toEqual(["b"]);
  });

  test("alignUp follows the reference zone's wall clock", () => {
    // Kolkata is UTC+5:30: a 60-min step aligns on :30 UTC.
    expect(hhmm(alignUp(utc("2026-10-12T08:10:00Z"), 60, "Asia/Kolkata"))).toBe("08:30");
    expect(hhmm(alignUp(utc("2026-10-12T08:10:00Z"), 15, "UTC"))).toBe("08:15");
    expect(hhmm(alignUp(utc("2026-10-12T08:15:00Z"), 15, "UTC"))).toBe("08:15");
  });
});
