import { describe, expect, test } from "bun:test";
import { findSlots } from "./match";
import type { Meeting, Person, WeeklyBlock } from "./model";
import { DEFAULT_WEIGHTS, rankSlots, rebalance, weeklyLoad, type ScoreWeights } from "./score";

const utc = (iso: string) => Date.parse(iso);
const hhmm = (ms: number) => new Date(ms).toISOString().slice(11, 16);
const RANGE = { start: utc("2026-10-12T00:00:00Z"), end: utc("2026-10-13T00:00:00Z") };

const mon = (a: number, b: number, level: WeeklyBlock["level"] = "available"): WeeklyBlock => ({
  day: 0,
  startMin: a * 60,
  endMin: b * 60,
  level,
});
const person = (id: string, weekly: WeeklyBlock[], tags: string[] = []): Person => ({
  id,
  name: id,
  kind: "member",
  tags,
  timeZone: "UTC",
  weekly,
  exceptions: [],
  busy: [],
});
const meeting = (id: string, iso: string, attendeeIds: string[]): Meeting => ({
  id,
  title: id,
  start: utc(iso),
  end: utc(iso) + 3_600_000,
  attendeeIds,
  createdAt: 0,
});
const only = (k: keyof ScoreWeights): ScoreWeights => ({ preferred: 0, timeOfDay: 0, fairness: 0, earliness: 0, [k]: 1 });

function run(people: Person[], meetings: Meeting[] = [], requirements = [{ kind: "person" as const, id: "a" }]) {
  return findSlots({ range: RANGE, durationMin: 60, stepMin: 60, requirements }, people, { meetings });
}

describe("rankSlots", () => {
  test("preferred time wins and the breakdown explains it", () => {
    const people = [person("a", [mon(9, 12), mon(14, 16, "preferred")])];
    const r = run(people);
    const ranked = rankSlots(r.slots, { expanded: r.expanded, meetings: [], range: RANGE, timeZone: "UTC" }, only("preferred"));
    expect(hhmm(ranked[0]!.start)).toBe("14:00");
    expect(ranked[0]!.breakdown.preferred).toBe(1);
    expect(ranked[0]!.score).toBe(1);
    expect(ranked.at(-1)!.breakdown.preferred).toBe(0);
  });

  test("part of day", () => {
    const people = [person("a", [mon(9, 17)])];
    const r = run(people);
    const ctx = { expanded: r.expanded, meetings: [], range: RANGE, timeZone: "UTC" };
    const morning = rankSlots(r.slots, { ...ctx, partOfDay: "morning" }, { ...only("timeOfDay"), earliness: 0.01 });
    expect(hhmm(morning[0]!.start)).toBe("09:00");
    const afternoon = rankSlots(r.slots, { ...ctx, partOfDay: "afternoon" }, only("timeOfDay"));
    expect(afternoon[0]!.breakdown.timeOfDay).toBe(1);
    expect(utc("2026-10-12T12:00:00Z")).toBeLessThanOrEqual(afternoon[0]!.start);
  });

  test("earliness prefers sooner slots", () => {
    const r = run([person("a", [mon(9, 17)])]);
    const ranked = rankSlots(r.slots, { expanded: r.expanded, meetings: [], range: RANGE, timeZone: "UTC" }, only("earliness"));
    expect(ranked.map((s) => hhmm(s.start))).toEqual(["09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00"]);
  });

  test("fairness swaps in the less loaded interviewer and penalizes busy ones", () => {
    const people = [person("a", [mon(9, 12)], ["eng"]), person("b", [mon(9, 12)], ["eng"])];
    // a already has two meetings this week (Tuesday), b none.
    const meetings = [meeting("m1", "2026-10-13T09:00:00Z", ["a"]), meeting("m2", "2026-10-13T10:00:00Z", ["a"])];
    const r = run(people, meetings, [{ kind: "tag", tag: "eng", count: 1 }] as never);
    expect(r.slots[0]!.attendees).toEqual(["a"]);
    const ranked = rankSlots(r.slots, { expanded: r.expanded, meetings, range: RANGE, timeZone: "UTC" }, DEFAULT_WEIGHTS);
    expect(ranked.every((s) => s.attendees[0] === "b")).toBe(true);
    expect(ranked[0]!.alternates[0]).toEqual(["a"]);
    expect(ranked[0]!.breakdown.fairness).toBe(1);
  });

  test("fixed people are left out of fairness", () => {
    const people = [person("a", [mon(9, 12)])];
    const meetings = [meeting("m1", "2026-10-13T09:00:00Z", ["a"])];
    const r = run(people, meetings);
    const ctx = { expanded: r.expanded, meetings, range: RANGE, timeZone: "UTC" };
    expect(rankSlots(r.slots, ctx)[0]!.breakdown.fairness).toBe(0.5);
    expect(rankSlots(r.slots, { ...ctx, fixed: new Set(["a"]) })[0]!.breakdown.fairness).toBe(1);
  });

  test("overlapping slots are deduplicated and the list is capped", () => {
    const r = findSlots(
      { range: RANGE, durationMin: 60, stepMin: 15, requirements: [{ kind: "person", id: "a" }] },
      [person("a", [mon(9, 17)])],
    );
    const ctx = { expanded: r.expanded, meetings: [], range: RANGE, timeZone: "UTC" };
    const ranked = rankSlots(r.slots, ctx, only("earliness"));
    expect(ranked.map((s) => hhmm(s.start))).toEqual(["09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00"]);
    expect(rankSlots(r.slots, ctx, only("earliness"), { limit: 3 })).toHaveLength(3);
    expect(rankSlots(r.slots, ctx, only("earliness"), { dedupe: false, limit: 100 })).toHaveLength(r.slots.length);
  });
});

describe("helpers", () => {
  test("weeklyLoad counts per local week", () => {
    const meetings = [
      meeting("m1", "2026-10-12T09:00:00Z", ["a"]),
      meeting("m2", "2026-10-18T21:30:00Z", ["a"]), // Sunday 23:30 Paris: same week
      meeting("m3", "2026-10-18T22:30:00Z", ["a"]), // Monday 00:30 Paris: next week
    ];
    const load = weeklyLoad(meetings, "Europe/Paris");
    expect(load("a", utc("2026-10-14T12:00:00Z"))).toBe(2);
    expect(load("a", utc("2026-10-20T12:00:00Z"))).toBe(1);
    expect(load("b", utc("2026-10-14T12:00:00Z"))).toBe(0);
  });

  test("rebalance never assigns the same person twice", () => {
    const slot = { start: 0, end: 1, attendees: ["a", "b"], picks: [["a"], ["b"]], alternates: [["c"], ["c"]] };
    const out = rebalance(slot, (id) => ({ a: 5, b: 5, c: 0 })[id] ?? 0);
    expect(out.attendees).toEqual(["c", "b"]);
    expect(out.alternates).toEqual([["a"], []]);
  });
});
