import { describe, expect, test } from "bun:test";
import type { Interval, Person, WeeklyBlock } from "./model";
import { planBatch, type BatchInput } from "./planner";

const utc = (iso: string) => Date.parse(iso);
const hhmm = (ms: number) => new Date(ms).toISOString().slice(11, 16);
const MONDAY = { start: utc("2026-10-12T00:00:00Z"), end: utc("2026-10-13T00:00:00Z") };

const block = (day: number, a: number, b: number): WeeklyBlock => ({ day: day as 0, startMin: a * 60, endMin: b * 60, level: "available" });
const person = (id: string, weekly: WeeklyBlock[], tags: string[] = [], kind: Person["kind"] = "member"): Person => ({
  id,
  name: id,
  kind,
  tags,
  timeZone: "UTC",
  weekly,
  exceptions: [],
  busy: [],
});
const candidate = (id: string, weekly: WeeklyBlock[]) => person(id, weekly, ["candidate"], "external");

function input(over: Partial<BatchInput>): BatchInput {
  return {
    candidates: [],
    requirements: [{ kind: "tag", tag: "eng", count: 1 }],
    durationMin: 60,
    stepMin: 60,
    range: MONDAY,
    ...over,
  };
}

const overlapsAny = (a: Interval, b: Interval) => a.start < b.end && b.start < a.end;

describe("planBatch", () => {
  test("never double-books a panel member", () => {
    const people = [
      person("ann", [block(0, 9, 12)], ["eng"]),
      candidate("c1", [block(0, 9, 12)]),
      candidate("c2", [block(0, 9, 12)]),
      candidate("c3", [block(0, 9, 12)]),
    ];
    const r = planBatch(input({ candidates: ["c1", "c2", "c3"] }), people);
    expect(r.unplaced).toEqual([]);
    expect(r.placements).toHaveLength(3);
    expect(r.placements.map((p) => hhmm(p.slot.start))).toEqual(["09:00", "10:00", "11:00"]);
    for (const [i, a] of r.placements.entries()) {
      expect(a.panel).toEqual(["ann"]);
      for (const b of r.placements.slice(i + 1)) expect(overlapsAny(a.slot, b.slot)).toBe(false);
    }
  });

  test("respects existing meetings and the buffer", () => {
    const people = [person("ann", [block(0, 9, 12)], ["eng"]), candidate("c1", [block(0, 9, 12)])];
    const meetings = [{ id: "m", title: "", start: utc("2026-10-12T09:00:00Z"), end: utc("2026-10-12T10:00:00Z"), attendeeIds: ["ann"], createdAt: 0 }];
    const r = planBatch(input({ candidates: ["c1"], bufferMin: 15, stepMin: 15 }), people, meetings);
    expect(hhmm(r.placements[0]!.slot.start)).toBe("10:15");
  });

  test("daily cap per interviewer", () => {
    const people = [
      person("ann", [block(0, 9, 17)], ["eng"]),
      candidate("c1", [block(0, 9, 17)]),
      candidate("c2", [block(0, 9, 17)]),
      candidate("c3", [block(0, 9, 17)]),
    ];
    const r = planBatch(input({ candidates: ["c1", "c2", "c3"], maxPerInterviewerPerDay: 2 }), people);
    expect(r.placements).toHaveLength(2);
    expect(r.unplaced).toHaveLength(1);
    expect(r.unplaced[0]!.reason).toContain("daily cap");
    expect(r.stats.complete).toBe(false);
  });

  test("the cap counts per day, so a second day helps", () => {
    const people = [
      person("ann", [block(0, 9, 17), block(1, 9, 17)], ["eng"]),
      candidate("c1", [block(0, 9, 17), block(1, 9, 17)]),
      candidate("c2", [block(0, 9, 17), block(1, 9, 17)]),
    ];
    const r = planBatch(
      input({ candidates: ["c1", "c2"], maxPerInterviewerPerDay: 1, range: { start: MONDAY.start, end: MONDAY.end + 86_400_000 } }),
      people,
    );
    expect(r.unplaced).toEqual([]);
    const days = r.placements.map((p) => new Date(p.slot.start).getUTCDate());
    expect(new Set(days).size).toBe(2);
  });

  test("backtracking succeeds where the greedy pass fails", () => {
    // c1 can only meet at 9 (with ann or bob); c2 only at 10, where only ann is free.
    // Each interviewer may do one interview a day. Greedy gives c1 to ann and strands c2.
    const people = [
      person("ann", [block(0, 9, 11)], ["eng"]),
      person("bob", [block(0, 9, 10)], ["eng"]),
      candidate("c1", [block(0, 9, 10)]),
      candidate("c2", [block(0, 10, 11)]),
    ];
    const base = input({ candidates: ["c1", "c2"], maxPerInterviewerPerDay: 1 });

    const greedy = planBatch({ ...base, budget: 0 }, people);
    expect(greedy.placements.map((p) => p.candidateId)).toEqual(["c1"]);
    expect(greedy.unplaced.map((u) => u.candidateId)).toEqual(["c2"]);

    const r = planBatch(base, people);
    expect(r.stats.complete).toBe(true);
    expect(r.stats.backtracks).toBeGreaterThan(0);
    const byCandidate = Object.fromEntries(r.placements.map((p) => [p.candidateId, p.panel]));
    expect(byCandidate).toEqual({ c1: ["bob"], c2: ["ann"] });
  });

  test("a candidate with no common time is reported with a reason", () => {
    const people = [person("ann", [block(0, 9, 10)], ["eng"]), candidate("c1", [block(0, 14, 15)]), candidate("c2", [block(0, 9, 10)])];
    const r = planBatch(input({ candidates: ["c1", "c2"] }), people);
    expect(r.placements.map((p) => p.candidateId)).toEqual(["c2"]);
    expect(r.unplaced).toEqual([{ candidateId: "c1", reason: "No time where the candidate and a full panel are free together." }]);
  });

  test("multi-requirement panels", () => {
    const people = [
      person("ann", [block(0, 9, 12)], ["eng"]),
      person("hal", [block(0, 9, 12)], ["hr"]),
      candidate("c1", [block(0, 9, 12)]),
      candidate("c2", [block(0, 9, 12)]),
    ];
    const r = planBatch(
      input({
        candidates: ["c1", "c2"],
        requirements: [
          { kind: "tag", tag: "eng", count: 1 },
          { kind: "tag", tag: "hr", count: 1 },
        ],
      }),
      people,
    );
    expect(r.placements).toHaveLength(2);
    for (const p of r.placements) expect(p.panel.sort()).toEqual(["ann", "hal"]);
    expect(overlapsAny(r.placements[0]!.slot, r.placements[1]!.slot)).toBe(false);
  });
});
