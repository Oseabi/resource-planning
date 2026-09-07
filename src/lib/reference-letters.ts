/**
 * Client reference letters, and whether a bid has enough of them.
 *
 * Public tenders ask for contactable references: letters from past clients
 * confirming work of a similar kind, size and recency was actually delivered.
 * Short of them a bid is disqualified on compliance before anybody reads the
 * team, which makes a missing letter as expensive as an unstaffed seat.
 *
 * Deliberately not folded into oem-letters.ts. An OEM letter is a manufacturer
 * authorising you to resell and it expires; a reference letter is a past client
 * vouching for delivered work and it does not. They share a shape and nothing
 * else, and one module covering both would need an expiry rule that is wrong
 * half the time.
 *
 * Pure, no I/O.
 */

import { today } from "@/lib/availability";

/** The parts of a letter this module reasons about. */
export interface ReferenceLetterFacts {
  id: string;
  client: string;
  contract_value: number | null;
  work_completed_on: string | null;
  sectors: string[];
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
}

export type LetterCoverageState = "met" | "short" | "unknown";

export interface LetterCoverage {
  required: number | null;
  onFile: number;
  /** Letters nobody could actually ring. Tenders ask for contactable references. */
  uncontactable: number;
  shortfall: number;
  state: LetterCoverageState;
}

/**
 * Whether a letter can actually be followed up. A reference with no way to
 * reach the signatory is worth nothing on a bid that asks for contactable ones,
 * so it is counted separately rather than silently included.
 */
export function isContactable(letter: ReferenceLetterFacts): boolean {
  return Boolean(letter.contact_email?.trim() || letter.contact_phone?.trim());
}

/**
 * Letters that would answer for this tender.
 *
 * Recency is the filter that matters, because tenders routinely say "within the
 * last five years" and an older letter is simply not eligible. A letter with no
 * completion date is kept rather than dropped: not recording the date is a gap
 * in our own data, and discarding the letter over it would understate what the
 * business can actually put forward.
 */
export function eligibleLetters(
  letters: ReferenceLetterFacts[],
  options: { withinYears?: number | null; minValue?: number | null; from?: string } = {},
): ReferenceLetterFacts[] {
  const { withinYears, minValue } = options;
  const from = options.from ?? today();

  let cutoff: string | null = null;
  if (withinYears && withinYears > 0) {
    const year = Number(from.slice(0, 4)) - withinYears;
    cutoff = `${year}${from.slice(4)}`;
  }

  return letters.filter((l) => {
    if (cutoff && l.work_completed_on && l.work_completed_on < cutoff) return false;
    if (minValue != null && l.contract_value != null && l.contract_value < minValue) return false;
    return true;
  });
}

/**
 * Null `required` reads as unknown rather than met. Nobody has taken the number
 * off the RFQ yet, and reporting a bid as compliant on that basis would be the
 * system asserting something it was never told.
 */
export function letterCoverage(
  required: number | null,
  letters: ReferenceLetterFacts[],
): LetterCoverage {
  const contactable = letters.filter(isContactable);
  const onFile = letters.length;

  if (required === null) {
    return { required: null, onFile, uncontactable: onFile - contactable.length, shortfall: 0, state: "unknown" };
  }

  // Counted on contactable letters, because that is what the tender asks for.
  const shortfall = Math.max(0, required - contactable.length);
  return {
    required,
    onFile,
    uncontactable: onFile - contactable.length,
    shortfall,
    state: shortfall === 0 ? "met" : "short",
  };
}

/** How the coverage should read on a bid. */
export function coverageLabel(coverage: LetterCoverage): string {
  if (coverage.state === "unknown") {
    return coverage.onFile === 1
      ? "1 reference letter on file, and no requirement recorded for this tender"
      : `${coverage.onFile} reference letters on file, and no requirement recorded for this tender`;
  }
  if (coverage.state === "met") return `${coverage.required} needed, ${coverage.onFile} on file`;
  return `${coverage.required} needed, ${coverage.shortfall} short`;
}
