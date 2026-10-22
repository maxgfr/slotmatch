import { describe, expect, test } from "bun:test";
import { findSlots } from "./match";
import {
  demoState,
  emptyState,
  exportJson,
  ImportError,
  importJson,
  load,
  migrate,
  preserveUnreadable,
  save,
  STORAGE_KEY,
  UNREADABLE_KEY,
  type AppState,
} from "./store";

class MemoryStorage {
  data = new Map<string, string>();
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
}

const NOW = Date.parse("2026-10-12T10:00:00Z");

describe("load / save", () => {
  test("round-trip through storage", () => {
    const storage = new MemoryStorage();
    const state = demoState(NOW);
    expect(save(state, storage)).toBe(true);
    expect(storage.data.has(STORAGE_KEY)).toBe(true);
    expect(load(storage)).toEqual(state);
  });

  test("missing, corrupt or foreign data gives an empty state", () => {
    expect(load(new MemoryStorage(), "Europe/Paris")).toEqual(emptyState("Europe/Paris"));
    for (const bad of ["{not json", "null", "[]", '{"version":99,"people":[]}', '{"people":"nope"}']) {
      const s = new MemoryStorage();
      s.setItem(STORAGE_KEY, bad);
      expect(load(s)).toEqual(emptyState());
    }
  });

  test("a throwing storage does not crash", () => {
    const broken = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("quota");
      },
    };
    expect(load(broken)).toEqual(emptyState());
    expect(save(emptyState(), broken)).toBe(false);
  });
});

describe("preserveUnreadable", () => {
  test("copies unreadable data aside before it can be overwritten", () => {
    for (const bad of ['{"version":2,"people":[{"id":"x","name":"From the future"}]}', "{broken json"]) {
      const s = new MemoryStorage();
      s.setItem(STORAGE_KEY, bad);
      expect(preserveUnreadable(s)).toBe(true);
      save(load(s), s);
      expect(s.getItem(UNREADABLE_KEY)).toBe(bad);
    }
  });
  test("leaves readable or missing data alone", () => {
    const s = new MemoryStorage();
    expect(preserveUnreadable(s)).toBe(false);
    save(demoState(NOW), s);
    expect(preserveUnreadable(s)).toBe(false);
    expect(s.getItem(UNREADABLE_KEY)).toBeNull();
  });
});

describe("migrate", () => {
  test("upgrades a v0 shape and sanitizes entries", () => {
    const v0 = {
      people: [
        { id: "a", name: "A", tags: ["x", "x", 3], timeZone: "Not/AZone", weekly: [{ day: 0, startMin: 540, endMin: 600 }, { day: 9, startMin: 0, endMin: 1 }] },
        { id: "a", name: "duplicate" },
        { name: "no id" },
      ],
      meetings: [{ id: "m", start: 1, end: 2, attendeeIds: ["a", 5] }, { id: "bad", start: 5, end: 1 }],
    };
    const s = migrate(v0, "Europe/Paris")!;
    expect(s.version).toBe(1);
    expect(s.settings.timeZone).toBe("Europe/Paris");
    expect(s.people).toEqual([
      { id: "a", name: "A", kind: "member", tags: ["x"], timeZone: "UTC", weekly: [{ day: 0, startMin: 540, endMin: 600, level: "available" }], exceptions: [], busy: [], absences: [] },
    ]);
    expect(s.meetings).toEqual([{ id: "m", title: "", start: 1, end: 2, attendeeIds: ["a"], createdAt: 0 }]);
  });
  test("keeps valid absences and drops broken ones", () => {
    const s = migrate({
      version: 1,
      people: [
        {
          id: "a",
          name: "A",
          absences: [
            { id: "ok", kind: "sick", from: "2026-10-12", to: "2026-10-13", toAm: true, fromPm: "yes" },
            { kind: "nope", from: "2026-10-20", to: "2026-10-20" },
            { id: "reversed", from: "2026-10-13", to: "2026-10-12" },
            { id: "impossible", from: "2026-02-30", to: "2026-03-01" },
            { id: "both-halves", from: "2026-10-12", to: "2026-10-12", fromPm: true, toAm: true },
          ],
        },
      ],
    })!;
    const [ok, other, ...rest] = s.people[0]!.absences;
    expect(ok).toEqual({ id: "ok", kind: "sick", from: "2026-10-12", to: "2026-10-13", toAm: true });
    expect(other).toMatchObject({ kind: "other", from: "2026-10-20" });
    expect(rest).toEqual([]);
  });
  test("rejects non-slotmatch data", () => {
    expect(migrate(42)).toBeNull();
    expect(migrate({ version: 2, people: [] })).toBeNull();
  });
});

describe("JSON backup", () => {
  const base: AppState = { ...emptyState("Asia/Tokyo"), people: demoState(NOW).people.slice(0, 2) };

  test("replace", () => {
    const backup = exportJson(demoState(NOW));
    const out = importJson(base, backup, "replace");
    expect(out.people).toHaveLength(8);
    expect(out.settings.timeZone).toBe("Asia/Tokyo");
  });

  test("merge upserts by id", () => {
    const changed = { ...base.people[0]!, name: "Alice M." };
    const extra = { ...base.people[1]!, id: "new" };
    const out = importJson(base, JSON.stringify({ version: 1, people: [changed, extra], meetings: [] }), "merge");
    expect(out.people.map((p) => p.name)).toEqual(["Alice M.", "Bruno Costa", "Bruno Costa"]);
    expect(out.people.map((p) => p.id)).toEqual(["demo-alice", "demo-bruno", "new"]);
  });

  test("invalid files throw ImportError", () => {
    expect(() => importJson(base, "nope", "merge")).toThrow(ImportError);
    expect(() => importJson(base, '{"hello":1}', "merge")).toThrow(ImportError);
  });
});

describe("demo", () => {
  test("six members and two candidates", () => {
    const s = demoState(NOW);
    expect(s.people.filter((p) => p.kind === "member")).toHaveLength(6);
    expect(s.people.filter((p) => p.kind === "external" && p.tags.includes("candidate"))).toHaveLength(2);
  });
  test("each candidate can meet one engineer and one HR person within the coming week", () => {
    const s = demoState(NOW);
    const range = { start: NOW, end: NOW + 7 * 86_400_000 };
    for (const id of ["demo-gabriel", "demo-hana"]) {
      const r = findSlots(
        {
          range,
          durationMin: 45,
          requirements: [
            { kind: "person", id },
            { kind: "tag", tag: "engineering", count: 1 },
            { kind: "tag", tag: "hr", count: 1 },
          ],
        },
        s.people,
      );
      expect(r.slots.length).toBeGreaterThan(0);
    }
  });
});
