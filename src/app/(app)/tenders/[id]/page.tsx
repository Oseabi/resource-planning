import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Pencil, Briefcase, MapPin, CalendarClock, CalendarRange, Banknote, Clock } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { isCurrentUserAdmin } from "@/lib/auth/current-user";
import { Button } from "@/components/ui/button";
import { TenderStatusBadge, DeliveryStateBadge } from "@/app/(app)/tenders/tender-badges";
import { deliveryState, contractWindowLabel } from "@/lib/delivery";
import { CvDownloadButton } from "@/app/(app)/candidates/[id]/cv-download-button";
import { DeleteTenderButton } from "@/app/(app)/tenders/[id]/delete-tender-button";
import {
  TenderMatchingResults,
  type TenderMatchView,
} from "@/app/(app)/tenders/[id]/tender-matching-results";
import { poolStrength, TENDER_STRONG_MATCH_THRESHOLD } from "@/lib/matching";
import { loadPositionViews } from "@/lib/positions-repo";
import { loadActivity } from "@/app/(app)/activity-actions";
import { ActivityTimeline } from "@/components/activity/activity-timeline";
import { fillSummary } from "@/lib/positions";
import { PositionMatches } from "@/app/(app)/position-matches";
import { findBidConflicts } from "@/app/(app)/assignment-actions";
import { ConfirmTeamBanner } from "@/app/(app)/tenders/[id]/confirm-team-banner";
import { DeliveryPanel } from "@/app/(app)/tenders/[id]/delivery-panel";
import { SeatCoveragePanel } from "@/app/(app)/tenders/[id]/seat-coverage-panel";
import { letterCoverage, coverageLabel } from "@/lib/reference-letters";
import { FileCheck2 } from "lucide-react";

function formatValue(value: number | null): string {
  if (value == null) return "-";
  if (value >= 1_000_000) return `R${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `R${(value / 1_000).toFixed(0)}k`;
  return `R${value}`;
}

export default async function TenderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  // The tender and its match rows are independent, so they go out together
  // rather than one after the other. isCurrentUserAdmin is request-cached, the
  // layout has already resolved it, so it adds no round-trip.
  const [{ data: tender }, isAdmin, positionData, activity, { data: referenceLetters }] = await Promise.all([
    supabase.from("tenders").select("*").eq("id", id).single(),
    isCurrentUserAdmin(),
    loadPositionViews(supabase, "tender", id),
    loadActivity("tender", id),
    // Compliance sits beside staffing: short of reference letters a bid is
    // disqualified before anybody reads the team.
    supabase
      .from("reference_letters")
      .select("id, client, contract_value, work_completed_on, sectors, contact_name, contact_email, contact_phone"),
  ]);
  if (!tender) notFound();

  const positionViews = positionData.positions;

  const fill = fillSummary(
    positionViews.map((p) => ({ id: p.id, quantity: p.quantity })),
    positionViews.flatMap((p) =>
      Array.from({ length: p.filled }, () => ({ position_id: p.id })),
    ),
  );

  // Bidding the same senior person on several open tenders is normal, but the
  // exposure should be visible on the row before anyone commits them again.
  const proposedCount = positionViews.reduce(
    (sum, p) => sum + p.assigned.filter((a) => a.status === "proposed").length,
    0,
  );

  const shortlisted = [...new Set(positionViews.flatMap((p) => p.matches.map((m) => m.candidateId)))];
  const conflicts = await findBidConflicts(shortlisted, id);
  const conflictsByCandidate: Record<string, string[]> = Object.fromEntries(
    conflicts.map((c) => [c.candidateId, c.tenderTitles]),
  );

  // Each candidate's best score across the tender's seats.
  const matches: TenderMatchView[] = positionData.aggregated.map((m) => ({
    matchId: m.matchId,
    candidateId: m.candidateId,
    name: m.name,
    role: m.role,
    score: m.score,
  }));

  // Coverage comes from the position matches that were actually scored, not from
  // a second pass over the tender's legacy role/skill columns. Scoring those
  // separately made the panel contradict the cards above it, a role could show
  // a 100% candidate and still be reported as a gap.
  const poolGaps = positionViews.map((p) => ({
    role: p.role,
    covered: p.matches.filter((m) => m.score >= TENDER_STRONG_MATCH_THRESHOLD).length,
  }));
  const strength = poolStrength(matches.map((m) => m.score));

  const delivery = deliveryState(tender);
  const letters = letterCoverage(tender.reference_letters_required, referenceLetters ?? []);

  const tags: { icon: React.ReactNode; label: string }[] = [];
  for (const r of tender.required_roles.slice(0, 4)) tags.push({ icon: <Briefcase className="size-3.5" />, label: r });
  if (tender.min_experience_years != null)
    tags.push({ icon: <Clock className="size-3.5" />, label: `${tender.min_experience_years}+ yrs` });
  if (tender.location) tags.push({ icon: <MapPin className="size-3.5" />, label: tender.location });
  if (tender.value != null) tags.push({ icon: <Banknote className="size-3.5" />, label: formatValue(tender.value) });
  if (tender.submission_deadline)
    tags.push({ icon: <CalendarClock className="size-3.5" />, label: `Due ${tender.submission_deadline}` });
  // The contract window has been stored since the first migration and shown
  // nowhere, so a running contract looked identical to one that finished a year
  // ago.
  if (tender.contract_start_date || tender.contract_end_date)
    tags.push({
      icon: <CalendarRange className="size-3.5" />,
      label: contractWindowLabel(tender.contract_start_date, tender.contract_end_date),
    });

  return (
    <div className="space-y-6">
      <Link href="/tenders" className="inline-flex items-center gap-1.5 text-body-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" />
        Back to tenders
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            {tender.client && (
              <span className="text-label-sm uppercase tracking-wide text-muted-foreground">{tender.client}</span>
            )}
            <TenderStatusBadge status={tender.status} />
            {delivery && <DeliveryStateBadge state={delivery} />}
          </div>
          <h1 className="mt-1 text-display font-semibold text-foreground">{tender.title}</h1>
          {tender.reference_number && (
            <p className="mt-1 font-mono text-body-sm text-muted-foreground">
              Bid no. {tender.reference_number}
            </p>
          )}
          {tags.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {tags.map((t, i) => (
                <span key={i} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2 py-1 text-label-md text-foreground">
                  <span className="text-muted-foreground">{t.icon}</span>
                  {t.label}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {tender.source_document_path && (
            <CvDownloadButton path={tender.source_document_path} filename="RFQ document" />
          )}
          <Button variant="outline" size="sm" render={<Link href={`/tenders/${id}/edit`} />} nativeButton={false}>
            <Pencil className="size-4" />
            Edit
          </Button>
          {isAdmin && <DeleteTenderButton tenderId={tender.id} tenderTitle={tender.title} />}
        </div>
      </div>

      {/* Only once the bid is won. Before that the contract does not exist and
          the page is about assembling a team to bid with. */}
      {delivery && (
        <DeliveryPanel
          tenderId={id}
          state={delivery}
          contractStartDate={tender.contract_start_date}
          contractEndDate={tender.contract_end_date}
        />
      )}

      <div>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-headline-sm font-semibold text-foreground">Team required</h2>
          <span className="text-body-sm text-muted-foreground">
            {fill.filledSeats} of {fill.totalSeats} seat{fill.totalSeats === 1 ? "" : "s"} filled
          </span>
        </div>
        {/* Rendered for every status but lost, because the question is asked
            hardest before the bid goes in. */}
        {tender.status !== "lost" && letters.state !== "unknown" && (
          <div
            className={cn(
              "mb-3 flex flex-wrap items-center gap-2 rounded-lg border px-4 py-2.5 text-body-sm",
              letters.state === "met"
                ? "border-border bg-card text-muted-foreground"
                : "border-destructive/30 bg-destructive/5 text-foreground",
            )}
          >
            <FileCheck2 className="size-4 shrink-0 text-muted-foreground" />
            <span>Reference letters: {coverageLabel(letters)}</span>
            {letters.uncontactable > 0 && (
              <span className="rounded-lg bg-muted px-2 py-0.5 text-label-md font-medium text-muted-foreground">
                {letters.uncontactable} with no contact details
              </span>
            )}
            <Link href="/reference-letters" className="ml-auto underline">
              All letters
            </Link>
          </div>
        )}
        {tender.status !== "lost" && (
          <div className="mb-3">
            <SeatCoveragePanel
              tenderId={id}
              startDate={tender.contract_start_date}
              seats={positionViews.map((p) => ({
                positionId: p.id,
                role: p.role,
                quantity: p.quantity,
                matches: p.matches.map((m) => ({ candidateId: m.candidateId, score: m.score })),
              }))}
              // findBidConflicts already ran for the shortlist above, so the
              // people promised elsewhere cost no extra query.
              softCommitments={Object.keys(conflictsByCandidate)}
            />
          </div>
        )}
        {tender.status === "won" && (
          <ConfirmTeamBanner
            tenderId={id}
            proposedCount={proposedCount}
            contractStartDate={tender.contract_start_date}
            contractEndDate={tender.contract_end_date}
          />
        )}
        <PositionMatches
          positions={positionViews}
          parentType="tender"
          conflicts={conflictsByCandidate}
          candidatePool={positionData.candidatePool}
        />
      </div>

      <TenderMatchingResults
        tenderId={id}
        tenderTitle={tender.title}
        matches={matches}
        poolStrengthValue={strength}
        poolGaps={poolGaps}
      />

      <ActivityTimeline entityType="tender" entityId={id} entries={activity} />
    </div>
  );
}
