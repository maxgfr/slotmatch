import { describe, expect, test } from "bun:test";
import {
  absenceLength,
  absencePart,
  absencesBetween,
  absentNow,
  addDays,
  calendarMonth,
  dateOf,
  isDate,
  validAbsence,
  weekdayOf,
} from "./calendar";
import { absenceInterval } from "./expand";
import type { Absence, Meeting, Person } from "./model";

const utc = (iso: string) => Date.parse(iso);
const iso = (ms: number) => new Date(ms).toISOString();

function person(id: string, absences: Absence[], timeZone = "Europe/Paris"): Person {
  return { id, name: id, kind: "member", tags: [], timeZone, weekly: [], exceptions: [], busy: [], absences };
}

const absence = (from: string, to: string, over: Partial<Absence> = {}): Absence => ({ id: `${from}-${to}`, kind: "vacation", from, to, ...over });

describe("dates", () => {
  test("isDate rejects impossible dates", () => {
    expect(isDate("2026-02-28")).toBe(true);
    expect(isDate("2028-02-29")).toBe(true);
    expect(isDate("2026-02-29")).toBe(false);
    expect(isDate("2026-13-01")).toBe(false);
    expect(isDate("2026-1-01")).toBe(false);
    expect(isDate(20261001)).toBe(false);
  });
  test("addDays crosses month and year ends", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
  test("weekdayOf uses Monday = 0", () => {
    expect(weekdayOf("2026-10-12")).toBe(0);
    expect(weekdayOf("2026-10-18")).toBe(6);
  });
  test("dateOf follows the zone", () => {
    expect(dateOf(utc("2026-10-12T23:30:00Z"), "UTC")).toBe("2026-10-12");
    expect(dateOf(utc("2026-10-12T23:30:00Z"), "Europe/Paris")).toBe("2026-10-13");
  });
});

describe("absences", () => {
  test("validAbsence", () => {
    expect(validAbsence(absence("2026-10-12", "2026-10-16"))).toBe(true);
    expect(validAbsence(absence("2026-10-16", "2026-10-12"))).toBe(false);
    expect(validAbsence(absence("2026-10-12", "2026-10-12", { fromPm: true }))).toBe(true);
    expect(validAbsence(absence("2026-10-12", "2026-10-12", { fromPm: true, toAm: true }))).toBe(false);
    expect(validAbsence(absence("2026-10-12", "2026-10-13", { fromPm: true, toAm: true }))).toBe(true);
    expect(validAbsence(absence("2026-02-30", "2026-03-02"))).toBe(false);
  });
  test("interval spans whole local days across the DST change", () => {
    // Europe/Paris leaves summer time on 2026-10-25.
    const iv = absenceInterval(absence("2026-10-24", "2026-10-26"), "Europe/Paris");
    expect(iso(iv.start)).toBe("2026-10-23T22:00:00.000Z");
    expect(iso(iv.end)).toBe("2026-10-26T23:00:00.000Z");
  });
  test("half days start or end at local noon", () => {
    const iv = absenceInterval(absence("2026-10-12", "2026-10-14", { fromPm: true, toAm: true }), "America/New_York");
    expect(iso(iv.start)).toBe("2026-10-12T16:00:00.000Z");
    expect(iso(iv.end)).toBe("2026-10-14T16:00:00.000Z");
  });
  test("absencePart and absenceLength", () => {
    const a = absence("2026-10-12", "2026-10-14", { fromPm: true, toAm: true });
    expect(["2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15"].map((d) => absencePart(a, d))).toEqual([null, "pm", "full", "am", null]);
    expect(absenceLength(a)).toBe(2);
    expect(absenceLength(absence("2026-10-12", "2026-10-12"))).toBe(1);
  });
  test("absentNow respects half days", () => {
    const p = person("p", [absence("2026-10-12", "2026-10-12", { fromPm: true })], "UTC");
    expect(absentNow(p, utc("2026-10-12T11:00:00Z"))).toBeUndefined();
    expect(absentNow(p, utc("2026-10-12T13:00:00Z"))?.from).toBe("2026-10-12");
  });
  test("absencesBetween keeps overlaps, sorted", () => {
    const a = person("a", [absence("2026-10-28", "2026-11-03"), absence("2026-12-01", "2026-12-02")]);
    const b = person("b", [absence("2026-11-10", "2026-11-10")]);
    expect(absencesBetween([b, a], "2026-11-01", "2026-11-30").map((x) => `${x.person.id} ${x.absence.from}`)).toEqual([
      "a 2026-10-28",
      "b 2026-11-10",
    ]);
  });
});

describe("calendarMonth", () => {
  test("whole weeks around the month", () => {
    // November 2026 starts on a Sunday and ends on a Monday.
    const days = calendarMonth([], [], 2026, 10, "UTC");
    expect(days[0]!.date).toBe("2026-10-26");
    expect(days.at(-1)!.date).toBe("2026-12-06");
    expect(days.length % 7).toBe(0);
    expect(days.filter((d) => d.inMonth).length).toBe(30);
  });
  test("places absences on their dates and meetings on their display date", () => {
    const p = person("p", [absence("2026-10-30", "2026-11-02", { toAm: true })]);
    const m: Meeting = { id: "m", title: "Late call", start: utc("2026-11-04T23:30:00Z"), end: utc("2026-11-05T00:00:00Z"), attendeeIds: ["p"], createdAt: 0 };
    const days = calendarMonth([p], [m], 2026, 10, "Europe/Paris");
    const at = (date: string) => days.find((d) => d.date === date)!;
    expect(at("2026-10-30").absences.map((a) => a.part)).toEqual(["full"]);
    expect(at("2026-11-02").absences.map((a) => a.part)).toEqual(["am"]);
    expect(at("2026-11-03").absences).toEqual([]);
    expect(at("2026-11-04").meetings).toEqual([]);
    expect(at("2026-11-05").meetings.map((x) => x.id)).toEqual(["m"]);
  });
});
