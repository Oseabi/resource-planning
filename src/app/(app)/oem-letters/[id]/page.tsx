import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Pencil, Folder } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { ExpiryBadge } from "@/app/(app)/oem-letters/expiry-badge";
import {
  LetterDownloadButton,
  DeleteLetterButton,
} from "@/app/(app)/oem-letters/[id]/letter-actions";

export default async function OemLetterDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: letter }, { data: profile }] = await Promise.all([
    supabase.from("oem_letters").select("*").eq("id", id).single(),
    user
      ? supabase.from("profiles").select("role").eq("id", user.id).single()
      : Promise.resolve({ data: null }),
  ]);

  if (!letter) notFound();
  const isAdmin = profile?.role === "admin";

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link
        href="/oem-letters"
        className="inline-flex items-center gap-1.5 text-body-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Back to OEM letters
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-display font-semibold text-foreground">{letter.title}</h1>
          <p className="mt-1 text-body-lg text-muted-foreground">{letter.oem_vendor}</p>
          <div className="mt-3">
            <ExpiryBadge expiryDate={letter.expiry_date} />
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {letter.file_path && (
            <LetterDownloadButton path={letter.file_path} filename={letter.original_filename} />
          )}
          <Button
            variant="outline"
            size="sm"
            render={<Link href={`/oem-letters/${id}/edit`} />}
            nativeButton={false}
          >
            <Pencil className="size-4" />
            Edit
          </Button>
          {isAdmin && <DeleteLetterButton id={letter.id} title={letter.title} />}
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-5 shadow-card">
        <h2 className="mb-3 text-label-sm uppercase tracking-wide text-muted-foreground">
          Letter details
        </h2>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Row label="OEM / vendor" value={letter.oem_vendor} />
          <Row label="Reference number" value={letter.reference_number} />
          <Row label="Issued to" value={letter.issued_to} />
          <Row label="Issue date" value={letter.issue_date} />
          <Row label="Expiry date" value={letter.expiry_date} />
          <Row label="Document" value={letter.original_filename ?? "No file attached"} />
        </dl>
      </div>

      {letter.categories.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-5 shadow-card">
          <h2 className="mb-3 text-label-sm uppercase tracking-wide text-muted-foreground">
            Practice areas
          </h2>
          <div className="flex flex-wrap gap-2">
            {letter.categories.map((c) => (
              <Link
                key={c}
                href={`/oem-letters?by=category&folder=${encodeURIComponent(c)}`}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary/10 px-2 py-1 text-label-md font-medium text-primary hover:bg-primary/20"
              >
                <Folder className="size-3.5" />
                {c}
              </Link>
            ))}
          </div>
        </div>
      )}

      {letter.notes && (
        <div className="rounded-lg border border-border bg-card p-5 shadow-card">
          <h2 className="mb-2 text-label-sm uppercase tracking-wide text-muted-foreground">Notes</h2>
          <p className="whitespace-pre-wrap text-body-md text-foreground">{letter.notes}</p>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-label-sm uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-body-md text-foreground">{value || "—"}</dd>
    </div>
  );
}
