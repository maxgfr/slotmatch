import type { Interval } from "./model";

/**
 * Operations on lists of half-open intervals. Every function that takes a
 * list expects it normalized (sorted, disjoint, non-adjacent) unless stated,
 * and every function that returns a list returns it normalized.
 */

/** Sort, drop empty intervals, merge overlapping and adjacent ones. Accepts any input. */
export function normalize(list: readonly Interval[]): Interval[] {
  const sorted = list
    .filter((iv) => iv.end > iv.start)
    .map((iv) => ({ start: iv.start, end: iv.end }))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const out: Interval[] = [];
  for (const iv of sorted) {
    const last = out[out.length - 1];
    if (last && iv.start <= last.end) {
      if (iv.end > last.end) last.end = iv.end;
    } else {
      out.push(iv);
    }
  }
  return out;
}

export function union(a: readonly Interval[], b: readonly Interval[]): Interval[] {
  return normalize([...a, ...b]);
}

export function intersect(a: readonly Interval[], b: readonly Interval[]): Interval[] {
  const out: Interval[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const x = a[i]!;
    const y = b[j]!;
    const start = Math.max(x.start, y.start);
    const end = Math.min(x.end, y.end);
    if (end > start) out.push({ start, end });
    if (x.end < y.end) i++;
    else j++;
  }
  return out;
}

export function subtract(a: readonly Interval[], b: readonly Interval[]): Interval[] {
  const out: Interval[] = [];
  let j = 0;
  for (const x of a) {
    let cursor = x.start;
    while (j < b.length && b[j]!.end <= cursor) j++;
    let k = j;
    while (k < b.length && b[k]!.start < x.end) {
      const y = b[k]!;
      if (y.start > cursor) out.push({ start: cursor, end: y.start });
      cursor = Math.max(cursor, y.end);
      if (cursor >= x.end) break;
      k++;
    }
    if (cursor < x.end) out.push({ start: cursor, end: x.end });
  }
  return out;
}

export function clip(list: readonly Interval[], range: Interval): Interval[] {
  return intersect(list, range.end > range.start ? [range] : []);
}

/** Index of the last interval whose start is <= t, or -1. */
function lastStartingAtOrBefore(list: readonly Interval[], t: number): number {
  let lo = 0;
  let hi = list.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid]!.start <= t) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/** True when `iv` lies entirely inside one interval of `list`. */
export function contains(list: readonly Interval[], iv: Interval): boolean {
  const i = lastStartingAtOrBefore(list, iv.start);
  return i >= 0 && list[i]!.end >= iv.end;
}

/** True when `iv` shares any instant with `list`. */
export function overlaps(list: readonly Interval[], iv: Interval): boolean {
  if (iv.end <= iv.start) return false;
  const i = lastStartingAtOrBefore(list, iv.end - 1);
  return i >= 0 && list[i]!.end > iv.start;
}

export function totalDuration(list: readonly Interval[]): number {
  let sum = 0;
  for (const iv of list) sum += iv.end - iv.start;
  return sum;
}

/** Length of the part of `iv` covered by `list`. */
export function coveredDuration(list: readonly Interval[], iv: Interval): number {
  return totalDuration(clip(list, iv));
}
