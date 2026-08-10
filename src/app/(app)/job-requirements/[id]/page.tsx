import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Pencil, Briefcase, Award, Clock, MapPin } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { isCurrentUserAdmin } from "@/lib/auth/current-user";
import { Button } from "@/components/ui/button";
import { RequirementStatusBadge } from "@/app/(app)/job-requirements/requirement-badges";
import { MatchingResults, type MatchView } from "@/app/(app)/job-requirements/[id]/matching-results";
import { DeleteRequirementButton } from "@/app/(app)/job-requirements/[id]/delete-requirement-button";
import { isEmailConfigured } from "@/lib/email/resend";
import { loadPositionViews } from "@/lib/positions-repo";
import { fillSummary } from "@/lib/positions";
import { PositionMatches } from "@/app/(app)/position-matches";

export default async function RequirementDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  // Everything except the candidate lookup is independent, so it all goes out at
  // once rather than in four sequential waves. isCurrentUserAdmin is
  // request-cached — the layout has already resolved it, so it costs nothing.
  const [{ data: req }, isAdmin, { count: placementCount }, positionData] = await Promise.all([
    supabase.from("job_requirements").select("*").eq("id", id).single(),
    isCurrentUserAdmin(),
    supabase
      .from("placements")
      .select("id", { count: "exact", head: true })
      .eq("source_type", "job_requirement")
      .eq("source_id", id),
    loadPositionViews(supabase, "job_requirement", id),
  ]);

  if (!req) notFound();

  const positionViews = positionData.positions;

  const fill = fillSummary(
    positionViews.map((p) => ({ id: p.id, quantity: p.quantity })),
    positionViews.flatMap((p) =>
      Array.from({ length: p.filled }, () => ({ position_id: p.id })),
    ),
  );

  // Each candidate's best score across the requirement's seats, so the overall
  // panel — which owns the Match button, export and alerts — has a shortlist.
  const matches: MatchView[] = positionData.aggregated;

  const tags: { icon: React.ReactNode; label: string }[] = [];
  if (req.required_role) tags.push({ icon: <Briefcase className="size-3.5" />, label: req.required_role });
  if (req.min_experience_years != null)
    tags.push({ icon: <Clock className="size-3.5" />, label: `${req.min_experience_years}+ yrs` });
  for (const c of req.required_certifications.slice(0, 3))
    tags.push({ icon: <Award className="size-3.5" />, label: c });
  if (req.location) tags.push({ icon: <MapPin className="size-3.5" />, label: req.location });

  return (
    <div className="space-y-6">
      <Link href="/job-requirements" className="inline-flex items-center gap-1.5 text-body-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" />
        Back to job requirements
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            {req.client && (
              <span className="text-label-sm uppercase tracking-wide text-muted-foreground">{req.client}</span>
            )}
            <RequirementStatusBadge status={req.status} />
          </div>
          <h1 className="mt-1 text-display font-semibold text-foreground">{req.title}</h1>
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
          <Button variant="outline" size="sm" render={<Link href={`/job-requirements/${id}/edit`} />} nativeButton={false}>
            <Pencil className="size-4" />
            Edit Req
          </Button>
          {isAdmin && (
            <DeleteRequirementButton
              requirementId={id}
              title={req.title}
              placementCount={placementCount ?? 0}
            />
          )}
        </div>
      </div>

      <div>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-headline-sm font-semibold text-foreground">Roles required</h2>
          <span className="text-body-sm text-muted-foreground">
            {fill.filledSeats} of {fill.totalSeats} seat{fill.totalSeats === 1 ? "" : "s"} filled
          </span>
        </div>
        <PositionMatches positions={positionViews} parentType="job_requirement" />
      </div>

      <MatchingResults
        requirementId={id}
        requirementTitle={req.title}
        matches={matches}
        hasManagerEmail={!!req.manager_email}
        emailConfigured={isEmailConfigured()}
      />
    </div>
  );
}
