import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { EditCandidateForm } from "@/app/(app)/candidates/[id]/edit/edit-candidate-form";
import type { CandidateFormFields } from "@/app/(app)/candidates/actions";

export default async function EditCandidatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: candidate } = await supabase.from("candidates").select("*").eq("id", id).single();

  if (!candidate) notFound();

  const initial: CandidateFormFields = {
    full_name: candidate.full_name,
    email: candidate.email,
    phone: candidate.phone,
    current_role: candidate.current_role,
    additional_roles: candidate.additional_roles,
    years_experience: candidate.years_experience,
    professional_summary: candidate.professional_summary,
    availability: candidate.availability,
    status: candidate.status,
    location: candidate.location,
    notes: candidate.notes,
    skills: candidate.skills,
    technical_skills: candidate.technical_skills,
    certifications: candidate.certifications,
    qualifications: candidate.qualifications,
    sectors: candidate.sectors,
    languages: candidate.languages,
    resource_categories: candidate.resource_categories,
    linkedin_url: candidate.linkedin_url,
    portfolio_url: candidate.portfolio_url,
    work_experience: candidate.work_experience,
    education: candidate.education,
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link
        href={`/candidates/${id}`}
        className="inline-flex items-center gap-1.5 text-body-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Back to profile
      </Link>
      <div>
        <h1 className="text-display font-semibold text-foreground">Edit candidate</h1>
        <p className="mt-1 text-body-lg text-muted-foreground">
          Update {candidate.full_name}&apos;s details, or replace their CV to re-extract fields.
        </p>
      </div>
      <EditCandidateForm
        candidateId={id}
        initial={initial}
        currentCvName={candidate.cv_original_filename}
      />
    </div>
  );
}
