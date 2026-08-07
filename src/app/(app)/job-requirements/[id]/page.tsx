import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Pencil, Briefcase, Award, Clock, MapPin } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { RequirementStatusBadge } from "@/app/(app)/job-requirements/requirement-badges";
import { MatchingResults, type MatchView } from "@/app/(app)/job-requirements/[id]/matching-results";
import { DeleteRequirementButton } from "@/app/(app)/job-requirements/[id]/delete-requirement-button";
import { isEmailConfigured } from "@/lib/email/resend";

interface BreakdownParts {
  role: number;
  skills: number;
  certifications: number;
  experience: number;
  availability: number;
}

export default async function RequirementDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: req } = await supabase.from("job_requirements").select("*").eq("id", id).single();
  if (!req) notFound();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profile } = user
    ? await supabase.from("profiles").select("role").eq("id", user.id).single()
    : { data: null };
  const isAdmin = profile?.role === "admin";

  // Deleting the requirement also deletes these, so the count is surfaced first.
  const { count: placementCount } = await supabase
    .from("placements")
    .select("id", { count: "exact", head: true })
    .eq("source_type", "job_requirement")
    .eq("source_id", id);

  const { data: matchRows } = await supabase
    .from("matches")
    .select("id, candidate_id, score, score_breakdown, alert_sent")
    .eq("match_target_type", "job_requirement")
    .eq("match_target_id", id)
    .order("score", { ascending: false });

  const candidateIds = (matchRows ?? []).map((m) => m.candidate_id);
  const candById = new Map<string, { full_name: string; current_role: string | null; status: string }>();
  if (candidateIds.length) {
    const { data: cands } = await supabase
      .from("candidates")
      .select("id, full_name, current_role, status")
      .in("id", candidateIds);
    for (const c of cands ?? []) {
      candById.set(c.id, { full_name: c.full_name, current_role: c.current_role, status: c.status });
    }
  }

  const matches: MatchView[] = (matchRows ?? []).map((m) => {
    const sb = (m.score_breakdown ?? {}) as {
      breakdown?: BreakdownParts;
      points?: BreakdownParts;
    };
    const cand = candById.get(m.candidate_id);
    const zero = { role: 0, skills: 0, certifications: 0, experience: 0, availability: 0 };
    return {
      matchId: m.id,
      candidateId: m.candidate_id,
      name: cand?.full_name ?? "Unknown candidate",
      role: cand?.current_role ?? null,
      status: cand?.status ?? "active",
      score: m.score,
      breakdown: sb.breakdown ?? zero,
      points: sb.points ?? zero,
      alertSent: m.alert_sent,
    };
  });

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
