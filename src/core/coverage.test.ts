import { describe, expect, test } from "bun:test";
import { coverage, gaps } from "./coverage";
import type { Person, WeeklyBlock } from "./model";

const utc = (iso: string) => Date.parse(iso);
const hhmm = (ms: number) => new Date(ms).toISOString().slice(11, 16);
const RANGE = { start: utc("2026-10-12T08:00:00Z"), end: utc("2026-10-12T14:00:00Z") };

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

const team = [
  person("a", [mon(9, 12), mon(12, 13, "preferred")], ["support"]),
  person("b", [mon(10, 14)], ["support"]),
  person("c", [mon(8, 10)], ["sales"]),
];

describe("coverage", () => {
  test("counts free people per step with the preferred split", () => {
    const cov = coverage(team, RANGE, 60);
    expect(cov.cells.map((c) => `${hhmm(c.start)}:${c.count}`)).toEqual([
      "08:00:1",
      "09:00:2",
      "10:00:2",
      "11:00:2",
      "12:00:2",
      "13:00:1",
    ]);
    const noon = cov.cells[4]!;
    expect(noon.ids).toEqual(["a", "b"]);
    expect(noon.preferredIds).toEqual(["a"]);
  });

  test("a person busy for part of a step is not counted for it", () => {
    const meetings = [{ id: "m", title: "", start: utc("2026-10-12T10:30:00Z"), end: utc("2026-10-12T10:45:00Z"), attendeeIds: ["b"], createdAt: 0 }];
    const cov = coverage(team, RANGE, 60, { meetings });
    expect(cov.cells[2]!.ids).toEqual(["a"]);
  });

  test("tag filter", () => {
    const cov = coverage(team, RANGE, 60, { tag: "support" });
    expect(cov.people).toEqual(["a", "b"]);
    expect(cov.cells.map((c) => c.count)).toEqual([0, 1, 2, 2, 2, 1]);
  });

  test("a last partial step is clipped to the range", () => {
    const cov = coverage(team, { start: RANGE.start, end: RANGE.start + 90 * 60_000 }, 60);
    expect(cov.cells.map((c) => (c.end - c.start) / 60_000)).toEqual([60, 30]);
  });
});

describe("gaps", () => {
  test("merged intervals below the minimum", () => {
    const cov = coverage(team, RANGE, 30, { tag: "support" });
    expect(gaps(cov, 2).map((g) => `${hhmm(g.start)}-${hhmm(g.end)}`)).toEqual(["08:00-10:00", "13:00-14:00"]);
    expect(gaps(cov, 1).map((g) => `${hhmm(g.start)}-${hhmm(g.end)}`)).toEqual(["08:00-09:00"]);
    expect(gaps(cov, 0)).toEqual([]);
  });
  test("include limits which cells count", () => {
    const cov = coverage(team, RANGE, 30, { tag: "support" });
    const from9 = gaps(cov, 2, (c) => c.start >= utc("2026-10-12T09:00:00Z"));
    expect(from9.map((g) => `${hhmm(g.start)}-${hhmm(g.end)}`)).toEqual(["09:00-10:00", "13:00-14:00"]);
  });
});
