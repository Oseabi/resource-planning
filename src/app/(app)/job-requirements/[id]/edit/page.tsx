import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { RequirementForm } from "@/app/(app)/job-requirements/requirement-form";
import type { RequirementFormFields } from "@/app/(app)/job-requirements/actions";
import { loadPositions, toPositionInputs } from "@/lib/positions-repo";

export default async function EditRequirementPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const [{ data: req }, positionRows] = await Promise.all([
    supabase.from("job_requirements").select("*").eq("id", id).single(),
    loadPositions(supabase, "job_requirement", id),
  ]);
  if (!req) notFound();

  const initial: RequirementFormFields = {
    title: req.title,
    positions: toPositionInputs(positionRows),
    client: req.client,
    required_role: req.required_role,
    required_skills: req.required_skills,
    required_certifications: req.required_certifications,
    required_qualifications: req.required_qualifications,
    sectors: req.sectors,
    min_experience_years: req.min_experience_years,
    location: req.location,
    required_availability: req.required_availability,
    manager_email: req.manager_email,
    status: req.status,
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link href={`/job-requirements/${id}`} className="inline-flex items-center gap-1.5 text-body-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" />
        Back to requirement
      </Link>
      <div>
        <h1 className="text-display font-semibold text-foreground">Edit job requirement</h1>
      </div>
      <RequirementForm mode="edit" requirementId={id} initial={initial} />
    </div>
  );
}
