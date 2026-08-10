"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Users, Clock, Award, AlertTriangle, UserPlus, X, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { TENDER_STRONG_MATCH_THRESHOLD } from "@/lib/scoring";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { assignCandidate, unassignCandidate } from "@/app/(app)/assignment-actions";

export interface PositionMatch {
  candidateId: string;
  name: string;
  role: string | null;
  score: number;
}

export interface AssignedCandidate {
  candidateId: string;
  name: string;
  role: string | null;
  status: string;
}

export interface PositionView {
  id: string;
  role: string;
  quantity: number;
  minExperienceYears: number | null;
  requiredSkills: string[];
  requiredCertifications: string[];
  filled: number;
  assigned: AssignedCandidate[];
  matches: PositionMatch[];
}

function scoreBadgeClass(score: number): string {
  if (score >= 80) return "bg-primary/10 text-primary";
  if (score >= TENDER_STRONG_MATCH_THRESHOLD) return "bg-strong-match/10 text-strong-match";
  return "bg-muted text-muted-foreground";
}

/** How many candidates to show under each role before it gets noisy. */
const TOP_N = 5;

interface PendingAssign {
  position: PositionView;
  candidateId: string;
  name: string;
}

/**
 * One card per role a requirement or tender needs staffed, each with its own
 * ranked shortlist, its seats, and who is sitting in them.
 *
 * A tender seat is a *proposal*, the bid may not be won, so assigning does not
 * take the candidate out of the pool. A job requirement is a real vacancy, so it
 * asks for the fee and start date and places them immediately.
 */
export function PositionMatches({
  positions,
  parentType,
  conflicts = {},
}: {
  positions: PositionView[];
  parentType: "job_requirement" | "tender";
  /** candidateId → other open bids they are already promised to. */
  conflicts?: Record<string, string[]>;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<PendingAssign | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const isVacancy = parentType === "job_requirement";

  function beginAssign(position: PositionView, candidateId: string, name: string) {
    setError(null);
    // A vacancy needs commercial terms; a bid proposal does not.
    if (isVacancy) {
      setPending({ position, candidateId, name });
      return;
    }
    setBusyId(candidateId);
    startTransition(async () => {
      const result = await assignCandidate(position.id, candidateId);
      setBusyId(null);
      if (result.error) setError(result.error);
      else router.refresh();
    });
  }

  function removeAssignment(positionId: string, candidateId: string) {
    setError(null);
    setBusyId(candidateId);
    startTransition(async () => {
      const result = await unassignCandidate(positionId, candidateId);
      setBusyId(null);
      if (result.error) setError(result.error);
      else router.refresh();
    });
  }

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
      {error && (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-body-sm text-destructive">
          {error}
        </p>
      )}

      {positions.map((position) => {
        const remaining = Math.max(0, position.quantity - position.filled);
        const strong = position.matches.filter(
          (m) => m.score >= TENDER_STRONG_MATCH_THRESHOLD,
        ).length;
        const isGap = remaining > 0 && strong === 0;
        const seated = new Set(position.assigned.map((a) => a.candidateId));

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

            {/* Who holds the seats */}
            {position.assigned.length > 0 && (
              <ul className="divide-y divide-border border-b border-border bg-muted/30">
                {position.assigned.map((a) => (
                  <li
                    key={a.candidateId}
                    className="flex items-center justify-between gap-3 px-4 py-2"
                  >
                    <div className="min-w-0">
                      <Link
                        href={`/candidates/${a.candidateId}`}
                        className="block truncate font-medium text-foreground hover:text-primary"
                      >
                        {a.name}
                      </Link>
                      <div className="truncate text-body-sm text-muted-foreground">
                        {a.role ?? "-"}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span
                        className={cn(
                          "rounded-lg px-2 py-0.5 text-label-md font-medium",
                          a.status === "placed"
                            ? "bg-success/10 text-success"
                            : "bg-primary/10 text-primary",
                        )}
                      >
                        {a.status === "placed" ? "Placed" : "Proposed"}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={isPending && busyId === a.candidateId}
                        onClick={() => removeAssignment(position.id, a.candidateId)}
                      >
                        <X className="size-4" />
                        Remove
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {position.matches.length === 0 ? (
              <p className="px-4 py-6 text-center text-body-sm text-muted-foreground">
                No matches yet. Run matching to score candidates against this role.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {position.matches
                  .filter((m) => !seated.has(m.candidateId))
                  .slice(0, TOP_N)
                  .map((m) => {
                    const clash = conflicts[m.candidateId] ?? [];
                    return (
                      <li
                        key={m.candidateId}
                        className="flex items-center justify-between gap-3 px-4 py-2"
                      >
                        <div className="min-w-0">
                          <Link
                            href={`/candidates/${m.candidateId}`}
                            className="block truncate font-medium text-foreground hover:text-primary"
                          >
                            {m.name}
                          </Link>
                          <div className="truncate text-body-sm text-muted-foreground">
                            {m.role ?? "-"}
                          </div>
                          {clash.length > 0 && (
                            <div className="mt-0.5 flex items-center gap-1 text-label-md text-strong-match">
                              <TriangleAlert className="size-3.5 shrink-0" />
                              <span className="truncate">
                                Already proposed on {clash.join(", ")}
                              </span>
                            </div>
                          )}
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <span
                            className={cn(
                              "rounded-lg px-2 py-0.5 text-label-md font-semibold",
                              scoreBadgeClass(m.score),
                            )}
                          >
                            {m.score}%
                          </span>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={remaining === 0 || (isPending && busyId === m.candidateId)}
                            onClick={() => beginAssign(position, m.candidateId, m.name)}
                          >
                            <UserPlus className="size-4" />
                            {remaining === 0 ? "Full" : "Assign"}
                          </Button>
                        </div>
                      </li>
                    );
                  })}
              </ul>
            )}
          </div>
        );
      })}

      <PlaceOnVacancyDialog
        pending={pending}
        onClose={() => setPending(null)}
        onDone={() => {
          setPending(null);
          router.refresh();
        }}
        onError={setError}
      />
    </div>
  );
}

/** A job-requirement seat is a real placement, so it needs fee and start date. */
function PlaceOnVacancyDialog({
  pending,
  onClose,
  onDone,
  onError,
}: {
  pending: PendingAssign | null;
  onClose: () => void;
  onDone: () => void;
  onError: (message: string) => void;
}) {
  const [fee, setFee] = useState("");
  const [startDate, setStartDate] = useState("");
  const [isPending, startTransition] = useTransition();

  function submit() {
    if (!pending) return;
    startTransition(async () => {
      const result = await assignCandidate(pending.position.id, pending.candidateId, {
        feeValue: Number(fee || 0),
        startDate,
      });
      if (result.error) {
        onError(result.error);
        onClose();
        return;
      }
      setFee("");
      setStartDate("");
      onDone();
    });
  }

  return (
    <Dialog open={pending !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Place {pending?.name}</DialogTitle>
          <DialogDescription>
            Filling a <span className="font-medium text-foreground">{pending?.position.role}</span>{" "}
            seat. This records a placement, so they move out of the available pool.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="assign-fee">Placement fee</Label>
            <Input
              id="assign-fee"
              type="number"
              min={0}
              step="0.01"
              value={fee}
              onChange={(e) => setFee(e.target.value)}
              placeholder="e.g. 85000"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="assign-start">Start date</Label>
            <Input
              id="assign-start"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={isPending || !startDate}>
            {isPending ? "Placing..." : "Place candidate"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
