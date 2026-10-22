import { absenceInterval, expandPerson } from "./expand";
import { exportIcs, parseIcs } from "./ics";
import { DAY, MINUTE, type Interval, type Ms } from "./model";
import { buildCalendar, decodeCalendar, decodeRequest, encodeCalendar, encodeRequest } from "./share";
import { exportJson, importJson, migrate, type AppState } from "./store";

export interface Check {
  label: string;
  ok: boolean;
  detail: string;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

async function check(label: string, fn: () => string | Promise<string>): Promise<Check> {
  try {
    return { label, ok: true, detail: await fn() };
  } catch (e) {
    return { label, ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

function fail(message: string): never {
  throw new Error(message);
}

/**
 * Run the user's own data through every path that reads or writes it: storage,
 * backup, availability, share links and .ics export. Nothing is changed.
 */
export async function selfTest(state: AppState, now: Ms): Promise<Check[]> {
  const absences = state.people.reduce((n, p) => n + p.absences.length, 0);
  // Links store whole minutes.
  const start = Math.floor(now / MINUTE) * MINUTE;
  const week: Interval = { start, end: start + 7 * DAY };
  const quarter: Interval = { start, end: start + 92 * DAY };

  return Promise.all([
    check("Stored data is valid", () => {
      const reread = migrate(JSON.parse(JSON.stringify(state)));
      if (!reread) fail("The stored data is not recognised.");
      if (!same(reread.people, state.people)) fail("Some people would change when read back.");
      if (!same(reread.meetings, state.meetings)) fail("Some meetings would change when read back.");
      return `${plural(state.people.length, "person", "people")}, ${plural(state.meetings.length, "meeting")}, ${plural(absences, "absence")}.`;
    }),
    check("JSON backup round-trips", () => {
      const text = exportJson(state);
      const back = importJson(state, text, "replace");
      if (!same(back.people, state.people) || !same(back.meetings, state.meetings)) fail("A backup would not restore the same data.");
      return `${(new TextEncoder().encode(text).length / 1024).toFixed(1)} KB backup.`;
    }),
    check("Availability expands", () => {
      let free = 0;
      for (const p of state.people) {
        try {
          if (expandPerson(p, week, { meetings: state.meetings }).available.length) free++;
        } catch {
          fail(`${p.name}'s availability could not be computed.`);
        }
      }
      return `${free} of ${plural(state.people.length, "person", "people")} free at some point in the next 7 days.`;
    }),
    check("Share links round-trip", async () => {
      const request = { title: "Self-test", range: week, durationMin: 30, timeZone: state.settings.timeZone };
      if (!same(await decodeRequest(await encodeRequest(request)), request)) fail("A request link would not read back the same.");
      const cal = buildCalendar(state.people, state.meetings, quarter, "Self-test", state.settings.timeZone);
      const data = await encodeCalendar(cal);
      if (!same(await decodeCalendar(data), cal)) fail("A calendar link would not read back the same.");
      return `Calendar link for the next 3 months: ${data.length.toLocaleString("en")} characters.`;
    }),
    check(".ics export reads back", () => {
      const spans: Interval[] = [...state.meetings, ...state.people.flatMap((p) => p.absences.map((a) => absenceInterval(a, p.timeZone)))];
      if (!spans.length) return "Nothing to export yet.";
      const range = { start: Math.min(...spans.map((s) => s.start)) - DAY, end: Math.max(...spans.map((s) => s.end)) + DAY };
      const { events } = parseIcs(exportIcs(state.meetings, state.people, { absences: true }), { range, defaultTimeZone: "UTC" });
      if (events.length !== spans.length) fail(`${spans.length} events exported but ${events.length} read back.`);
      return `${plural(state.meetings.length, "meeting")} and ${plural(absences, "absence")} in one file.`;
    }),
  ]);
}
