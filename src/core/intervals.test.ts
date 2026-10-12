import { describe, expect, test } from "bun:test";
import {
  clip,
  contains,
  coveredDuration,
  intersect,
  normalize,
  overlaps,
  subtract,
  totalDuration,
  union,
} from "./intervals";

const iv = (start: number, end: number) => ({ start, end });

describe("normalize", () => {
  test("sorts, merges overlaps and adjacency, drops empties", () => {
    expect(normalize([iv(5, 7), iv(1, 3), iv(3, 4), iv(2, 2), iv(6, 9), iv(8, 6)])).toEqual([
      iv(1, 4),
      iv(5, 9),
    ]);
  });
  test("does not mutate input", () => {
    const input = [iv(3, 5), iv(1, 4)];
    normalize(input);
    expect(input).toEqual([iv(3, 5), iv(1, 4)]);
  });
  test("empty", () => expect(normalize([])).toEqual([]));
});

describe("union", () => {
  test("merges two lists", () => {
    expect(union([iv(0, 2), iv(10, 12)], [iv(1, 5), iv(12, 13)])).toEqual([iv(0, 5), iv(10, 13)]);
  });
});

describe("intersect", () => {
  test("keeps common parts", () => {
    expect(intersect([iv(0, 5), iv(8, 12)], [iv(3, 9), iv(11, 20)])).toEqual([
      iv(3, 5),
      iv(8, 9),
      iv(11, 12),
    ]);
  });
  test("touching intervals do not intersect", () => {
    expect(intersect([iv(0, 5)], [iv(5, 10)])).toEqual([]);
  });
  test("with empty", () => expect(intersect([iv(0, 5)], [])).toEqual([]));
});

describe("subtract", () => {
  test("punches holes", () => {
    expect(subtract([iv(0, 10)], [iv(2, 3), iv(5, 7)])).toEqual([iv(0, 2), iv(3, 5), iv(7, 10)]);
  });
  test("removal spanning several intervals", () => {
    expect(subtract([iv(0, 4), iv(6, 10), iv(12, 14)], [iv(3, 13)])).toEqual([
      iv(0, 3),
      iv(13, 14),
    ]);
  });
  test("full removal and no-op", () => {
    expect(subtract([iv(2, 4)], [iv(0, 10)])).toEqual([]);
    expect(subtract([iv(2, 4)], [iv(4, 10)])).toEqual([iv(2, 4)]);
  });
  test("a removal that outlasts one interval still applies to the next", () => {
    expect(subtract([iv(0, 5), iv(6, 10)], [iv(4, 8)])).toEqual([iv(0, 4), iv(8, 10)]);
  });
});

describe("clip / contains / overlaps / durations", () => {
  const list = [iv(0, 10), iv(20, 30)];
  test("clip", () => expect(clip(list, iv(5, 25))).toEqual([iv(5, 10), iv(20, 25)]));
  test("contains", () => {
    expect(contains(list, iv(20, 30))).toBe(true);
    expect(contains(list, iv(2, 8))).toBe(true);
    expect(contains(list, iv(8, 22))).toBe(false);
    expect(contains(list, iv(10, 12))).toBe(false);
    expect(contains([], iv(0, 1))).toBe(false);
  });
  test("overlaps is half-open", () => {
    expect(overlaps(list, iv(10, 20))).toBe(false);
    expect(overlaps(list, iv(9, 20))).toBe(true);
    expect(overlaps(list, iv(15, 21))).toBe(true);
    expect(overlaps(list, iv(31, 40))).toBe(false);
    expect(overlaps(list, iv(25, 25))).toBe(false);
  });
  test("durations", () => {
    expect(totalDuration(list)).toBe(20);
    expect(coveredDuration(list, iv(5, 25))).toBe(10);
  });
});
