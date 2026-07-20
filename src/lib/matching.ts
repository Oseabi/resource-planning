/**
 * Pure matching helpers shared by the server match runner and the UI.
 * No I/O, no server-only — safe to unit-test.
 */
import {
  scoreCandidate,
  JOB_ALERT_THRESHOLD,
  TENDER_STRONG_MATCH_THRESHOLD,
  type CandidateInput,
  type RequirementInput,
  type ScoreResult,
  type Availability,
} from "@/lib/scoring";
import type { Database } from "@/lib/supabase/database.types";

type CandidateRow = Database["public"]["Tables"]["candidates"]["Row"];
type RequirementRow = Database["public"]["Tables"]["job_requirements"]["Row"];

/** Map a candidate DB row to the scoring engine's input shape. */
export function candidateToScoringInput(c: {
  current_role: string | null;
  additional_roles: string[];
  skills: string[];
  technical_skills: string[];
  certifications: string[];
  years_experience: number | null;
  availability: Availability;
}): CandidateInput {
  return {
    current_role: c.current_role,
    additional_roles: c.additional_roles,
    skills: c.skills,
    technical_skills: c.technical_skills,
    certifications: c.certifications,
    years_experience: c.years_experience,
    availability: c.availability,
  };
}

function normalizeAvailability(value: string | null): Availability | null {
  return value === "available" || value === "notice_period" || value === "unavailable" ? value : null;
}

/** Map a job-requirement DB row to the scoring engine's requirement shape. */
export function requirementToScoringInput(r: {
  required_role: string | null;
  required_skills: string[];
  required_certifications: string[];
  min_experience_years: number | null;
  required_availability: string | null;
}): RequirementInput {
  return {
    required_role: r.required_role,
    required_skills: r.required_skills,
    required_certifications: r.required_certifications,
    min_experience_years: r.min_experience_years,
    required_availability: normalizeAvailability(r.required_availability),
  };
}

export interface ScoreBreakdownJson {
  total: number;
  breakdown: ScoreResult["breakdown"];
  points: ScoreResult["points"];
}

/** Shape persisted into matches.score_breakdown (jsonb). */
export function toScoreBreakdownJson(result: ScoreResult): ScoreBreakdownJson {
  return { total: result.total, breakdown: result.breakdown, points: result.points };
}

/** Score one candidate row against one requirement row. */
export function scoreCandidateForRequirement(
  candidate: Parameters<typeof candidateToScoringInput>[0],
  requirement: Parameters<typeof requirementToScoringInput>[0],
): ScoreResult {
  return scoreCandidate(candidateToScoringInput(candidate), requirementToScoringInput(requirement));
}

/** Minimum score increase over the last-alerted score before we re-alert. */
export const ALERT_MATERIAL_RISE = 5;

/**
 * Whether to (re)send an alert for a match given the score at which it was last
 * alerted (null = never) and the new score. Sends when the score is at/above the
 * job alert threshold and either was never alerted, or rose materially since.
 */
export function decideAlert(prevAlertedScore: number | null, newScore: number): boolean {
  if (newScore < JOB_ALERT_THRESHOLD) return false;
  if (prevAlertedScore == null) return true;
  return newScore - prevAlertedScore >= ALERT_MATERIAL_RISE;
}

// ---------------------------------------------------------------------------
// Tender matching
// ---------------------------------------------------------------------------

export interface TenderScoringSource {
  required_roles: string[];
  required_skills: string[];
  required_certifications: string[];
  min_experience_years?: number | null;
}

/**
 * Score a candidate against a tender. Tenders list multiple required roles;
 * the candidate is scored against each and the best result wins (mirroring how
 * a candidate's own multiple roles are handled). Tenders have no availability
 * requirement (availability rewards readiness per the engine); the optional
 * minimum-experience requirement applies when set.
 */
export function scoreCandidateForTender(
  candidate: Parameters<typeof candidateToScoringInput>[0],
  tender: TenderScoringSource,
): ScoreResult {
  const input = candidateToScoringInput(candidate);
  const roles: (string | null)[] = tender.required_roles.length ? tender.required_roles : [null];
  let best: ScoreResult | null = null;
  for (const role of roles) {
    const result = scoreCandidate(input, {
      required_role: role,
      required_skills: tender.required_skills,
      required_certifications: tender.required_certifications,
      min_experience_years: tender.min_experience_years ?? null,
      required_availability: null,
    });
    if (!best || result.total > best.total) best = result;
  }
  return best!;
}

/** Pool/match strength for a tender: average of the top-3 candidate scores. */
export function poolStrength(scores: number[]): number {
  if (scores.length === 0) return 0;
  const top = [...scores].sort((a, b) => b - a).slice(0, 3);
  return Math.round(top.reduce((s, v) => s + v, 0) / top.length);
}

export interface PoolGap {
  role: string;
  /** Candidates scoring ≥ the strong-match threshold for this role. */
  covered: number;
}

/**
 * Per-role coverage: for each required role, how many candidates hit the
 * strong-match threshold when scored against that role alone. Roles with zero
 * coverage are the pool's gaps ("you need more X").
 */
export function poolGapAnalysis(
  candidates: Parameters<typeof candidateToScoringInput>[0][],
  tender: TenderScoringSource,
  threshold = TENDER_STRONG_MATCH_THRESHOLD,
): PoolGap[] {
  return tender.required_roles.map((role) => {
    const covered = candidates.filter((c) => {
      const result = scoreCandidate(candidateToScoringInput(c), {
        required_role: role,
        required_skills: tender.required_skills,
        required_certifications: tender.required_certifications,
        min_experience_years: tender.min_experience_years ?? null,
        required_availability: null,
      });
      return result.total >= threshold;
    }).length;
    return { role, covered };
  });
}

export {
  JOB_ALERT_THRESHOLD,
  TENDER_STRONG_MATCH_THRESHOLD,
  type CandidateRow,
  type RequirementRow,
};
