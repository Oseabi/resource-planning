"use client";

import { CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  SCORING_WEIGHTS,
  scoreCandidate,
  overlapDetail,
  type ScoreBreakdown as Breakdown,
  type ScoreResult,
  type OverlapDetail,
} from "@/lib/scoring";
import { positionToScoringInput, type CandidateProfile, type PositionInput } from "@/lib/positions";

/** The seat's scoring criteria, as the matcher sees them. */
export interface ScoredPosition {
  role: string;
  minExperienceYears: number | null;
  requiredSkills: string[];
  requiredCertifications: string[];
}

export interface ScoreDetail {
  result: ScoreResult;
  skills: OverlapDetail;
  certifications: OverlapDetail;
}

/** The five criteria in weight order, heaviest first. */
export const CRITERIA: { key: keyof Breakdown; label: string }[] = [
  { key: "role", label: "Role" },
  { key: "skills", label: "Skills" },
  { key: "certifications", label: "Certifications" },
  { key: "experience", label: "Experience" },
  { key: "availability", label: "Availability" },
];

/**
 * Re-score a candidate against a seat, in the browser.
 *
 * The engine is pure and dependency-free, so it gives the same answer here as it
 * did on the server when the match row was written. Recomputing is what makes
 * the matched/missing names available: the stored score_breakdown holds the
 * numbers but not which particular skill was the one missing, and that is the
 * whole point of showing a breakdown.
 */
export function scoreDetail(
  position: ScoredPosition,
  candidate: CandidateProfile,
): ScoreDetail {
  const asPosition: PositionInput = {
    role: position.role,
    quantity: 1,
    min_experience_years: position.minExperienceYears,
    required_skills: position.requiredSkills,
    required_certifications: position.requiredCertifications,
  };

  const allSkills = [...candidate.skills, ...(candidate.technical_skills ?? [])];

  return {
    result: scoreCandidate(candidate, positionToScoringInput(asPosition)),
    skills: overlapDetail(allSkills, position.requiredSkills),
    certifications: overlapDetail(candidate.certifications, position.requiredCertifications),
  };
}

/** A single criterion's earned points against its weight, as a labelled bar. */
export function CriterionBar({
  label,
  earned,
  weight,
}: {
  label: string;
  earned: number;
  weight: number;
}) {
  const pct = weight > 0 ? (earned / weight) * 100 : 0;
  return (
    <div>
      <div className="flex items-center justify-between text-body-sm">
        <span className="text-foreground">{label}</span>
        <span className="text-muted-foreground">
          {Math.round(earned)}/{weight}
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full", barClass(pct))}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function barClass(pct: number): string {
  if (pct >= 99) return "bg-success";
  if (pct >= 50) return "bg-primary";
  return "bg-strong-match";
}

/** Full marks, something, or nothing. Drives both the icon and its colour. */
function tone(ratio: number): "full" | "partial" | "none" {
  if (ratio >= 0.999) return "full";
  return ratio > 0 ? "partial" : "none";
}

function ToneIcon({ ratio }: { ratio: number }) {
  const t = tone(ratio);
  if (t === "full") return <CheckCircle2 className="size-4 shrink-0 text-success" />;
  if (t === "partial") return <AlertTriangle className="size-4 shrink-0 text-strong-match" />;
  return <XCircle className="size-4 shrink-0 text-destructive" />;
}

/**
 * Why a candidate scored what they scored, against one seat.
 *
 * Answers the question a bare percentage cannot: a 100% is only trustworthy if
 * you can see it is 35/35 on role, every skill matched and every certification
 * held, and a 63% is only actionable if you can see which two skills are the
 * gap.
 */
export function ScoreCard({
  position,
  candidate,
  detail,
}: {
  position: ScoredPosition;
  candidate: CandidateProfile;
  detail: ScoreDetail;
}) {
  const { result, skills, certifications } = detail;
  const needed = position.minExperienceYears;
  const years = candidate.years_experience ?? 0;

  // Sub-labels that say how the number was arrived at, e.g. "3 of 4 matched".
  const subLabel: Partial<Record<keyof Breakdown, string>> = {
    role:
      result.breakdown.role >= 0.999
        ? position.role
        : `${candidate.current_role ?? "no role set"} vs ${position.role}`,
    skills: position.requiredSkills.length
      ? `${skills.matched.length} of ${position.requiredSkills.length} matched`
      : "none required",
    certifications: position.requiredCertifications.length
      ? `${certifications.matched.length} of ${position.requiredCertifications.length} held`
      : "none required",
    experience:
      needed != null ? `${years} yrs against ${needed} needed` : `${years} yrs, no minimum set`,
    availability: candidate.availability.replace("_", " "),
  };

  return (
    <div className="space-y-3 border-t border-border bg-muted/30 px-4 py-3">
      <div className="flex items-baseline justify-between">
        <span className="text-label-sm uppercase tracking-wide text-muted-foreground">
          How this scores
        </span>
        <span className="text-body-sm text-muted-foreground">
          {result.total} of 100 points
        </span>
      </div>

      <ul className="space-y-1.5">
        {CRITERIA.map((c) => {
          const earned = Math.round(result.points[c.key]);
          const weight = SCORING_WEIGHTS[c.key];
          return (
            <li key={c.key} className="flex items-center gap-2 text-body-sm">
              <ToneIcon ratio={result.breakdown[c.key]} />
              <span className="min-w-0 flex-1 truncate">
                <span className="text-foreground">{c.label}</span>
                <span className="ml-1.5 text-muted-foreground">{subLabel[c.key]}</span>
              </span>
              <span
                className={cn(
                  "shrink-0 tabular-nums",
                  earned === weight ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {earned}/{weight} pts
              </span>
            </li>
          );
        })}
      </ul>

      {/* The gaps by name. This is the part a percentage can never tell you. */}
      {(skills.missing.length > 0 || certifications.missing.length > 0) && (
        <div className="space-y-1 border-t border-border pt-2">
          {skills.missing.length > 0 && (
            <MissingLine label="Missing skills" items={skills.missing} />
          )}
          {certifications.missing.length > 0 && (
            <MissingLine label="Missing certifications" items={certifications.missing} />
          )}
        </div>
      )}
    </div>
  );
}

function MissingLine({ label, items }: { label: string; items: string[] }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-1.5 text-body-sm">
      <span className="text-label-sm uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-foreground">{items.join(", ")}</span>
    </div>
  );
}
