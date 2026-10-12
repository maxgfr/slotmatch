import { tzOffset } from "@date-fns/tz";
import { expandPerson, localParts } from "./expand";
import { contains, overlaps } from "./intervals";
import { MINUTE, type Expanded, type Meeting, type MatchQuery, type Ms, type Person, type Requirement, type Slot } from "./model";

export interface MatchOptions {
  meetings?: readonly Meeting[];
  /** Return true to make a person unavailable for a given slot (caps, manual exclusions…). */
  exclude?: (personId: string, slotStart: Ms) => boolean;
  /** Lower ranks are tried first when several people could fill a requirement. */
  rank?: (personId: string) => number;
  /** Stop after this many slots. */
  limit?: number;
}

export interface MatchResult {
  slots: Slot[];
  /** Expanded availability of every person involved, over the padded range. */
  expanded: Map<string, Expanded>;
  /** Human-readable reasons when the query cannot be satisfied at all. */
  problems: string[];
}

/** People who could fill a requirement, ignoring time. */
export function eligible(req: Requirement, people: readonly Person[]): string[] {
  switch (req.kind) {
    case "person":
      return people.some((p) => p.id === req.id) ? [req.id] : [];
    case "anyOf": {
      const known = new Set(people.map((p) => p.id));
      return [...new Set(req.ids)].filter((id) => known.has(id));
    }
    case "tag":
      return people.filter((p) => p.tags.includes(req.tag)).map((p) => p.id);
  }
}

export function requiredCount(req: Requirement): number {
  return req.kind === "person" ? 1 : Math.max(1, Math.floor(req.count));
}

/** First slot start at or after `t` aligned on `stepMin` in `timeZone`'s wall clock. */
export function alignUp(t: Ms, stepMin: number, timeZone: string): Ms {
  const step = stepMin * MINUTE;
  const offset = tzOffset(timeZone, new Date(t)) * MINUTE;
  const local = t + offset;
  return Math.ceil(local / step) * step - offset;
}

/**
 * Assign people to requirement seats with augmenting paths (bipartite
 * matching), so a person never fills two requirements and a solution is found
 * whenever one exists. Returns picks per requirement, or null.
 */
export function assign(
  requirements: readonly Requirement[],
  candidates: readonly (readonly string[])[],
): string[][] | null {
  // Seats: one per required person. Person requirements first, then by slack.
  const order = requirements
    .map((r, i) => ({ i, slack: candidates[i]!.length - requiredCount(r), person: r.kind === "person" }))
    .sort((a, b) => Number(b.person) - Number(a.person) || a.slack - b.slack || a.i - b.i);
  const seats: number[] = [];
  for (const { i, slack } of order) {
    if (slack < 0) return null;
    for (let k = 0; k < requiredCount(requirements[i]!); k++) seats.push(i);
  }
  const seatOf = new Map<string, number>(); // person -> seat index
  const holder: (string | undefined)[] = new Array(seats.length);

  const tryAssign = (seat: number, seen: Set<string>): boolean => {
    for (const pid of candidates[seats[seat]!]!) {
      if (seen.has(pid)) continue;
      seen.add(pid);
      const current = seatOf.get(pid);
      if (current === undefined || tryAssign(current, seen)) {
        seatOf.set(pid, seat);
        holder[seat] = pid;
        return true;
      }
    }
    return false;
  };

  for (let s = 0; s < seats.length; s++) {
    if (!tryAssign(s, new Set())) return null;
  }
  const picks: string[][] = requirements.map(() => []);
  seats.forEach((req, s) => picks[req]!.push(holder[s]!));
  return picks;
}

/**
 * Scan start times every `stepMin` and return each slot where every requirement
 * is met. A person counts as free when the slot lies inside their available
 * time and no busy period comes within `bufferMin` of it.
 */
export function findSlots(query: MatchQuery, people: readonly Person[], opts: MatchOptions = {}): MatchResult {
  const step = Math.max(1, query.stepMin ?? 15);
  const duration = query.durationMin * MINUTE;
  const buffer = (query.bufferMin ?? 0) * MINUTE;
  const tz = query.timeZone ?? "UTC";
  const problems: string[] = [];

  const pools = query.requirements.map((r) => eligible(r, people));
  query.requirements.forEach((r, i) => {
    const pool = pools[i]!;
    if (pool.length < requiredCount(r)) {
      const what = r.kind === "person" ? `person ${r.id}` : r.kind === "tag" ? `tag "${r.tag}"` : "the chosen group";
      problems.push(`Requirement ${i + 1}: not enough people for ${what} (${pool.length}/${requiredCount(r)}).`);
    }
  });
  const personReqIds = query.requirements.flatMap((r) => (r.kind === "person" ? [r.id] : []));
  if (new Set(personReqIds).size !== personReqIds.length) problems.push("The same person is required twice.");
  if (query.requirements.length === 0) problems.push("Add at least one requirement.");
  if (duration <= 0) problems.push("Duration must be positive.");

  const padded = { start: query.range.start - buffer, end: query.range.end + buffer };
  const expanded = new Map<string, Expanded>();
  const byId = new Map(people.map((p) => [p.id, p]));
  for (const id of new Set(pools.flat())) {
    expanded.set(id, expandPerson(byId.get(id)!, padded, { meetings: opts.meetings }));
  }
  if (problems.length) return { slots: [], expanded, problems };

  const rank = opts.rank;
  const sortedPools = rank ? pools.map((p) => [...p].sort((a, b) => rank(a) - rank(b))) : pools;

  const slots: Slot[] = [];
  for (let s = alignUp(query.range.start, step, tz); s + duration <= query.range.end; s += step * MINUTE) {
    const slot = { start: s, end: s + duration };
    if (query.dayWindow) {
      const startLocal = localParts(s, tz).minutes;
      if (startLocal < query.dayWindow.startMin || startLocal + query.durationMin > query.dayWindow.endMin) continue;
    }
    const guard = { start: s - buffer, end: s + duration + buffer };
    const freeCache = new Map<string, boolean>();
    const isFree = (id: string) => {
      let free = freeCache.get(id);
      if (free === undefined) {
        const e = expanded.get(id)!;
        free = contains(e.available, slot) && !overlaps(e.busy, guard) && !(opts.exclude?.(id, s) ?? false);
        freeCache.set(id, free);
      }
      return free;
    };
    const candidates = sortedPools.map((pool) => pool.filter(isFree));
    const picks = assign(query.requirements, candidates);
    if (!picks) continue;
    const attendees = picks.flat();
    const taken = new Set(attendees);
    slots.push({
      ...slot,
      attendees,
      picks,
      alternates: candidates.map((c) => c.filter((id) => !taken.has(id))),
    });
    if (opts.limit && slots.length >= opts.limit) break;
  }
  return { slots, expanded, problems };
}
