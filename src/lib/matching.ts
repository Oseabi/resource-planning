/**
 * Pure matching helpers shared by the server match runner and the UI.
 * No I/O, no server-only, safe to unit-test.
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
import {
  positionToScoringInput,
  fillSummary,
  seatCount,
  type PositionInput,
} from "@/lib/positions";

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
  /**
   * How many required items were answered by a broader term rather than the
   * thing the seat named. Stored so a reader of an old row can tell a literal
   * score from an approximate one; the column is free-form jsonb, so carrying
   * it needs no migration.
   */
  near: ScoreResult["near"];
}

/** Shape persisted into matches.score_breakdown (jsonb). */
export function toScoreBreakdownJson(result: ScoreResult): ScoreBreakdownJson {
  return {
    total: result.total,
    breakdown: result.breakdown,
    points: result.points,
    near: result.near,
  };
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

/**
 * How many alerts one run may send before it stops and reports the rest.
 *
 * Matching writes one row per candidate per seat, so a ten-seat requirement
 * against eight hundred people writes eight thousand rows. Without a cap, one
 * button press could send hundreds of emails one after another into a single
 * inbox, which is how a sending domain gets blocked and how the action runs
 * out of time. The remainder is reported, never silently dropped.
 */
export const ALERT_BATCH_CAP = 25;

export interface BestMatch<T> {
  row: T;
  /**
   * The highest score this candidate has ever been alerted at on this parent,
   * across all of its seats. Null when they have never been alerted.
   */
  alertedHighWater: number | null;
}

/**
 * A candidate's best match row, with what they were last alerted at.
 *
 * Scoring is per seat, so one person holds a row for every seat on a
 * requirement. Both the shortlist panel and the alert sweep want one entry per
 * person, and they have to agree about which row that is, or the panel shows a
 * score the email did not use.
 *
 * The high-water mark is what makes alerting on the best row correct. A
 * candidate alerted at 82 on seat A, who then scores 95 on seat B, has a null
 * alerted_score on B; deciding on that row alone would send what the manager
 * reads as a duplicate. Taking the highest score they were ever alerted at on
 * this parent turns 95 into genuine news and 83 into silence.
 *
 * Ties go to the lowest id so a re-run never flips which row carries the alert.
 */
export function bestMatchPerCandidate<
  T extends { id: string; candidate_id: string; score: number; alerted_score?: number | null },
>(rows: T[]): BestMatch<T>[] {
  const best = new Map<string, T>();
  const highWater = new Map<string, number | null>();

  for (const row of rows) {
    const current = best.get(row.candidate_id);
    if (!current || row.score > current.score || (row.score === current.score && row.id < current.id)) {
      best.set(row.candidate_id, row);
    }
    if (row.alerted_score != null) {
      const seen = highWater.get(row.candidate_id);
      if (seen == null || row.alerted_score > seen) highWater.set(row.candidate_id, row.alerted_score);
    }
  }

  return [...best.values()]
    .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1))
    .map((row) => ({ row, alertedHighWater: highWater.get(row.candidate_id) ?? null }));
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

// ---------------------------------------------------------------------------
// Position matching
//
// A position carries its own role, skills, certifications and experience floor,
// so unlike `scoreCandidateForTender`, which scores every role against one
// shared criteria set, each seat is scored on its own terms.
// ---------------------------------------------------------------------------

/** Score a candidate against a single position. */
export function scoreCandidateForPosition(
  candidate: Parameters<typeof candidateToScoringInput>[0],
  position: PositionInput,
): ScoreResult {
  return scoreCandidate(candidateToScoringInput(candidate), positionToScoringInput(position));
}

export interface PositionCoverage {
  positionId: string;
  role: string;
  quantity: number;
  filled: number;
  remaining: number;
  /** Candidates scoring ≥ the strong-match threshold for this position. */
  strongMatches: number;
  /** Open seats with nobody strong enough to fill them. */
  isGap: boolean;
}

/**
 * Per-position coverage: how many seats each role needs, how many are taken,
 * and how many candidates could credibly fill the rest. A position is a gap when
 * seats remain and no candidate clears the threshold, the "you need more X"
 * signal, now seat-aware rather than role-aware.
 */
export function positionCoverage(
  candidates: Parameters<typeof candidateToScoringInput>[0][],
  positions: (PositionInput & { id: string })[],
  assignments: { position_id: string }[] = [],
  threshold = TENDER_STRONG_MATCH_THRESHOLD,
): PositionCoverage[] {
  const { perPosition } = fillSummary(positions, assignments);
  const fillById = new Map(perPosition.map((p) => [p.positionId, p]));

  return positions.map((position) => {
    const fill = fillById.get(position.id);
    const quantity = fill?.quantity ?? seatCount(position);
    const filled = fill?.filled ?? 0;
    const remaining = fill?.remaining ?? quantity;

    const strongMatches = candidates.filter(
      (c) => scoreCandidateForPosition(c, position).total >= threshold,
    ).length;

    return {
      positionId: position.id,
      role: position.role,
      quantity,
      filled,
      remaining,
      strongMatches,
      isGap: remaining > 0 && strongMatches === 0,
    };
  });
}

export {
  JOB_ALERT_THRESHOLD,
  TENDER_STRONG_MATCH_THRESHOLD,
  type CandidateRow,
  type RequirementRow,
};
