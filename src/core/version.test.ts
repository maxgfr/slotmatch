import { describe, expect, test } from "bun:test";
import { compareBuilds, parseBuildInfo } from "./version";

const running = { version: "0.1.0", commit: "b97ddbc37aab59001ba002a61f5dc3f4cfcb8c1c", builtAt: "2026-10-22T13:00:00.000Z" };

describe("parseBuildInfo", () => {
  test("accepts a version.json", () => {
    expect(parseBuildInfo(JSON.parse(JSON.stringify(running)))).toEqual(running);
    expect(parseBuildInfo({ ...running, commit: "unknown" })?.commit).toBe("unknown");
  });
  test("rejects anything else", () => {
    for (const bad of [null, "x", [], { ...running, commit: "<script>" }, { ...running, builtAt: "yesterday" }, { version: 1 }]) {
      expect(parseBuildInfo(bad)).toBeNull();
    }
  });
});

describe("compareBuilds", () => {
  test("same commit is current", () => {
    expect(compareBuilds(running, { ...running }).state).toBe("current");
  });
  test("a newer commit online is an update", () => {
    const online = { ...running, commit: "a1b2c3d", builtAt: "2026-10-23T09:00:00.000Z" };
    expect(compareBuilds(running, online)).toEqual({ state: "available", online });
  });
  test("an older build online is not offered", () => {
    expect(compareBuilds(running, { ...running, commit: "a1b2c3d", builtAt: "2026-10-01T00:00:00.000Z" }).state).toBe("current");
  });
  test("the dev server has nothing to compare", () => {
    expect(compareBuilds(null, running)).toEqual({ state: "dev" });
  });
});
