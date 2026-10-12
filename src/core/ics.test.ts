import { describe, expect, test } from "bun:test";
import { exportIcs, foldLine, parseIcs } from "./ics";
import type { Meeting, Person } from "./model";

const utc = (iso: string) => Date.parse(iso);
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 16);
const show = (r: { events: { start: number; end: number; title?: string }[] }) =>
  r.events.map((e) => `${iso(e.start)} ${iso(e.end)} ${e.title ?? ""}`.trim());

/** Minimal Google Calendar export (structure and property order as Google writes them). */
const GOOGLE = [
  "BEGIN:VCALENDAR",
  "PRODID:-//Google Inc//Google Calendar 70.9054//EN",
  "VERSION:2.0",
  "CALSCALE:GREGORIAN",
  "METHOD:PUBLISH",
  "X-WR-CALNAME:alice@example.com",
  "X-WR-TIMEZONE:Europe/Paris",
  "BEGIN:VTIMEZONE",
  "TZID:Europe/Paris",
  "X-LIC-LOCATION:Europe/Paris",
  "BEGIN:DAYLIGHT",
  "TZOFFSETFROM:+0100",
  "TZOFFSETTO:+0200",
  "TZNAME:CEST",
  "DTSTART:19700329T020000",
  "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
  "END:DAYLIGHT",
  "BEGIN:STANDARD",
  "TZOFFSETFROM:+0200",
  "TZOFFSETTO:+0100",
  "TZNAME:CET",
  "DTSTART:19701025T030000",
  "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
  "END:STANDARD",
  "END:VTIMEZONE",
  // Weekly stand-up Mon/Wed 09:30–10:00 Paris, 6 times, Wednesday 21 Oct skipped. Crosses the Oct 25 DST change.
  "BEGIN:VEVENT",
  "DTSTART;TZID=Europe/Paris:20261012T093000",
  "DTEND;TZID=Europe/Paris:20261012T100000",
  "RRULE:FREQ=WEEKLY;WKST=MO;COUNT=6;BYDAY=MO,WE",
  "EXDATE;TZID=Europe/Paris:20261021T093000",
  "DTSTAMP:20261001T080000Z",
  "UID:standup@google.com",
  "CREATED:20261001T080000Z",
  "DESCRIPTION:Daily sync. This description is long enough that Google folds it",
  "  onto a second line.",
  "LAST-MODIFIED:20261001T080000Z",
  "SEQUENCE:0",
  "STATUS:CONFIRMED",
  "SUMMARY:Stand-up",
  "TRANSP:OPAQUE",
  "BEGIN:VALARM",
  "ACTION:DISPLAY",
  "DESCRIPTION:This is an event reminder",
  "TRIGGER:-P0DT0H10M0S",
  "END:VALARM",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "DTSTART:20261013T140000Z",
  "DTEND:20261013T150000Z",
  "UID:utc@google.com",
  "SUMMARY:Customer call\\, EMEA",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "DTSTART;VALUE=DATE:20261016",
  "DTEND;VALUE=DATE:20261017",
  "UID:allday@google.com",
  "SUMMARY:Off-site",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "DTSTART:20261014T120000Z",
  "DTEND:20261014T130000Z",
  "UID:free@google.com",
  "SUMMARY:Lunch (shown as free)",
  "TRANSP:TRANSPARENT",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "DTSTART:20261015T120000Z",
  "DTEND:20261015T130000Z",
  "UID:cancelled@google.com",
  "SUMMARY:Cancelled",
  "STATUS:CANCELLED",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

/** Minimal Outlook export: Windows zone names, quoted TZID, DURATION, an overridden occurrence. */
const OUTLOOK = [
  "BEGIN:VCALENDAR",
  "METHOD:PUBLISH",
  "PRODID:Microsoft Exchange Server 2010",
  "VERSION:2.0",
  "X-WR-CALNAME:Calendar",
  "BEGIN:VTIMEZONE",
  "TZID:Romance Standard Time",
  "BEGIN:STANDARD",
  "DTSTART:16010101T030000",
  "TZOFFSETFROM:+0200",
  "TZOFFSETTO:+0100",
  "RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=-1SU;BYMONTH=10",
  "END:STANDARD",
  "BEGIN:DAYLIGHT",
  "DTSTART:16010101T020000",
  "TZOFFSETFROM:+0100",
  "TZOFFSETTO:+0200",
  "RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=-1SU;BYMONTH=3",
  "END:DAYLIGHT",
  "END:VTIMEZONE",
  // Every other Tuesday 14:00–15:00 Paris until Nov 24; Oct 27 moved to 16:00.
  "BEGIN:VEVENT",
  "DESCRIPTION:\\n",
  'RRULE:FREQ=WEEKLY;UNTIL=20261124T130000Z;INTERVAL=2;BYDAY=TU;WKST=MO',
  "UID:040000008200E00074C5B7101A82E00800000000B0D1@outlook",
  "SUMMARY;LANGUAGE=en-US:1:1 review",
  'DTSTART;TZID="Romance Standard Time":20261013T140000',
  'DTEND;TZID="Romance Standard Time":20261013T150000',
  "CLASS:PUBLIC",
  "PRIORITY:5",
  "DTSTAMP:20261001T080000Z",
  "TRANSP:OPAQUE",
  "STATUS:CONFIRMED",
  "SEQUENCE:0",
  "X-MICROSOFT-CDO-BUSYSTATUS:BUSY",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:040000008200E00074C5B7101A82E00800000000B0D1@outlook",
  'RECURRENCE-ID;TZID="Romance Standard Time":20261027T140000',
  "SUMMARY;LANGUAGE=en-US:1:1 review (moved)",
  'DTSTART;TZID="Romance Standard Time":20261027T160000',
  "DURATION:PT45M",
  "DTSTAMP:20261001T080000Z",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:daily@outlook",
  "SUMMARY:Focus",
  'DTSTART;TZID="Pacific Standard Time":20261012T080000',
  "DURATION:PT1H",
  "RRULE:FREQ=DAILY;INTERVAL=1;COUNT=3",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

const OCTOBER = { start: utc("2026-10-01T00:00:00Z"), end: utc("2026-12-01T00:00:00Z") };

describe("parseIcs — Google export", () => {
  const r = parseIcs(GOOGLE, { range: OCTOBER, defaultTimeZone: "Europe/Paris" });
  test("expands RRULE with COUNT, BYDAY, EXDATE across DST; skips free and cancelled", () => {
    expect(show(r)).toEqual([
      "2026-10-12T07:30 2026-10-12T08:00 Stand-up",
      "2026-10-13T14:00 2026-10-13T15:00 Customer call, EMEA",
      "2026-10-14T07:30 2026-10-14T08:00 Stand-up",
      "2026-10-15T22:00 2026-10-16T22:00 Off-site", // all-day, default zone
      "2026-10-19T07:30 2026-10-19T08:00 Stand-up",
      // 2026-10-21 excluded, but still counts towards COUNT
      "2026-10-26T08:30 2026-10-26T09:00 Stand-up", // after DST: 09:30 Paris = 08:30 UTC
      "2026-10-28T08:30 2026-10-28T09:00 Stand-up",
    ]);
    expect(r.warnings).toEqual([]);
  });
  test("range filtering", () => {
    const narrow = parseIcs(GOOGLE, { range: { start: utc("2026-10-13T00:00:00Z"), end: utc("2026-10-14T00:00:00Z") }, defaultTimeZone: "UTC" });
    expect(show(narrow)).toEqual(["2026-10-13T14:00 2026-10-13T15:00 Customer call, EMEA"]);
  });
});

describe("parseIcs — Outlook export", () => {
  const r = parseIcs(OUTLOOK, { range: OCTOBER, defaultTimeZone: "UTC" });
  test("Windows zone names, INTERVAL, UNTIL, DURATION and RECURRENCE-ID overrides", () => {
    expect(show(r)).toEqual([
      "2026-10-12T15:00 2026-10-12T16:00 Focus", // Pacific 08:00 = 15:00 UTC (PDT)
      "2026-10-13T12:00 2026-10-13T13:00 1:1 review",
      "2026-10-13T15:00 2026-10-13T16:00 Focus",
      "2026-10-14T15:00 2026-10-14T16:00 Focus",
      "2026-10-27T15:00 2026-10-27T15:45 1:1 review (moved)", // 16:00 Paris (CET)
      "2026-11-10T13:00 2026-11-10T14:00 1:1 review",
      "2026-11-24T13:00 2026-11-24T14:00 1:1 review", // UNTIL is inclusive
    ]);
    expect(r.warnings).toEqual([]);
  });
});

describe("parseIcs — edge cases", () => {
  test("unsupported FREQ imports the first occurrence with a warning", () => {
    const text = "BEGIN:VCALENDAR\nBEGIN:VEVENT\nDTSTART:20261012T090000Z\nDTEND:20261012T100000Z\nRRULE:FREQ=MONTHLY\nSUMMARY:Board\nEND:VEVENT\nEND:VCALENDAR";
    const r = parseIcs(text, { range: OCTOBER, defaultTimeZone: "UTC" });
    expect(show(r)).toEqual(["2026-10-12T09:00 2026-10-12T10:00 Board"]);
    expect(r.warnings[0]).toContain("MONTHLY");
  });
  test("unknown TZID falls back to the default zone with a warning", () => {
    const text = "BEGIN:VEVENT\nDTSTART;TZID=Mars/Olympus:20261012T090000\nDTEND;TZID=Mars/Olympus:20261012T100000\nEND:VEVENT";
    const r = parseIcs(text, { range: OCTOBER, defaultTimeZone: "Europe/Paris" });
    expect(show(r)).toEqual(["2026-10-12T07:00 2026-10-12T08:00"]);
    expect(r.warnings).toHaveLength(1);
  });
  test("garbage input yields nothing", () => {
    expect(parseIcs("hello\nworld", { range: OCTOBER, defaultTimeZone: "UTC" }).events).toEqual([]);
  });
});

describe("exportIcs", () => {
  const people: Person[] = [
    { id: "a", name: "Zoë Lefèvre-Dupont", email: "zoe@example.com", kind: "member", tags: [], timeZone: "Europe/Paris", weekly: [], exceptions: [], busy: [] },
    { id: "b", name: "Sam, candidate", kind: "external", tags: [], timeZone: "UTC", weekly: [], exceptions: [], busy: [] },
  ];
  const meetings: Meeting[] = [
    {
      id: "m1",
      title: "Interview; round 1 — a long title that will certainly need folding because it is far beyond seventy-five octets",
      start: utc("2026-10-12T09:00:00Z"),
      end: utc("2026-10-12T10:00:00Z"),
      attendeeIds: ["a", "b"],
      createdAt: 0,
    },
  ];
  const text = exportIcs(meetings, people, { now: utc("2026-10-01T00:00:00Z") });

  test("structure, CRLF, escaping, attendees", () => {
    expect(text.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
    expect(text.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(text).toContain("UID:m1@slotmatch\r\n");
    expect(text).toContain("DTSTAMP:20261001T000000Z\r\n");
    expect(text).toContain("DTSTART:20261012T090000Z\r\n");
    expect(text.replace(/\r\n /g, "")).toContain('ATTENDEE;CN="Zoë Lefèvre-Dupont";ROLE=REQ-PARTICIPANT:mailto:zoe@example.com\r\n');
    expect(text).not.toContain("mailto:undefined");
    expect(text.replace(/\r\n /g, "")).toContain("SUMMARY:Interview\\; round 1");
    expect(text.replace(/\r\n /g, "")).toContain("DESCRIPTION:Participants: Zoë Lefèvre-Dupont\\, Sam\\, candidate");
  });

  test("every line is at most 75 octets", () => {
    for (const line of text.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
  });

  test("round-trips through the parser", () => {
    const r = parseIcs(text, { range: OCTOBER, defaultTimeZone: "UTC" });
    expect(r.events).toEqual([{ start: meetings[0]!.start, end: meetings[0]!.end, title: meetings[0]!.title }]);
  });

  test("foldLine never splits a multi-byte character", () => {
    const folded = foldLine("X".repeat(74) + "é" + "é".repeat(60));
    const lines = folded.split("\r\n");
    expect(lines[0]).toBe("X".repeat(74));
    for (const l of lines) expect(new TextEncoder().encode(l).length).toBeLessThanOrEqual(75);
    expect(lines.map((l, i) => (i ? l.slice(1) : l)).join("")).toBe("X".repeat(74) + "é".repeat(61));
  });
});
