import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Pencil, FileCheck2, AlertTriangle, Folder } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { isCurrentUserAdmin } from "@/lib/auth/current-user";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/availability";
import { isContactable, letterKindLabel, UNFILED } from "@/lib/reference-letters";
import { KindChip } from "@/app/(app)/reference-letters/kind-chip";
import { CvDownloadButton } from "@/app/(app)/candidates/[id]/cv-download-button";
import { DeleteReferenceLetterButton } from "@/app/(app)/reference-letters/[id]/delete-button";

function formatValue(value: number | null): string {
  if (value == null) return "Not recorded";
  if (value >= 1_000_000) return `R${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `R${(value / 1_000).toFixed(0)}k`;
  return `R${value}`;
}

export default async function ReferenceLetterPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const [{ data: letter }, isAdmin] = await Promise.all([
    supabase.from("reference_letters").select("*").eq("id", id).single(),
    isCurrentUserAdmin(),
  ]);
  if (!letter) notFound();

  const contactable = isContactable(letter);

  return (
    <div className="space-y-6">
      <Link
        href="/reference-letters"
        className="inline-flex items-center gap-1.5 text-body-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Back to reference letters
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <span className="text-label-sm uppercase tracking-wide text-muted-foreground">
            {letter.client}
          </span>
          <h1 className="mt-1 text-display font-semibold text-foreground">
            {letter.project_title}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-body-sm text-muted-foreground">
            <KindChip kind={letter.kind} />
            <span className="inline-flex items-center gap-1.5">
              <Folder className="size-3.5" />
              {letter.folder ?? UNFILED}
            </span>
            {letter.reference_number && (
              <span className="font-mono">Ref. {letter.reference_number}</span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {letter.file_path && (
            <CvDownloadButton
              path={letter.file_path}
              filename={letter.original_filename ?? "Reference letter"}
            />
          )}
          <Button
            variant="outline"
            size="sm"
            render={<Link href={`/reference-letters/${id}/edit`} />}
            nativeButton={false}
          >
            <Pencil className="size-4" />
            Edit
          </Button>
          {isAdmin && (
            <DeleteReferenceLetterButton letterId={id} letterTitle={letter.project_title} />
          )}
        </div>
      </div>

      {/* Proof of a contract is not a client vouching for the work. Said up
          front, because it is the one letter a bid writer must not count. */}
      {letter.kind !== "reference" && (
        <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-4">
          <FileCheck2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div>
            <p className="text-body-md font-medium text-foreground">{letterKindLabel(letter.kind)}</p>
            <p className="text-body-sm text-muted-foreground">
              {letter.kind === "award"
                ? "An award, appointment or offer letter: proof that the contract was won, with nobody vouching for the work. It sits on file for a bid pack and does not count toward a tender's reference requirement."
                : "A client confirming an appointment or supplier status without speaking to the work. It sits on file for a bid pack and does not count toward a tender's reference requirement."}
            </p>
          </div>
        </div>
      )}

      {/* A reference nobody can ring does not answer a tender that asks for
          contactable references, so it is said plainly rather than left for
          somebody to notice while assembling a bid pack. */}
      {letter.kind === "reference" && !contactable && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
          <div>
            <p className="text-body-md font-medium text-foreground">No contact details</p>
            <p className="text-body-sm text-muted-foreground">
              Tenders ask for contactable references, so this letter does not count toward a
              requirement until it has an email address or a phone number.
            </p>
          </div>
        </div>
      )}

      {!letter.file_path && (
        <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-4">
          <FileCheck2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <p className="text-body-sm text-muted-foreground">
            No signed letter attached. The details are recorded, but there is nothing to put into a
            bid pack.
          </p>
        </div>
      )}

      <div className="rounded-lg border border-border bg-card shadow-card">
        <dl className="divide-y divide-border">
          <Row label="Client" value={letter.client} />
          <Row label="Project" value={letter.project_title} />
          <Row label="Kind" value={letterKindLabel(letter.kind)} />
          <Row label="Folder" value={letter.folder ?? UNFILED} />
          <Row label="Contract value" value={formatValue(letter.contract_value)} />
          <Row
            label="Work period"
            value={
              letter.work_started_on || letter.work_completed_on
                ? `${letter.work_started_on ? formatDate(letter.work_started_on) : "unknown start"} to ${
                    letter.work_completed_on ? formatDate(letter.work_completed_on) : "unknown end"
                  }`
                : "Not recorded"
            }
          />
          <Row
            label="Letter date"
            value={letter.issue_date ? formatDate(letter.issue_date) : "Not recorded"}
          />
          <Row label="Contact" value={letter.contact_name ?? "Not recorded"} />
          <Row label="Email" value={letter.contact_email ?? "Not recorded"} />
          <Row label="Phone" value={letter.contact_phone ?? "Not recorded"} />
          <Row
            label="Practice areas"
            value={letter.categories.length > 0 ? letter.categories.join(", ") : "None"}
          />
          <Row
            label="Sectors"
            value={letter.sectors.length > 0 ? letter.sectors.join(", ") : "None"}
          />
          {letter.notes && <Row label="Notes" value={letter.notes} />}
        </dl>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-1 gap-1 px-4 py-3 sm:grid-cols-3">
      <dt className="text-label-md font-medium text-muted-foreground">{label}</dt>
      <dd className="text-body-md text-foreground sm:col-span-2">{value}</dd>
    </div>
  );
}
