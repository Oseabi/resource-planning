/**
 * Weighted candidate against requirement/tender scoring.
 *
 * Pure and shared between the Next.js app and the browser: the breakdown panel
 * re-runs this client-side to name which skills matched, so nothing here may
 * become async or reach the network. No AI, this is always-free local logic
 * (plan Decision 10).
 *
 * Weights (from spec):
 *   role 35% | skills 25% | certifications 20% | experience 10% | availability 10%
 *
 * Returns a total 0 to 100 plus the per-criteria breakdown for UI transparency.
 *
 * Whether a candidate's term satisfies a requirement is decided by
 * skill-matching.ts, which knows that "D365 F&O" and "Microsoft Dynamics 365
 * F&O" are the same thing and that "Java 8" answers "Java".
 */

import {
  buildCandidateIndex,
  qualityAgainst,
  aliasEqual,
  baseKey,
  fold,
  type MatchQuality,
} from "@/lib/skill-matching";

export { NEAR_MATCH_CREDIT, type MatchQuality } from "@/lib/skill-matching";

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
  /** Each sub-score is 0 to 1 (fraction of that criterion's weight earned). */
  role: number;
  skills: number;
  certifications: number;
  experience: number;
  availability: number;
}

export interface ScoreResult {
  /** 0 to 100, rounded to nearest integer. */
  total: number;
  /** Fractional sub-scores (0 to 1) per criterion. */
  breakdown: ScoreBreakdown;
  /** Points earned per criterion (sub-score times weight), for UI bars like "22/25". */
  points: ScoreBreakdown;
  /**
   * How much of this score rests on a broader term rather than the thing the
   * seat actually named. Carried into the stored breakdown so a run can tell
   * a literal 82 from an approximate one before it emails a hiring manager.
   */
  near: { skills: number; certifications: number };
}

function normalize(value: string): string {
  // Same guard as fold in skill-matching: one null element in a text[] column
  // must not throw and abandon a whole run.
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/** One required item, and what in the candidate's own record answered it. */
export interface OverlapItem {
  /** Always the requirement's own spelling. That is what gets shown back. */
  required: string;
  quality: MatchQuality;
  /** 1 for a full match, NEAR_MATCH_CREDIT for a broader term, 0 for none. */
  credit: number;
  /** The candidate's own wording that satisfied it, when something did. */
  via: string | null;
}

export interface OverlapDetail {
  /** Required items the candidate holds outright, in the requirement's order. */
  matched: string[];
  /** Required items answered only by a broader term of the candidate's. */
  near: string[];
  /** Required items the candidate lacks, in the same order. */
  missing: string[];
  /** Credit-weighted fraction of required items held; 1 when nothing was required. */
  ratio: number;
  /** Every required item with how it was answered. The buckets derive from this. */
  items: OverlapItem[];
}

/**
 * Which required items the candidate holds and which they lack.
 *
 * Same comparison as `overlapRatio` (case and whitespace insensitive) but it
 * keeps the names, so the UI can say "missing SAP FICO and PMP" rather than
 * only "12 out of 25". Strings are returned as the requirement spelled them,
 * not as normalized, because these are shown to a person.
 */
export function overlapDetail(candidate: string[], required: string[]): OverlapDetail {
  const index = buildCandidateIndex(candidate);
  const items: OverlapItem[] = required.map((item) => {
    const { quality, credit, via } = qualityAgainst(index, item);
    return { required: item, quality, credit, via };
  });

  return {
    matched: items.filter((i) => i.credit === 1).map((i) => i.required),
    near: items.filter((i) => i.credit > 0 && i.credit < 1).map((i) => i.required),
    missing: items.filter((i) => i.credit === 0).map((i) => i.required),
    // Empty requirement list => full marks (nothing to fail).
    ratio:
      required.length === 0
        ? 1
        : items.reduce((sum, i) => sum + i.credit, 0) / required.length,
    items,
  };
}

/**
 * Overlap ratio: fraction of required items the candidate has.
 * Case/whitespace-insensitive. Empty requirement list => full marks (nothing to fail).
 */
export function overlapRatio(candidate: string[], required: string[]): number {
  return overlapDetail(candidate, required).ratio;
}

/**
 * Role match: the same role however it is written = 1.0; token-overlap fuzzy
 * fallback otherwise. No required role => full marks.
 *
 * The alias layer is what lets a seat advertised as "BA" be answered by
 * somebody whose CV says "Business Analyst". Tenders abbreviate the seat and
 * CVs write it out, and until now that cost the candidate all 35 points.
 */
export function roleMatch(candidateRole: string | null, requiredRole: string | null): number {
  if (!requiredRole || normalize(requiredRole) === "") return 1;
  if (!candidateRole || normalize(candidateRole) === "") return 0;

  if (fold(candidateRole) === fold(requiredRole)) return 1;
  if (aliasEqual(candidateRole, requiredRole)) return 1;
  if (baseKey(candidateRole) === baseKey(requiredRole)) return 1;

  const at = new Set(baseKey(candidateRole).split(" "));
  const bt = baseKey(requiredRole).split(" ");
  const shared = bt.reduce((n, t) => (at.has(t) ? n + 1 : n), 0);
  // Fuzzy score capped below 1 so an exact match is always strictly better.
  return Math.min(0.9, shared / bt.length);
}

/** Best role match across a candidate's primary + additional roles. */
export function bestRoleMatch(roles: (string | null)[], requiredRole: string | null): number {
  const candidates = roles.filter((r): r is string => typeof r === "string" && r.trim() !== "");
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
  const skills = overlapDetail(candidateSkills, requirement.required_skills);
  const certifications = overlapDetail(candidate.certifications, requirement.required_certifications);
  const breakdown: ScoreBreakdown = {
    role: bestRoleMatch(
      [candidate.current_role, ...(candidate.additional_roles ?? [])],
      requirement.required_role,
    ),
    skills: skills.ratio,
    certifications: certifications.ratio,
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
    near: { skills: skills.near.length, certifications: certifications.near.length },
  };
}

/** Job requirement alert threshold (email at ≥80%). */
export const JOB_ALERT_THRESHOLD = 80;
/** Tender "strong match" badge threshold (≥70%). */
export const TENDER_STRONG_MATCH_THRESHOLD = 70;
