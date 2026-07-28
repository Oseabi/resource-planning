import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { LetterForm } from "@/app/(app)/oem-letters/letter-form";
import type { OemLetterFormFields } from "@/app/(app)/oem-letters/actions";

export default async function EditOemLetterPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: letter } = await supabase.from("oem_letters").select("*").eq("id", id).single();

  if (!letter) notFound();

  const initial: OemLetterFormFields = {
    title: letter.title,
    oem_vendor: letter.oem_vendor,
    categories: letter.categories,
    reference_number: letter.reference_number,
    issued_to: letter.issued_to,
    issue_date: letter.issue_date,
    expiry_date: letter.expiry_date,
    notes: letter.notes,
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link
        href={`/oem-letters/${id}`}
        className="inline-flex items-center gap-1.5 text-body-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Back to letter
      </Link>
      <div>
        <h1 className="text-display font-semibold text-foreground">Edit OEM letter</h1>
        <p className="mt-1 text-body-lg text-muted-foreground">
          Update {letter.title}, or replace the stored document.
        </p>
      </div>
      <LetterForm
        letterId={id}
        initial={initial}
        currentFileName={letter.original_filename}
      />
    </div>
  );
}
