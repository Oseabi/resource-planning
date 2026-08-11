/**
 * When people actually come free.
 *
 * `candidates.availability` is a three-value enum describing today. This module
 * adds the time dimension: an end date on a placement, an optional manual
 * override on the candidate, and the forward view those two make possible.
 *
 * Pure helpers only (no I/O), so every rule here is unit-testable. Dates are
 * handled as ISO `YYYY-MM-DD` strings throughout, matching the `date` columns,
 * and compared as strings because ISO dates sort lexicographically. That avoids
 * timezone drift entirely: parsing "2026-11-01" into a Date and reading it back
 * can land on 31 October depending on where the server is.
 */

/** Committed with no end date in sight. */
export const INDEFINITE = "indefinite";

export type FreeFrom = string | null | typeof INDEFINITE;

export interface PlacementWindow {
  candidate_id: string;
  start_date: string;
  end_date: string | null;
}

export interface CandidateAvailability {
  id: string;
  available_from: string | null;
}

/** Today as `YYYY-MM-DD`, in UTC so it agrees with how the dates are stored. */
export function today(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * The date a candidate is next free, or null if they are free now.
 *
 * Returns INDEFINITE when a placement has no end date, because "committed with
 * no end in sight" is genuinely different from "free on the 3rd" and the two
 * must not collapse into the same answer.
 *
 * Placements that have already finished are ignored, so someone whose contract
 * ended last month reads as free without anyone having to tidy the record.
 */
export function availableFrom(
  candidate: CandidateAvailability,
  placements: PlacementWindow[],
  from: string = today(),
): FreeFrom {
  const theirs = placements.filter((p) => p.candidate_id === candidate.id);

  // An open-ended placement dominates: no later date can be known.
  if (theirs.some((p) => p.end_date === null)) return INDEFINITE;

  const dates: string[] = [];
  if (candidate.available_from && candidate.available_from > from) {
    dates.push(candidate.available_from);
  }
  for (const p of theirs) {
    // end_date is non-null here; the open-ended case returned above.
    if (p.end_date! > from) dates.push(p.end_date!);
  }

  if (dates.length === 0) return null;
  // The last commitment to finish is the one that decides.
  return dates.reduce((latest, d) => (d > latest ? d : latest));
}

/** Free on or before `date`. INDEFINITE never qualifies. */
export function isFreeBy(free: FreeFrom, date: string): boolean {
  if (free === null) return true;
  if (free === INDEFINITE) return false;
  return free <= date;
}

export interface ForecastMonth {
  /** `YYYY-MM`, for keying and sorting. */
  month: string;
  /** "Nov 2026", for display. */
  label: string;
  /** Candidates whose commitments end in this month. */
  freeing: { id: string; date: string }[];
  /** Everyone free by the end of this month, including those already free. */
  cumulative: number;
}

const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** `YYYY-MM` for the month `offset` months after `from`, and its display label. */
function monthAt(from: string, offset: number): { month: string; label: string } {
  const year = Number(from.slice(0, 4));
  const monthIndex = Number(from.slice(5, 7)) - 1 + offset;
  const y = year + Math.floor(monthIndex / 12);
  const m = ((monthIndex % 12) + 12) % 12;
  return {
    month: `${y}-${String(m + 1).padStart(2, "0")}`,
    label: `${MONTH_LABELS[m]} ${y}`,
  };
}

/**
 * How the bench fills up over the next `months` months.
 *
 * Answers "we have a bid starting in November, who will be free": each month
 * lists who comes off a commitment, and `cumulative` is everyone available by
 * the end of it. Candidates free today count toward every month's cumulative
 * total, because they are still free later.
 *
 * Anyone INDEFINITE is excluded throughout. They have no known free date, so
 * counting them in any month would be a guess presented as a fact.
 */
export function benchForecast(
  candidates: CandidateAvailability[],
  placements: PlacementWindow[],
  months: number,
  from: string = today(),
): ForecastMonth[] {
  const free = candidates.map((c) => ({ id: c.id, at: availableFrom(c, placements, from) }));
  const alreadyFree = free.filter((f) => f.at === null).length;
  const dated = free.filter(
    (f): f is { id: string; at: string } => f.at !== null && f.at !== INDEFINITE,
  );

  const result: ForecastMonth[] = [];
  let running = alreadyFree;

  for (let i = 0; i < months; i++) {
    const { month, label } = monthAt(from, i);
    const freeing = dated
      .filter((f) => f.at.slice(0, 7) === month)
      .map((f) => ({ id: f.id, date: f.at }))
      .sort((a, b) => a.date.localeCompare(b.date));

    running += freeing.length;
    result.push({ month, label, freeing, cumulative: running });
  }

  return result;
}

/** "1 Nov 2026", for showing a free-from date next to a name. */
export function formatDate(date: string): string {
  const [y, m, d] = date.split("-");
  return `${Number(d)} ${MONTH_LABELS[Number(m) - 1]} ${y}`;
}

/** How a candidate's forward availability should read on screen. */
export function availabilityLabel(free: FreeFrom): string {
  if (free === null) return "Free now";
  if (free === INDEFINITE) return "Committed, no end date";
  return `Free from ${formatDate(free)}`;
}
