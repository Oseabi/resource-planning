/**
 * Positions, the roles a job requirement or tender needs staffed.
 *
 * A requirement/tender holds N positions; each carries its own role, seat count,
 * experience floor, skills and certifications. Pure helpers only (no I/O), so
 * every rule here is unit-testable.
 */
import type { CandidateInput, RequirementInput } from "@/lib/scoring";

/**
 * Everything needed to re-score a candidate against a seat, plus enough to name
 * them. Sent to the client once per candidate rather than once per match, since
 * the same person appears under every seat they were scored for.
 */
export interface CandidateProfile extends CandidateInput {
  id: string;
  full_name: string;
}

/** A position as the forms and the matcher see it (id absent until saved). */
export interface PositionInput {
  id?: string;
  role: string;
  quantity: number;
  min_experience_years: number | null;
  required_skills: string[];
  required_certifications: string[];
  required_availability?: string | null;
  notes?: string | null;
}

/** A blank line for the positions editor. */
export const EMPTY_POSITION: PositionInput = {
  role: "",
  quantity: 1,
  min_experience_years: null,
  required_skills: [],
  required_certifications: [],
  required_availability: null,
  notes: null,
};

const AVAILABILITY_VALUES = ["available", "notice_period", "unavailable"] as const;

function normalizeAvailability(value: string | null | undefined): RequirementInput["required_availability"] {
  return AVAILABILITY_VALUES.includes(value as (typeof AVAILABILITY_VALUES)[number])
    ? (value as (typeof AVAILABILITY_VALUES)[number])
    : null;
}

/**
 * A position is exactly one requirement's worth of scoring criteria, so the
 * scoring engine needs no change, only this adapter. Mirrors
 * `requirementToScoringInput` in `@/lib/matching`.
 */
export function positionToScoringInput(position: PositionInput): RequirementInput {
  return {
    required_role: position.role?.trim() ? position.role : null,
    required_skills: position.required_skills ?? [],
    required_certifications: position.required_certifications ?? [],
    min_experience_years: position.min_experience_years ?? null,
    required_availability: normalizeAvailability(position.required_availability),
  };
}

/** Seats are whole people; guard against a blank or nonsensical quantity. */
export function seatCount(position: { quantity?: number | null }): number {
  const n = Math.floor(Number(position.quantity ?? 1));
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export interface PositionFill {
  positionId: string;
  quantity: number;
  /** Assignments held, capped at nothing, may exceed quantity if over-filled. */
  filled: number;
  remaining: number;
  isFull: boolean;
}

export interface FillSummary {
  totalSeats: number;
  filledSeats: number;
  /** Percentage of seats filled, 0 when a parent has no positions yet. */
  percent: number;
  perPosition: PositionFill[];
}

/**
 * How much of a team is staffed. `filled` counts assignments regardless of
 * status, because a proposed tender seat is still spoken for, the bid is
 * complete even though nobody has started.
 */
export function fillSummary(
  positions: { id: string; quantity?: number | null }[],
  assignments: { position_id: string }[],
): FillSummary {
  const counts = new Map<string, number>();
  for (const a of assignments) {
    counts.set(a.position_id, (counts.get(a.position_id) ?? 0) + 1);
  }

  const perPosition: PositionFill[] = positions.map((p) => {
    const quantity = seatCount(p);
    const filled = counts.get(p.id) ?? 0;
    return {
      positionId: p.id,
      quantity,
      filled,
      remaining: Math.max(0, quantity - filled),
      isFull: filled >= quantity,
    };
  });

  const totalSeats = perPosition.reduce((sum, p) => sum + p.quantity, 0);
  // Over-filling one line must not mask a gap elsewhere, so cap per position.
  const filledSeats = perPosition.reduce((sum, p) => sum + Math.min(p.filled, p.quantity), 0);

  return {
    totalSeats,
    filledSeats,
    percent: totalSeats > 0 ? Math.round((filledSeats / totalSeats) * 100) : 0,
    perPosition,
  };
}

/** Reject positions the user left blank before saving. */
export function isUsablePosition(position: PositionInput): boolean {
  return Boolean(position.role?.trim());
}

/** Drop blank lines and stamp the display order the user arranged. */
export function cleanPositions(positions: PositionInput[]): PositionInput[] {
  return positions.filter(isUsablePosition).map((p) => ({
    ...p,
    role: p.role.trim(),
    quantity: seatCount(p),
  }));
}
