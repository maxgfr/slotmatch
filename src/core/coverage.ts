import { expandPerson } from "./expand";
import { contains, normalize } from "./intervals";
import { MINUTE, type Interval, type Meeting, type Person } from "./model";

export interface CoverageCell extends Interval {
  /** People available for the whole step (preferred included). */
  ids: string[];
  /** Subset of `ids` who prefer this time. */
  preferredIds: string[];
  count: number;
}

export interface Coverage {
  range: Interval;
  stepMin: number;
  /** People considered after filtering. */
  people: string[];
  cells: CoverageCell[];
}

export interface CoverageOptions {
  meetings?: readonly Meeting[];
  /** Only count people carrying this tag. */
  tag?: string;
}

/** Number of free people for each `stepMin` step of `range`. */
export function coverage(
  people: readonly Person[],
  range: Interval,
  stepMin: number,
  opts: CoverageOptions = {},
): Coverage {
  const pool = opts.tag ? people.filter((p) => p.tags.includes(opts.tag!)) : [...people];
  const expanded = pool.map((p) => ({ id: p.id, e: expandPerson(p, range, { meetings: opts.meetings }) }));
  const step = Math.max(1, stepMin) * MINUTE;
  const cells: CoverageCell[] = [];
  for (let start = range.start; start < range.end; start += step) {
    const cell = { start, end: Math.min(start + step, range.end) };
    const ids: string[] = [];
    const preferredIds: string[] = [];
    for (const { id, e } of expanded) {
      if (!contains(e.available, cell)) continue;
      ids.push(id);
      if (contains(e.preferred, cell)) preferredIds.push(id);
    }
    cells.push({ ...cell, ids, preferredIds, count: ids.length });
  }
  return { range, stepMin, people: pool.map((p) => p.id), cells };
}

/**
 * Intervals where fewer than `minStaff` people are free. `include` limits the
 * check to some cells (e.g. working hours) — excluded cells never count as gaps.
 */
export function gaps(cov: Coverage, minStaff: number, include?: (cell: CoverageCell) => boolean): Interval[] {
  return normalize(
    cov.cells
      .filter((c) => c.count < minStaff && (include?.(c) ?? true))
      .map((c) => ({ start: c.start, end: c.end })),
  );
}
