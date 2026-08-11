"use client";

import Link from "next/link";
import { Check, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { SCORING_WEIGHTS } from "@/lib/scoring";
import type { CandidateProfile } from "@/lib/positions";
import { CRITERIA, CriterionBar, scoreDetail } from "@/app/(app)/score-breakdown";

/**
 * Two or three candidates against the same seat, broken down the way the score
 * was actually built.
 *
 * Scores are recomputed here rather than read from the stored match rows. The
 * engine is pure and dependency-free so it runs identically in the browser, and
 * recomputing is what makes the matched/missing lists available: the stored
 * breakdown holds the numbers but not which particular skill was the one
 * missing, and that is the whole point of comparing.
 */
export function CompareCandidates({
  position,
  candidates,
  onClose,
}: {
  position: {
    id: string;
    role: string;
    minExperienceYears: number | null;
    requiredSkills: string[];
    requiredCertifications: string[];
  } | null;
  candidates: CandidateProfile[];
  onClose: () => void;
}) {
  const open = !!position && candidates.length > 0;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Compare for {position?.role}</DialogTitle>
          <DialogDescription>
            Scored against this seat only. A candidate can rank differently on another seat of the
            same bid.
          </DialogDescription>
        </DialogHeader>
        {position && <CompareBody position={position} candidates={candidates} />}
      </DialogContent>
    </Dialog>
  );
}

function CompareBody({
  position,
  candidates,
}: {
  position: {
    id: string;
    role: string;
    minExperienceYears: number | null;
    requiredSkills: string[];
    requiredCertifications: string[];
  };
  candidates: CandidateProfile[];
}) {
  // Same helper the inline breakdown uses, so a candidate's numbers here always
  // agree with the ones on the row behind this dialog.
  const scored = candidates.map((candidate) => ({
    candidate,
    ...scoreDetail(position, candidate),
  }));

  const best = Math.max(...scored.map((s) => s.result.total));

  return (
    <div
      className="grid gap-4 py-2"
      style={{ gridTemplateColumns: `repeat(${scored.length}, minmax(0, 1fr))` }}
    >
      {scored.map(({ candidate, result, skills, certifications }) => (
        <div
          key={candidate.id}
          className={cn(
            "min-w-0 rounded-lg border p-4",
            result.total === best ? "border-primary/40 bg-primary/5" : "border-border bg-card",
          )}
        >
          <Link
            href={`/candidates/${candidate.id}`}
            className="block truncate font-medium text-foreground hover:text-primary"
          >
            {candidate.full_name}
          </Link>
          <div className="truncate text-body-sm text-muted-foreground">
            {candidate.current_role ?? "No role set"}
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-display font-semibold text-foreground">{result.total}%</span>
            {result.total === best && scored.length > 1 && (
              <span className="text-label-md font-medium text-primary">Highest</span>
            )}
          </div>

          <div className="mt-4 space-y-2">
            {CRITERIA.map((c) => (
              <CriterionBar
                key={c.key}
                label={c.label}
                earned={result.points[c.key]}
                weight={SCORING_WEIGHTS[c.key]}
              />
            ))}
          </div>

          <div className="mt-4 space-y-3 border-t border-border pt-3">
            <ItemList title="Skills" matched={skills.matched} missing={skills.missing} />
            <ItemList
              title="Certifications"
              matched={certifications.matched}
              missing={certifications.missing}
            />
            <div className="text-body-sm">
              <span className="text-muted-foreground">Experience: </span>
              <span
                className={cn(
                  position.minExperienceYears != null &&
                    (candidate.years_experience ?? 0) < position.minExperienceYears
                    ? "text-destructive"
                    : "text-foreground",
                )}
              >
                {candidate.years_experience ?? 0} yrs
              </span>
              {position.minExperienceYears != null && (
                <span className="text-muted-foreground"> of {position.minExperienceYears} needed</span>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * What the candidate has and what they lack, for one criterion. The missing list
 * is the useful half: it turns "skills 12 out of 25" into something actionable.
 */
function ItemList({
  title,
  matched,
  missing,
}: {
  title: string;
  matched: string[];
  missing: string[];
}) {
  if (matched.length === 0 && missing.length === 0) {
    return (
      <div className="text-body-sm">
        <div className="text-label-sm uppercase tracking-wide text-muted-foreground">{title}</div>
        <div className="text-muted-foreground">None required</div>
      </div>
    );
  }

  return (
    <div>
      <div className="text-label-sm uppercase tracking-wide text-muted-foreground">{title}</div>
      <ul className="mt-1 space-y-0.5">
        {matched.map((item) => (
          <li key={item} className="flex items-start gap-1.5 text-body-sm text-foreground">
            <Check className="mt-0.5 size-3.5 shrink-0 text-success" />
            <span className="min-w-0">{item}</span>
          </li>
        ))}
        {missing.map((item) => (
          <li key={item} className="flex items-start gap-1.5 text-body-sm text-muted-foreground">
            <X className="mt-0.5 size-3.5 shrink-0 text-destructive" />
            <span className="min-w-0">{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
