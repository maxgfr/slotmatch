import { localParts, startOfLocalWeek } from "./expand";
import { coveredDuration } from "./intervals";
import { type Expanded, type Interval, type Meeting, type Ms, type Slot } from "./model";

export type PartOfDay = "any" | "morning" | "afternoon";

export interface ScoreWeights {
  /** Share of the slot inside each attendee's preferred time. */
  preferred: number;
  /** Match with the requested part of the day. */
  timeOfDay: number;
  /** Spread meetings across interviewers who have fewer this week. */
  fairness: number;
  /** Sooner is better. */
  earliness: number;
}

export const DEFAULT_WEIGHTS: ScoreWeights = { preferred: 3, timeOfDay: 1, fairness: 2, earliness: 1 };

export interface ScoreContext {
  expanded: ReadonlyMap<string, Expanded>;
  meetings: readonly Meeting[];
  range: Interval;
  /** Zone used for "morning/afternoon" and for the week boundary of the fairness count. */
  timeZone: string;
  partOfDay?: PartOfDay;
  /** People who are not interchangeable (e.g. the candidate): left out of fairness. */
  fixed?: ReadonlySet<string>;
}

export type Breakdown = Record<keyof ScoreWeights, number>;

export interface RankedSlot extends Slot {
  /** 0–1, weighted mean of `breakdown`. */
  score: number;
  /** Each criterion in 0–1. */
  breakdown: Breakdown;
}

export interface RankOptions {
  /** Keep at most this many slots. Defaults to 10. */
  limit?: number;
  /** Drop slots overlapping a better one. Defaults to true. */
  dedupe?: boolean;
}

/** Counts meetings per person in the local week of a given instant. */
export function weeklyLoad(meetings: readonly Meeting[], timeZone: string) {
  let weeks: Ms[] | undefined;
  const cache = new Map<string, number>();
  return (personId: string, at: Ms): number => {
    weeks ??= meetings.map((m) => startOfLocalWeek(m.start, timeZone));
    const week = startOfLocalWeek(at, timeZone);
    const key = `${personId}@${week}`;
    let n = cache.get(key);
    if (n === undefined) {
      n = meetings.filter((m, i) => weeks![i] === week && m.attendeeIds.includes(personId)).length;
      cache.set(key, n);
    }
    return n;
  };
}

/**
 * Swap each assigned person for a less loaded alternate of the same
 * requirement. Alternates are free and eligible, so the slot stays valid.
 */
export function rebalance(slot: Slot, load: (personId: string) => number): Slot {
  const picks = slot.picks.map((p) => [...p]);
  const taken = new Set(slot.attendees);
  picks.forEach((group, i) => {
    group.forEach((pid, k) => {
      let best = pid;
      for (const alt of slot.alternates[i]!) {
        if (!taken.has(alt) && load(alt) < load(best)) best = alt;
      }
      if (best !== pid) {
        taken.delete(pid);
        taken.add(best);
        group[k] = best;
      }
    });
  });
  const attendees = picks.flat();
  // Alternates are everyone eligible and free who ended up unassigned.
  const alternates = slot.alternates.map((alts, i) => {
    const pool = [...alts, ...slot.picks[i]!];
    return [...new Set(pool)].filter((id) => !taken.has(id));
  });
  return { ...slot, picks, attendees, alternates };
}

function timeOfDayScore(slot: Slot, timeZone: string, part: PartOfDay): number {
  if (part === "any") return 1;
  const start = localParts(slot.start, timeZone).minutes;
  const len = (slot.end - slot.start) / 60_000;
  const end = start + len;
  const noon = 12 * 60;
  const before = Math.max(0, Math.min(end, noon) - start);
  const fraction = before / len;
  return part === "morning" ? fraction : 1 - fraction;
}

export function scoreSlot(slot: Slot, ctx: ScoreContext, weights: ScoreWeights, load: (id: string, at: Ms) => number): RankedSlot {
  const len = slot.end - slot.start;
  const pref =
    slot.attendees.length === 0
      ? 0
      : slot.attendees.reduce((sum, id) => {
          const e = ctx.expanded.get(id);
          return sum + (e ? coveredDuration(e.preferred, slot) / len : 0);
        }, 0) / slot.attendees.length;

  const pool = slot.attendees.filter((id) => !ctx.fixed?.has(id));
  const avgLoad = pool.length ? pool.reduce((s, id) => s + load(id, slot.start), 0) / pool.length : 0;

  const span = ctx.range.end - ctx.range.start - len;
  const breakdown: Breakdown = {
    preferred: pref,
    timeOfDay: timeOfDayScore(slot, ctx.timeZone, ctx.partOfDay ?? "any"),
    fairness: 1 / (1 + avgLoad),
    earliness: span > 0 ? 1 - Math.min(1, Math.max(0, (slot.start - ctx.range.start) / span)) : 1,
  };
  const keys = Object.keys(weights) as (keyof ScoreWeights)[];
  const total = keys.reduce((s, k) => s + Math.max(0, weights[k]), 0);
  const score = total > 0 ? keys.reduce((s, k) => s + Math.max(0, weights[k]) * breakdown[k], 0) / total : 0;
  return { ...slot, score, breakdown };
}

/** Rebalance, score, sort (best first, then earliest), drop overlapping duplicates, keep the top N. */
export function rankSlots(
  slots: readonly Slot[],
  ctx: ScoreContext,
  weights: ScoreWeights = DEFAULT_WEIGHTS,
  opts: RankOptions = {},
): RankedSlot[] {
  const load = weeklyLoad(ctx.meetings, ctx.timeZone);
  const scored = slots
    .map((s) => rebalance(s, (id) => load(id, s.start)))
    .map((s) => scoreSlot(s, ctx, weights, load))
    .sort((a, b) => b.score - a.score || a.start - b.start);
  const limit = opts.limit ?? 10;
  const out: RankedSlot[] = [];
  for (const s of scored) {
    if (out.length >= limit) break;
    if ((opts.dedupe ?? true) && out.some((t) => t.start < s.end && s.start < t.end)) continue;
    out.push(s);
  }
  return out;
}
