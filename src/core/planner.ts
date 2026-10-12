import { localParts } from "./expand";
import { findSlots } from "./match";
import type { DayWindow, Interval, Meeting, Ms, Person, Requirement } from "./model";
import { DEFAULT_WEIGHTS, rankSlots, weeklyLoad, type PartOfDay, type RankedSlot, type ScoreWeights } from "./score";

export interface BatchInput {
  /** People to place, one meeting each. */
  candidates: string[];
  /** Panel rules, applied to every candidate's meeting. */
  requirements: Requirement[];
  durationMin: number;
  range: Interval;
  /** Max meetings per panel member per local day (existing bookings included). */
  maxPerInterviewerPerDay?: number;
  stepMin?: number;
  bufferMin?: number;
  dayWindow?: DayWindow;
  timeZone?: string;
  partOfDay?: PartOfDay;
  weights?: ScoreWeights;
  /** Search nodes before giving up on a complete plan. Defaults to 400. */
  budget?: number;
}

export interface Placement {
  candidateId: string;
  /** Includes the candidate as first attendee. */
  slot: RankedSlot;
  /** Panel members (attendees without the candidate). */
  panel: string[];
}

export interface Unplaced {
  candidateId: string;
  reason: string;
}

export interface BatchResult {
  placements: Placement[];
  unplaced: Unplaced[];
  stats: { nodes: number; backtracks: number; complete: boolean };
}

/** Options tried per candidate: best slots, then panel variants of each. */
const SLOTS_PER_CANDIDATE = 6;
const VARIANTS_PER_SLOT = 3;

function variants(slot: RankedSlot): RankedSlot[] {
  const out: RankedSlot[] = [];
  slot.picks.forEach((group, i) => {
    group.forEach((pid, k) => {
      for (const alt of slot.alternates[i]!) {
        if (out.length >= VARIANTS_PER_SLOT) return;
        const picks = slot.picks.map((g, j) => (j === i ? g.map((x, m) => (m === k ? alt : x)) : g));
        const attendees = picks.flat();
        const alternates = slot.alternates.map((a, j) => (j === i ? [...a.filter((x) => x !== alt), pid] : a.filter((x) => x !== alt)));
        out.push({ ...slot, picks, attendees, alternates });
      }
    });
  });
  return out;
}

/**
 * Give each candidate one slot with a full panel, without double-booking
 * anyone and within the daily cap. Most constrained candidate first (fewest
 * valid slots), best-ranked option first, bounded backtracking on dead ends.
 */
export function planBatch(input: BatchInput, people: readonly Person[], meetings: readonly Meeting[] = []): BatchResult {
  const tz = input.timeZone ?? "UTC";
  const candidateSet = new Set(input.candidates);
  const cap = input.maxPerInterviewerPerDay;
  const weights = input.weights ?? DEFAULT_WEIGHTS;
  const budget = input.budget ?? 400;
  const dayKey = (t: Ms) => {
    const p = localParts(t, tz);
    return `${p.year}-${p.month}-${p.day}`;
  };

  interface Options {
    count: number;
    options: RankedSlot[];
    problems: string[];
  }

  const optionsFor = (cid: string, tentative: readonly Meeting[]): Options => {
    const all = [...meetings, ...tentative];
    const load = weeklyLoad(all, tz);
    const exclude =
      cap === undefined
        ? undefined
        : (pid: string, start: Ms) => {
            if (candidateSet.has(pid)) return false;
            const day = dayKey(start);
            return all.filter((m) => m.attendeeIds.includes(pid) && dayKey(m.start) === day).length >= cap;
          };
    const res = findSlots(
      {
        range: input.range,
        durationMin: input.durationMin,
        stepMin: input.stepMin,
        bufferMin: input.bufferMin,
        dayWindow: input.dayWindow,
        timeZone: tz,
        requirements: [{ kind: "person", id: cid }, ...input.requirements],
      },
      people,
      { meetings: all, exclude, rank: (id) => load(id, input.range.start) },
    );
    const ranked = rankSlots(
      res.slots,
      { expanded: res.expanded, meetings: all, range: input.range, timeZone: tz, partOfDay: input.partOfDay, fixed: candidateSet },
      weights,
      { limit: SLOTS_PER_CANDIDATE },
    );
    return { count: res.slots.length, options: ranked.flatMap((s) => [s, ...variants(s)]), problems: res.problems };
  };

  const toMeeting = (cid: string, slot: RankedSlot): Meeting => ({
    id: `plan-${cid}`,
    title: "",
    start: slot.start,
    end: slot.end,
    attendeeIds: slot.attendees,
    createdAt: 0,
  });
  const toPlacement = (cid: string, slot: RankedSlot): Placement => ({
    candidateId: cid,
    slot,
    panel: slot.attendees.filter((id) => id !== cid),
  });

  // Candidates who cannot be placed even on an empty calendar are out from the start.
  const unplaced: Unplaced[] = [];
  const pending: string[] = [];
  for (const cid of new Set(input.candidates)) {
    const o = optionsFor(cid, []);
    if (o.count === 0) {
      unplaced.push({
        candidateId: cid,
        reason: o.problems[0] ?? "No time where the candidate and a full panel are free together.",
      });
    } else pending.push(cid);
  }

  let nodes = 0;
  let backtracks = 0;
  let best: Placement[] = [];

  const pickNext = (remaining: readonly string[], tentative: readonly Meeting[]) => {
    let pick: { cid: string; o: Options } | undefined;
    for (const cid of remaining) {
      const o = optionsFor(cid, tentative);
      if (!pick || o.count < pick.o.count) pick = { cid, o };
      if (o.count === 0) break;
    }
    return pick!;
  };

  const search = (remaining: string[], tentative: Meeting[], placed: Placement[]): boolean => {
    if (placed.length > best.length) best = placed;
    if (remaining.length === 0) return true;
    if (++nodes > budget) return false;
    const { cid, o } = pickNext(remaining, tentative);
    const rest = remaining.filter((c) => c !== cid);
    for (const slot of o.options) {
      if (search(rest, [...tentative, toMeeting(cid, slot)], [...placed, toPlacement(cid, slot)])) return true;
      if (nodes > budget) return false;
      backtracks++;
    }
    return false;
  };

  const complete = search(pending, [], []);
  let placements = best;
  if (!complete) {
    // Fall back to a greedy pass that skips whoever becomes impossible.
    const greedy: Placement[] = [];
    const tentative: Meeting[] = [];
    let remaining = [...pending];
    while (remaining.length) {
      const { cid, o } = pickNext(remaining, tentative);
      remaining = remaining.filter((c) => c !== cid);
      const slot = o.options[0];
      if (!slot) continue;
      greedy.push(toPlacement(cid, slot));
      tentative.push(toMeeting(cid, slot));
    }
    if (greedy.length > placements.length) placements = greedy;
  }

  const placedIds = new Set(placements.map((p) => p.candidateId));
  for (const cid of pending) {
    if (!placedIds.has(cid)) {
      unplaced.push({
        candidateId: cid,
        reason:
          cap === undefined
            ? "Every possible slot collides with another candidate's interview."
            : "Every possible slot collides with another interview or hits a panel member's daily cap.",
      });
    }
  }
  placements = [...placements].sort((a, b) => a.slot.start - b.slot.start);
  return { placements, unplaced, stats: { nodes, backtracks, complete: complete && unplaced.length === 0 } };
}
