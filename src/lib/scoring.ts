/**
 * Weighted candidate ↔ requirement/tender scoring.
 *
 * Pure, dependency-free, and shared between the Next.js app and (later) Supabase
 * Edge Functions. No AI — this is always-free local logic (plan Decision 10).
 *
 * Weights (from spec):
 *   role 35% · skills 25% · certifications 20% · experience 10% · availability 10%
 *
 * Returns a total 0–100 plus the per-criteria breakdown for UI transparency.
 */

export const SCORING_WEIGHTS = {
  role: 35,
  skills: 25,
  certifications: 20,
  experience: 10,
  availability: 10,
} as const;

export type Availability = "available" | "notice_period" | "unavailable";

export interface CandidateInput {
  /** Primary role. */
  current_role: string | null;
  /** Additional roles the candidate also holds; matching takes the best. */
  additional_roles?: string[];
  /** Professional / soft / domain skills. */
  skills: string[];
  /** Technical skills; combined with `skills` for overlap scoring. */
  technical_skills?: string[];
  certifications: string[];
  years_experience: number | null;
  availability: Availability;
}

export interface RequirementInput {
  required_role: string | null;
  required_skills: string[];
  required_certifications: string[];
  min_experience_years: number | null;
  /** Optional. When omitted, availability contributes full marks. */
  required_availability?: Availability | null;
}

export interface ScoreBreakdown {
  /** Each sub-score is 0–1 (fraction of that criterion's weight earned). */
  role: number;
  skills: number;
  certifications: number;
  experience: number;
  availability: number;
}

export interface ScoreResult {
  /** 0–100, rounded to nearest integer. */
  total: number;
  /** Fractional sub-scores (0–1) per criterion. */
  breakdown: ScoreBreakdown;
  /** Points earned per criterion (sub-score × weight), for UI bars like "22/25". */
  points: ScoreBreakdown;
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Overlap ratio: fraction of required items the candidate has.
 * Case/whitespace-insensitive. Empty requirement list => full marks (nothing to fail).
 */
export function overlapRatio(candidate: string[], required: string[]): number {
  if (required.length === 0) return 1;
  const have = new Set(candidate.map(normalize));
  const matched = required.reduce((n, item) => (have.has(normalize(item)) ? n + 1 : n), 0);
  return matched / required.length;
}

/**
 * Role match: exact (normalized) = 1.0; token-overlap fuzzy fallback otherwise.
 * No required role => full marks.
 */
export function roleMatch(candidateRole: string | null, requiredRole: string | null): number {
  if (!requiredRole || normalize(requiredRole) === "") return 1;
  if (!candidateRole || normalize(candidateRole) === "") return 0;

  const a = normalize(candidateRole);
  const b = normalize(requiredRole);
  if (a === b) return 1;

  const at = new Set(a.split(" "));
  const bt = b.split(" ");
  const shared = bt.reduce((n, t) => (at.has(t) ? n + 1 : n), 0);
  // Fuzzy score capped below 1 so an exact match is always strictly better.
  return Math.min(0.9, shared / bt.length);
}

/** Best role match across a candidate's primary + additional roles. */
export function bestRoleMatch(roles: (string | null)[], requiredRole: string | null): number {
  const candidates = roles.filter((r): r is string => !!r && r.trim() !== "");
  if (candidates.length === 0) return roleMatch(null, requiredRole);
  return Math.max(...candidates.map((r) => roleMatch(r, requiredRole)));
}

/**
 * Experience: full marks at or above the minimum; tapers linearly toward 0 as the
 * candidate falls below it. No minimum specified => full marks.
 */
export function experienceMatch(years: number | null, minYears: number | null): number {
  if (minYears == null || minYears <= 0) return 1;
  const y = years ?? 0;
  if (y >= minYears) return 1;
  return Math.max(0, y / minYears);
}

const AVAILABILITY_RANK: Record<Availability, number> = {
  available: 2,
  notice_period: 1,
  unavailable: 0,
};

/**
 * Availability: meeting or beating the required availability = full marks; each
 * step worse tapers down. No requirement => full marks.
 */
export function availabilityMatch(
  candidate: Availability,
  required: Availability | null | undefined,
): number {
  if (!required) {
    // No explicit requirement: reward readiness so "available" still ranks highest.
    return AVAILABILITY_RANK[candidate] / 2;
  }
  const c = AVAILABILITY_RANK[candidate];
  const r = AVAILABILITY_RANK[required];
  if (c >= r) return 1;
  // One step below required => 0.5, two steps => 0.
  return Math.max(0, 1 - (r - c) * 0.5);
}

export function scoreCandidate(
  candidate: CandidateInput,
  requirement: RequirementInput,
): ScoreResult {
  const candidateSkills = [...candidate.skills, ...(candidate.technical_skills ?? [])];
  const breakdown: ScoreBreakdown = {
    role: bestRoleMatch(
      [candidate.current_role, ...(candidate.additional_roles ?? [])],
      requirement.required_role,
    ),
    skills: overlapRatio(candidateSkills, requirement.required_skills),
    certifications: overlapRatio(candidate.certifications, requirement.required_certifications),
    experience: experienceMatch(candidate.years_experience, requirement.min_experience_years),
    availability: availabilityMatch(candidate.availability, requirement.required_availability),
  };

  const points: ScoreBreakdown = {
    role: breakdown.role * SCORING_WEIGHTS.role,
    skills: breakdown.skills * SCORING_WEIGHTS.skills,
    certifications: breakdown.certifications * SCORING_WEIGHTS.certifications,
    experience: breakdown.experience * SCORING_WEIGHTS.experience,
    availability: breakdown.availability * SCORING_WEIGHTS.availability,
  };

  const total =
    points.role + points.skills + points.certifications + points.experience + points.availability;

  return {
    total: Math.round(total),
    breakdown,
    points,
  };
}

/** Job requirement alert threshold (email at ≥80%). */
export const JOB_ALERT_THRESHOLD = 80;
/** Tender "strong match" badge threshold (≥70%). */
export const TENDER_STRONG_MATCH_THRESHOLD = 70;
