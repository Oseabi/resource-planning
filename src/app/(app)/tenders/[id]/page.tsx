import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Pencil, Briefcase, MapPin, CalendarClock, Banknote, Clock } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { isCurrentUserAdmin } from "@/lib/auth/current-user";
import { Button } from "@/components/ui/button";
import { TenderStatusBadge } from "@/app/(app)/tenders/tender-badges";
import { CvDownloadButton } from "@/app/(app)/candidates/[id]/cv-download-button";
import { DeleteTenderButton } from "@/app/(app)/tenders/[id]/delete-tender-button";
import {
  TenderMatchingResults,
  type TenderMatchView,
} from "@/app/(app)/tenders/[id]/tender-matching-results";
import { poolStrength, TENDER_STRONG_MATCH_THRESHOLD } from "@/lib/matching";
import { loadPositionViews } from "@/lib/positions-repo";
import { fillSummary } from "@/lib/positions";
import { PositionMatches } from "@/app/(app)/position-matches";
import { findBidConflicts } from "@/app/(app)/assignment-actions";
import { ConfirmTeamBanner } from "@/app/(app)/tenders/[id]/confirm-team-banner";

function formatValue(value: number | null): string {
  if (value == null) return "—";
  if (value >= 1_000_000) return `R${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `R${(value / 1_000).toFixed(0)}k`;
  return `R${value}`;
}

export default async function TenderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  // The tender and its match rows are independent, so they go out together
  // rather than one after the other. isCurrentUserAdmin is request-cached — the
  // layout has already resolved it, so it adds no round-trip.
  const [{ data: tender }, isAdmin, positionData] = await Promise.all([
    supabase.from("tenders").select("*").eq("id", id).single(),
    isCurrentUserAdmin(),
    loadPositionViews(supabase, "tender", id),
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
  // separately made the panel contradict the cards above it — a role could show
  // a 100% candidate and still be reported as a gap.
  const poolGaps = positionViews.map((p) => ({
    role: p.role,
    covered: p.matches.filter((m) => m.score >= TENDER_STRONG_MATCH_THRESHOLD).length,
  }));
  const strength = poolStrength(matches.map((m) => m.score));

  const tags: { icon: React.ReactNode; label: string }[] = [];
  for (const r of tender.required_roles.slice(0, 4)) tags.push({ icon: <Briefcase className="size-3.5" />, label: r });
  if (tender.min_experience_years != null)
    tags.push({ icon: <Clock className="size-3.5" />, label: `${tender.min_experience_years}+ yrs` });
  if (tender.location) tags.push({ icon: <MapPin className="size-3.5" />, label: tender.location });
  if (tender.value != null) tags.push({ icon: <Banknote className="size-3.5" />, label: formatValue(tender.value) });
  if (tender.submission_deadline)
    tags.push({ icon: <CalendarClock className="size-3.5" />, label: `Due ${tender.submission_deadline}` });

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

      <div>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-headline-sm font-semibold text-foreground">Team required</h2>
          <span className="text-body-sm text-muted-foreground">
            {fill.filledSeats} of {fill.totalSeats} seat{fill.totalSeats === 1 ? "" : "s"} filled
          </span>
        </div>
        {tender.status === "won" && (
          <ConfirmTeamBanner tenderId={id} proposedCount={proposedCount} />
        )}
        <PositionMatches
          positions={positionViews}
          parentType="tender"
          conflicts={conflictsByCandidate}
        />
      </div>

      <TenderMatchingResults
        tenderId={id}
        tenderTitle={tender.title}
        matches={matches}
        poolStrengthValue={strength}
        poolGaps={poolGaps}
      />
    </div>
  );
}
