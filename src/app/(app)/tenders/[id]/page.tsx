import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Pencil, Briefcase, MapPin, CalendarClock, Banknote, Clock } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { TenderStatusBadge } from "@/app/(app)/tenders/tender-badges";
import { CvDownloadButton } from "@/app/(app)/candidates/[id]/cv-download-button";
import { DeleteTenderButton } from "@/app/(app)/tenders/[id]/delete-tender-button";
import {
  TenderMatchingResults,
  type TenderMatchView,
} from "@/app/(app)/tenders/[id]/tender-matching-results";
import { poolStrength, poolGapAnalysis } from "@/lib/matching";

function formatValue(value: number | null): string {
  if (value == null) return "—";
  if (value >= 1_000_000) return `R${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `R${(value / 1_000).toFixed(0)}k`;
  return `R${value}`;
}

export default async function TenderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: tender }, { data: profile }] = await Promise.all([
    supabase.from("tenders").select("*").eq("id", id).single(),
    user
      ? supabase.from("profiles").select("role").eq("id", user.id).single()
      : Promise.resolve({ data: null }),
  ]);
  if (!tender) notFound();
  const isAdmin = profile?.role === "admin";

  const { data: matchRows } = await supabase
    .from("matches")
    .select("id, candidate_id, score")
    .eq("match_target_type", "tender")
    .eq("match_target_id", id)
    .order("score", { ascending: false });

  const candidateIds = (matchRows ?? []).map((m) => m.candidate_id);
  const candById = new Map<string, { full_name: string; current_role: string | null }>();
  if (candidateIds.length) {
    const { data: cands } = await supabase
      .from("candidates")
      .select("id, full_name, current_role")
      .in("id", candidateIds);
    for (const c of cands ?? []) candById.set(c.id, { full_name: c.full_name, current_role: c.current_role });
  }

  const matches: TenderMatchView[] = (matchRows ?? []).map((m) => ({
    matchId: m.id,
    candidateId: m.candidate_id,
    name: candById.get(m.candidate_id)?.full_name ?? "Unknown candidate",
    role: candById.get(m.candidate_id)?.current_role ?? null,
    score: m.score,
  }));

  // Pool gap analysis over active candidates (local, free).
  const { data: activeCandidates } = await supabase
    .from("candidates")
    .select("current_role, additional_roles, skills, technical_skills, certifications, years_experience, availability")
    .eq("status", "active");
  const poolGaps = poolGapAnalysis(activeCandidates ?? [], tender);
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
