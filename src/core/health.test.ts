import { describe, expect, test } from "bun:test";
import { selfTest } from "./health";
import { demoState, emptyState } from "./store";

const NOW = Date.parse("2026-10-22T10:00:00Z");

describe("selfTest", () => {
  test("demo data passes every check", async () => {
    const checks = await selfTest(demoState(NOW), NOW);
    expect(checks.map((c) => c.label)).toEqual([
      "Stored data is valid",
      "JSON backup round-trips",
      "Availability expands",
      "Share links round-trip",
      ".ics export reads back",
    ]);
    expect(checks.filter((c) => !c.ok)).toEqual([]);
    expect(checks[0]!.detail).toBe("8 people, 0 meetings, 2 absences.");
    expect(checks[4]!.detail).toBe("0 meetings and 2 absences in one file.");
  });

  test("an empty browser passes too", async () => {
    const checks = await selfTest(emptyState("UTC"), NOW);
    expect(checks.every((c) => c.ok)).toBe(true);
    expect(checks[4]!.detail).toBe("Nothing to export yet.");
  });

  test("data that would not survive a reload is reported", async () => {
    const state = demoState(NOW);
    state.people[0]!.timeZone = "Mars/Olympus";
    const [stored] = await selfTest(state, NOW);
    expect(stored).toMatchObject({ ok: false, detail: "Some people would change when read back." });
  });
});
