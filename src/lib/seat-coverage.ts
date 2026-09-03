/**
 * Can we actually staff this bid, on the day the contract starts?
 *
 * Matching answers whether somebody is qualified. It says nothing about whether
 * they are free, because a match score has to stay stable: fold the calendar
 * into it and a persisted score would drift with the wall clock, so re-running
 * matching would silently rewrite history. This module keeps the two apart and
 * joins them only at the point the question is asked.
 *
 * Pure, no I/O. Every date rule is delegated to availability.ts, which already
 * encodes them and is tested.
 */

import {
  availableFrom,
  isFreeBy,
  INDEFINITE,
  type CandidateAvailability,
  type PlacementWindow,
  type FreeFrom,
} from "@/lib/availability";
import { TENDER_STRONG_MATCH_THRESHOLD } from "@/lib/scoring";

/** One seat line, with the people matching has already scored against it. */
export interface SeatDemand {
  positionId: string;
  role: string;
  quantity: number;
  matches: { candidateId: string; score: number }[];
}

export interface SeatCoverage {
  positionId: string;
  role: string;
  needed: number;
  /** Scored at or above the threshold for this seat. */
  qualified: number;
  /** Qualified, free on the date, and not promised to another bid. */
  free: number;
  /** A placement holds them past the contract start. */
  committedHard: number;
  /** Proposed on another open bid. A decision, but one a person can revisit. */
  committedSoft: number;
  /** Committed with no end date, so nothing can be said either way. */
  unknown: number;
  /** Seats with nobody free to fill them. Never negative. */
  shortfall: number;
  freeCandidateIds: string[];
  softCandidateIds: string[];
}

export interface CoverageInput {
  seats: SeatDemand[];
  candidates: CandidateAvailability[];
  placements: PlacementWindow[];
  /** Candidates already proposed on other bids that are still open. */
  softCommitments?: Iterable<string>;
  /** The contract start date the question is about. Never today. */
  startDate: string;
  threshold?: number;
}

export interface CoverageSummary {
  startDate: string;
  perSeat: SeatCoverage[];
  totalNeeded: number;
  /** Sum of the per-seat free counts. One person qualified for two seats counts twice. */
  totalFreeBySeat: number;
  /** Distinct people free across every seat, because one body cannot fill two. */
  distinctFreeCandidates: number;
  /** Lower bound on the gap: seats needed minus the distinct people available. */
  totalShortfall: number;
  /** Seats with a shortfall, worst first. */
  gaps: SeatCoverage[];
}

export function seatCoverage(input: CoverageInput): CoverageSummary {
  const { seats, candidates, placements, startDate } = input;
  const threshold = input.threshold ?? TENDER_STRONG_MATCH_THRESHOLD;
  const soft = new Set(input.softCommitments ?? []);

  // Computed once against the contract start date, not today.
  //
  // availableFrom already ignores placements that have finished relative to the
  // date it is given, so somebody whose contract ends in November is correctly
  // free for a January start. Passing today instead would hold back exactly the
  // people the question is about, which is everyone finishing between now and
  // the day the work begins.
  //
  // Built as a map rather than called per seat, since availableFrom scans the
  // whole placement list on every call.
  const freeFromById = new Map<string, FreeFrom>();
  for (const candidate of candidates) {
    freeFromById.set(candidate.id, availableFrom(candidate, placements, startDate));
  }

  const perSeat: SeatCoverage[] = [];
  const distinctFree = new Set<string>();

  for (const seat of seats) {
    const qualified = seat.matches.filter((m) => m.score >= threshold);
    const freeCandidateIds: string[] = [];
    const softCandidateIds: string[] = [];
    let committedHard = 0;
    let unknown = 0;

    for (const match of qualified) {
      const free = freeFromById.get(match.candidateId);
      // Scored at some point but no longer in the candidate set, so nothing can
      // be claimed about them.
      if (free === undefined) continue;
      if (free === INDEFINITE) unknown += 1;
      else if (!isFreeBy(free, startDate)) committedHard += 1;
      else if (soft.has(match.candidateId)) softCandidateIds.push(match.candidateId);
      else freeCandidateIds.push(match.candidateId);
    }

    for (const id of freeCandidateIds) distinctFree.add(id);

    perSeat.push({
      positionId: seat.positionId,
      role: seat.role,
      needed: seat.quantity,
      qualified: qualified.length,
      free: freeCandidateIds.length,
      committedHard,
      committedSoft: softCandidateIds.length,
      unknown,
      shortfall: Math.max(0, seat.quantity - freeCandidateIds.length),
      freeCandidateIds,
      softCandidateIds,
    });
  }

  const totalNeeded = perSeat.reduce((sum, s) => sum + s.needed, 0);

  return {
    startDate,
    perSeat,
    totalNeeded,
    totalFreeBySeat: perSeat.reduce((sum, s) => sum + s.free, 0),
    distinctFreeCandidates: distinctFree.size,
    // Counted against distinct people, never the per-seat sum. One person
    // qualified for two seats reads as free under both, and adding those up
    // would claim two people for two seats when there is only one.
    totalShortfall: Math.max(0, totalNeeded - distinctFree.size),
    gaps: perSeat.filter((s) => s.shortfall > 0).sort((a, b) => b.shortfall - a.shortfall),
  };
}
