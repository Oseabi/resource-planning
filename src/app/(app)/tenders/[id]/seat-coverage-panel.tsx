import Link from "next/link";
import { Users } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/availability";
import { seatCoverage, type SeatDemand } from "@/lib/seat-coverage";
import { TENDER_STRONG_MATCH_THRESHOLD } from "@/lib/scoring";
import { cn } from "@/lib/utils";

/**
 * Whether this bid can actually be staffed on the day the contract starts.
 *
 * The seat cards below answer "who is good enough for this", which is a
 * different question from "who is free in March", and until now nothing joined
 * the two. The tender's own contract start date has been stored since the first
 * migration and used by nothing, so the answer was a manual exercise with the
 * candidate list filter and a count by eye.
 */
export async function SeatCoveragePanel({
  tenderId,
  startDate,
  seats,
  softCommitments,
}: {
  tenderId: string;
  startDate: string | null;
  seats: SeatDemand[];
  /** Candidates already proposed on other open bids. */
  softCommitments: string[];
}) {
  if (seats.length === 0) return null;

  const scored = seats.some((s) => s.matches.length > 0);

  if (!startDate || !scored) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-muted/30 px-4 py-3 text-body-sm text-muted-foreground">
        {!startDate ? (
          <>
            Set a contract start date to check whether these seats can be staffed.{" "}
            <Link href={`/tenders/${tenderId}/edit`} className="underline">
              Add it on the tender
            </Link>
            .
          </>
        ) : (
          // Without this the panel would report a total shortfall on a tender
          // nobody has matched yet, and cry wolf on its first day.
          <>Run matching to see whether these seats can be staffed on {formatDate(startDate)}.</>
        )}
      </div>
    );
  }

  const qualifiedIds = [
    ...new Set(
      seats.flatMap((s) =>
        s.matches.filter((m) => m.score >= TENDER_STRONG_MATCH_THRESHOLD).map((m) => m.candidateId),
      ),
    ),
  ];

  const supabase = await createClient();
  const [{ data: candidates }, { data: placements }] = await Promise.all([
    supabase.from("candidates").select("id, available_from").in("id", qualifiedIds),
    supabase
      .from("placements")
      .select("candidate_id, start_date, end_date")
      .in("candidate_id", qualifiedIds),
  ]);

  const coverage = seatCoverage({
    seats,
    candidates: candidates ?? [],
    placements: placements ?? [],
    softCommitments,
    startDate,
  });

  const coverable = coverage.totalNeeded - coverage.totalShortfall;
  const allCovered = coverage.totalShortfall === 0;

  return (
    <div className="rounded-lg border border-border bg-card shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Users className="size-4 text-muted-foreground" />
          <h3 className="text-body-md font-medium text-foreground">
            On {formatDate(startDate)} you can cover {coverable} of {coverage.totalNeeded} seat
            {coverage.totalNeeded === 1 ? "" : "s"}
          </h3>
        </div>
        <span
          className={cn(
            "rounded-lg px-2 py-0.5 text-label-md font-medium",
            allCovered ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive",
          )}
        >
          {allCovered
            ? "Fully covered"
            : `${coverage.totalShortfall} short`}
        </span>
      </div>

      <ul className="divide-y divide-border">
        {coverage.perSeat.map((s) => (
          <li key={s.positionId} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
            <span className="flex-[1_1_10rem] truncate text-body-md text-foreground">{s.role}</span>
            <span className="text-body-sm text-muted-foreground">
              {s.free} free of {s.needed} needed
            </span>
            {/* Without this a seat reads "0 free of 2 needed" and says nothing
                about why, so nobody qualified and everybody busy look the same.
                They call for opposite responses: one is a hiring problem, the
                other a scheduling one. */}
            {s.committedHard > 0 && (
              <span className="rounded-lg bg-muted px-2 py-0.5 text-label-md font-medium text-muted-foreground">
                {s.committedHard} on other work
              </span>
            )}
            {s.qualified === 0 && (
              <span className="rounded-lg bg-destructive/10 px-2 py-0.5 text-label-md font-medium text-destructive">
                Nobody qualified
              </span>
            )}
            {s.committedSoft > 0 && (
              <span className="rounded-lg bg-primary/10 px-2 py-0.5 text-label-md font-medium text-primary">
                {s.committedSoft} promised to other bids
              </span>
            )}
            {s.unknown > 0 && (
              <span className="rounded-lg bg-muted px-2 py-0.5 text-label-md font-medium text-muted-foreground">
                {s.unknown} with no end date
              </span>
            )}
            {s.shortfall > 0 && (
              <span className="rounded-lg bg-destructive/10 px-2 py-0.5 text-label-md font-medium text-destructive">
                {s.shortfall} short
              </span>
            )}
          </li>
        ))}
      </ul>

      {coverage.totalFreeBySeat > coverage.distinctFreeCandidates && (
        <p className="border-t border-border px-4 py-2.5 text-body-sm text-muted-foreground">
          {/* Without this the seat lines can each read as covered while the bid
              as a whole is not, because the same person qualifies for several. */}
          Some of these people qualify for more than one seat, so the totals count{" "}
          {coverage.distinctFreeCandidates} distinct{" "}
          {coverage.distinctFreeCandidates === 1 ? "person" : "people"}.
        </p>
      )}
    </div>
  );
}
