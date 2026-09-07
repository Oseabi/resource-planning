import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { ReferenceLetterForm } from "@/app/(app)/reference-letters/letter-form";

export default async function EditReferenceLetterPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: letter } = await supabase
    .from("reference_letters")
    .select("*")
    .eq("id", id)
    .single();
  if (!letter) notFound();

  return (
    <div className="space-y-6">
      <Link
        href={`/reference-letters/${id}`}
        className="inline-flex items-center gap-1.5 text-body-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Back to the letter
      </Link>
      <h1 className="text-display font-semibold text-foreground">Edit reference letter</h1>
      <ReferenceLetterForm
        letterId={id}
        currentFileName={letter.original_filename}
        initial={{
          client: letter.client,
          project_title: letter.project_title,
          categories: letter.categories,
          sectors: letter.sectors,
          contract_value: letter.contract_value,
          work_started_on: letter.work_started_on,
          work_completed_on: letter.work_completed_on,
          issue_date: letter.issue_date,
          contact_name: letter.contact_name,
          contact_email: letter.contact_email,
          contact_phone: letter.contact_phone,
          reference_number: letter.reference_number,
          notes: letter.notes,
        }}
      />
    </div>
  );
}
