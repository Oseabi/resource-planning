import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { TenderForm } from "@/app/(app)/tenders/tender-form";
import type { TenderFormFields } from "@/app/(app)/tenders/actions";
import { loadPositions, toPositionInputs } from "@/lib/positions-repo";

export default async function EditTenderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const [{ data: tender }, positionRows] = await Promise.all([
    supabase.from("tenders").select("*").eq("id", id).single(),
    loadPositions(supabase, "tender", id),
  ]);
  if (!tender) notFound();

  const initial: TenderFormFields = {
    title: tender.title,
    positions: toPositionInputs(positionRows),
    reference_number: tender.reference_number,
    client: tender.client,
    location: tender.location,
    value: tender.value,
    submission_deadline: tender.submission_deadline,
    contract_start_date: tender.contract_start_date,
    required_roles: tender.required_roles,
    required_skills: tender.required_skills,
    required_certifications: tender.required_certifications,
    sectors: tender.sectors,
    min_experience_years: tender.min_experience_years,
    status: tender.status,
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link href={`/tenders/${id}`} className="inline-flex items-center gap-1.5 text-body-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" />
        Back to tender
      </Link>
      <div>
        <h1 className="text-display font-semibold text-foreground">Edit tender</h1>
      </div>
      <TenderForm mode="edit" tenderId={id} initial={initial} />
    </div>
  );
}
