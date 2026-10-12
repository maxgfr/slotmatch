import { describe, expect, test } from "bun:test";
import { expandPerson, localDays, localParts, startOfLocalWeek, zonedTime } from "./expand";
import { HOUR, type Person } from "./model";

const utc = (iso: string) => Date.parse(iso);
const iso = (ms: number) => new Date(ms).toISOString();

function person(over: Partial<Person> = {}): Person {
  return {
    id: "p",
    name: "P",
    kind: "member",
    tags: [],
    timeZone: "Europe/Paris",
    weekly: [],
    exceptions: [],
    busy: [],
    ...over,
  };
}

describe("tz helpers", () => {
  test("localParts uses Monday = 0", () => {
    // 2026-10-12 is a Monday.
    expect(localParts(utc("2026-10-12T10:00:00Z"), "Europe/Paris")).toMatchObject({
      year: 2026,
      month: 9,
      day: 12,
      weekday: 0,
      minutes: 12 * 60,
    });
  });
  test("zonedTime handles minute 1440 as next midnight", () => {
    expect(iso(zonedTime(2026, 9, 12, 1440, "UTC"))).toBe("2026-10-13T00:00:00.000Z");
  });
  test("startOfLocalWeek", () => {
    expect(iso(startOfLocalWeek(utc("2026-10-15T12:00:00Z"), "Europe/Paris"))).toBe(
      "2026-10-11T22:00:00.000Z",
    );
  });
  test("localDays across the October DST change has a 25h day", () => {
    const days = localDays({ start: utc("2026-10-24T22:00:00Z"), end: utc("2026-10-27T00:00:00Z") }, "Europe/Paris");
    expect(days.map(iso)).toEqual([
      "2026-10-24T22:00:00.000Z",
      "2026-10-25T23:00:00.000Z",
      "2026-10-26T23:00:00.000Z",
    ]);
  });
});

describe("expandPerson", () => {
  test("weekly block keeps local wall time across the March DST change", () => {
    // Every day 09:00–17:00 Paris. DST starts on Sunday 2026-03-29.
    const p = person({
      weekly: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day: day as 0, startMin: 540, endMin: 1020, level: "available" as const })),
    });
    const { available } = expandPerson(p, { start: utc("2026-03-28T00:00:00Z"), end: utc("2026-03-30T00:00:00Z") });
    expect(available.map((i) => [iso(i.start), iso(i.end)])).toEqual([
      ["2026-03-28T08:00:00.000Z", "2026-03-28T16:00:00.000Z"], // UTC+1
      ["2026-03-29T07:00:00.000Z", "2026-03-29T15:00:00.000Z"], // UTC+2
    ]);
  });

  test("block that spans the October fall-back hour lasts one hour longer", () => {
    // Sunday 2026-10-25, 00:00–06:00 local: clocks go 03:00 → 02:00.
    const p = person({ weekly: [{ day: 6, startMin: 0, endMin: 360, level: "available" }] });
    const { available } = expandPerson(p, { start: utc("2026-10-24T00:00:00Z"), end: utc("2026-10-26T00:00:00Z") });
    expect(available).toHaveLength(1);
    expect(iso(available[0]!.start)).toBe("2026-10-24T22:00:00.000Z");
    expect(iso(available[0]!.end)).toBe("2026-10-25T05:00:00.000Z");
    expect(available[0]!.end - available[0]!.start).toBe(7 * HOUR);
  });

  test("two people in different zones", () => {
    const monday = { day: 0 as const, startMin: 540, endMin: 1020, level: "available" as const };
    const range = { start: utc("2026-10-12T00:00:00Z"), end: utc("2026-10-13T12:00:00Z") };
    const paris = expandPerson(person({ weekly: [monday] }), range);
    const ny = expandPerson(person({ timeZone: "America/New_York", weekly: [monday] }), range);
    expect(iso(paris.available[0]!.start)).toBe("2026-10-12T07:00:00.000Z");
    expect(iso(ny.available[0]!.start)).toBe("2026-10-12T13:00:00.000Z");
    expect(iso(ny.available[0]!.end)).toBe("2026-10-12T21:00:00.000Z");
  });

  test("exceptions, imported busy, meetings with buffer; preferred stays inside available", () => {
    const p = person({
      timeZone: "UTC",
      weekly: [
        { day: 0, startMin: 540, endMin: 720, level: "available" },
        { day: 0, startMin: 720, endMin: 1020, level: "preferred" },
      ],
      exceptions: [
        { id: "x1", start: utc("2026-10-12T18:00:00Z"), end: utc("2026-10-12T19:00:00Z"), kind: "available" },
        { id: "x2", start: utc("2026-10-12T13:00:00Z"), end: utc("2026-10-12T14:00:00Z"), kind: "busy" },
      ],
      busy: [{ start: utc("2026-10-12T10:00:00Z"), end: utc("2026-10-12T10:30:00Z") }],
    });
    const meeting = {
      id: "m",
      title: "M",
      start: utc("2026-10-12T15:00:00Z"),
      end: utc("2026-10-12T15:30:00Z"),
      attendeeIds: ["p"],
      createdAt: 0,
    };
    const other = { ...meeting, id: "m2", start: utc("2026-10-12T09:00:00Z"), attendeeIds: ["q"] };
    const r = expandPerson(p, { start: utc("2026-10-12T00:00:00Z"), end: utc("2026-10-13T00:00:00Z") }, {
      meetings: [meeting, other],
      bufferMin: 15,
    });
    const show = (l: { start: number; end: number }[]) => l.map((i) => `${iso(i.start).slice(11, 16)}-${iso(i.end).slice(11, 16)}`);
    expect(show(r.busy)).toEqual(["09:45-10:45", "13:00-14:00", "14:45-15:45"]);
    expect(show(r.available)).toEqual(["09:00-09:45", "10:45-13:00", "14:00-14:45", "15:45-17:00", "18:00-19:00"]);
    expect(show(r.preferred)).toEqual(["12:00-13:00", "14:00-14:45", "15:45-17:00"]);
  });

  test("result is clipped to the range", () => {
    const p = person({ timeZone: "UTC", weekly: [{ day: 0, startMin: 540, endMin: 1020, level: "available" }] });
    const r = expandPerson(p, { start: utc("2026-10-12T12:00:00Z"), end: utc("2026-10-12T13:00:00Z") });
    expect(r.available).toEqual([{ start: utc("2026-10-12T12:00:00Z"), end: utc("2026-10-12T13:00:00Z") }]);
  });
});
