/**
 * Where a won bid sits in its contract, and the rules for moving that contract.
 *
 * Derived, never stored. `tenders.status` answers "did we win it", which is a
 * bidding question and does not change once decided. "Is it running" is a
 * calendar question whose answer changes every night, so a column holding it
 * would be wrong by the following morning.
 *
 * The date comparisons are delegated to `stintPhase`, which already encodes
 * has-it-started and has-it-finished for placements and is unit-tested. Two
 * copies of that rule would eventually disagree.
 *
 * Pure, no I/O.
 */

import { stintPhase, formatDate, type StintPhase } from "@/lib/availability";

export type DeliveryState = "awarded" | "in_delivery" | "completed";

/** The parts of a tender this module reasons about. */
export interface ContractWindow {
  status: string;
  contract_start_date: string | null;
  contract_end_date: string | null;
}

const PHASE_TO_STATE: Record<StintPhase, DeliveryState> = {
  upcoming: "awarded",
  current: "in_delivery",
  finished: "completed",
};

/**
 * Null when the question does not apply: the bid was not won, or nobody has
 * recorded when the contract starts. Guessing either would be worse than the
 * blank, which at least prompts someone to fill the date in.
 *
 * A won contract that has started with no end date reads as in delivery, which
 * falls out of `stintPhase` treating a null end as still running.
 */
export function deliveryState(
  tender: ContractWindow,
  from?: string,
): DeliveryState | null {
  if (tender.status !== "won") return null;
  if (!tender.contract_start_date) return null;
  return PHASE_TO_STATE[
    stintPhase(tender.contract_start_date, tender.contract_end_date, from)
  ];
}

export const DELIVERY_LABELS: Record<DeliveryState, string> = {
  awarded: "Awarded",
  in_delivery: "In delivery",
  completed: "Completed",
};

/** How a contract's dates should read on screen. */
export function contractWindowLabel(start: string | null, end: string | null): string {
  if (!start && !end) return "No contract dates set";
  if (!start) return `Ends ${formatDate(end!)}`;
  if (!end) return `From ${formatDate(start)}, open ended`;
  return `${formatDate(start)} to ${formatDate(end)}`;
}

/**
 * Split a contract's placements into the ones that were following the contract
 * and the ones carrying a date of their own.
 *
 * "Aligned" means the end date matches the contract's previous end exactly.
 * Anyone on a different date was overridden deliberately, and an extension that
 * moved them too would quietly undo somebody's decision.
 *
 * A null `previousEnd` aligns nothing. A contract with no recorded end whose
 * team is open ended is not being extended, it is being dated for the first
 * time, and silently converting open-ended commitments into dated ones under
 * the word "extended" is the kind of quiet data change that costs trust.
 */
export function placementsAlignedTo<T extends { end_date: string | null }>(
  placements: T[],
  previousEnd: string | null,
): { aligned: T[]; overridden: T[] } {
  const aligned: T[] = [];
  const overridden: T[] = [];
  for (const placement of placements) {
    if (previousEnd !== null && placement.end_date === previousEnd) aligned.push(placement);
    else overridden.push(placement);
  }
  return { aligned, overridden };
}

/** Why this extension cannot be applied, or null when it can. */
export function validateExtension(current: ContractWindow, newEnd: string): string | null {
  if (!newEnd) return "Pick the new end date.";
  if (current.status !== "won") return "Only a won contract can be extended.";
  if (current.contract_start_date && newEnd < current.contract_start_date) {
    return "The new end date is before the contract starts.";
  }
  if (current.contract_end_date && newEnd <= current.contract_end_date) {
    return `The contract already runs to ${formatDate(current.contract_end_date)}. An extension has to be later than that.`;
  }
  return null;
}

/**
 * Why this placement window is not usable, or null when it is. The form's `min`
 * attribute is bypassable, and the raw constraint error is not a sentence
 * anyone should be shown.
 */
export function validatePlacementWindow(start: string, end: string | null): string | null {
  if (!start) return "Pick a start date.";
  if (end && end < start) return "The end date is before the start date.";
  return null;
}
