import Link from "next/link";
import { Users, Clock, Award, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { TENDER_STRONG_MATCH_THRESHOLD } from "@/lib/scoring";

export interface PositionMatch {
  candidateId: string;
  name: string;
  role: string | null;
  score: number;
}

export interface PositionView {
  id: string;
  role: string;
  quantity: number;
  minExperienceYears: number | null;
  requiredSkills: string[];
  requiredCertifications: string[];
  filled: number;
  matches: PositionMatch[];
}

function scoreBadgeClass(score: number): string {
  if (score >= 80) return "bg-primary/10 text-primary";
  if (score >= TENDER_STRONG_MATCH_THRESHOLD) return "bg-strong-match/10 text-strong-match";
  return "bg-muted text-muted-foreground";
}

/** How many candidates to show under each role before it gets noisy. */
const TOP_N = 5;

/**
 * One card per role a requirement or tender needs staffed, each with its own
 * ranked shortlist. Replaces the old flat tag row, which could only show role
 * *names* sharing one set of criteria.
 */
export function PositionMatches({ positions }: { positions: PositionView[] }) {
  if (positions.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card p-8 text-center">
        <p className="text-body-sm text-muted-foreground">
          No roles defined yet. Edit this record and add one line per role you need staffed.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {positions.map((position) => {
        const remaining = Math.max(0, position.quantity - position.filled);
        const strong = position.matches.filter(
          (m) => m.score >= TENDER_STRONG_MATCH_THRESHOLD,
        ).length;
        const isGap = remaining > 0 && strong === 0;

        return (
          <div
            key={position.id}
            className="overflow-hidden rounded-lg border border-border bg-card shadow-card"
          >
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
              <div className="min-w-0">
                <h3 className="truncate text-headline-sm font-semibold text-foreground">
                  {position.role}
                </h3>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-body-sm text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <Users className="size-3.5" />
                    {position.quantity} seat{position.quantity === 1 ? "" : "s"}
                  </span>
                  {position.minExperienceYears != null && (
                    <span className="inline-flex items-center gap-1">
                      <Clock className="size-3.5" />
                      {position.minExperienceYears}+ yrs
                    </span>
                  )}
                  {position.requiredCertifications.slice(0, 2).map((c) => (
                    <span key={c} className="inline-flex items-center gap-1">
                      <Award className="size-3.5" />
                      {c}
                    </span>
                  ))}
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                {isGap && (
                  <span className="inline-flex items-center gap-1 rounded-lg bg-destructive/10 px-2 py-0.5 text-label-md font-medium text-destructive">
                    <AlertTriangle className="size-3.5" />
                    No strong match
                  </span>
                )}
                <span
                  className={cn(
                    "rounded-lg px-2 py-0.5 text-label-md font-semibold",
                    position.filled >= position.quantity
                      ? "bg-success/10 text-success"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {position.filled} of {position.quantity} filled
                </span>
              </div>
            </div>

            {position.requiredSkills.length > 0 && (
              <div className="flex flex-wrap gap-1 border-b border-border px-4 py-2">
                {position.requiredSkills.slice(0, 8).map((s) => (
                  <span
                    key={s}
                    className="rounded-lg bg-accent px-2 py-0.5 text-label-md text-accent-foreground"
                  >
                    {s}
                  </span>
                ))}
              </div>
            )}

            {position.matches.length === 0 ? (
              <p className="px-4 py-6 text-center text-body-sm text-muted-foreground">
                No matches yet. Run matching to score candidates against this role.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {position.matches.slice(0, TOP_N).map((m) => (
                  <li key={m.candidateId} className="flex items-center justify-between gap-3 px-4 py-2">
                    <div className="min-w-0">
                      <Link
                        href={`/candidates/${m.candidateId}`}
                        className="block truncate font-medium text-foreground hover:text-primary"
                      >
                        {m.name}
                      </Link>
                      <div className="truncate text-body-sm text-muted-foreground">
                        {m.role ?? "—"}
                      </div>
                    </div>
                    <span
                      className={cn(
                        "shrink-0 rounded-lg px-2 py-0.5 text-label-md font-semibold",
                        scoreBadgeClass(m.score),
                      )}
                    >
                      {m.score}%
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
