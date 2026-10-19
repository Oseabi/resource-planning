import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Pencil } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/current-user";
import { Button } from "@/components/ui/button";
import { StatusBadge, AvailabilityBadge } from "@/app/(app)/candidates/candidate-badges";
import { availableFrom } from "@/lib/availability";
import { loadActivity } from "@/app/(app)/activity-actions";
import { ActivityTimeline } from "@/components/activity/activity-timeline";
import { loadDeployments } from "@/lib/deployments-repo";
import { DeploymentsPanel } from "@/app/(app)/candidates/[id]/deployments-panel";
import { TippCvButton } from "@/app/(app)/candidates/[id]/tipp-cv-button";
import { missingTemplateFields, type CvSource } from "@/lib/cv-export/build-tipp-cv";
import { CandidateCvView, Card, Chips } from "@/app/(app)/candidates/[id]/cv-view";
import { CvDownloadButton } from "@/app/(app)/candidates/[id]/cv-download-button";
import { CandidateAttachments } from "@/app/(app)/candidates/[id]/attachments-list";
import { AttachmentUploadDialog } from "@/app/(app)/candidates/[id]/attachment-upload-dialog";
import { certificateTitleSuggestions } from "@/lib/candidate-attachments";
import { DeleteCandidateButton } from "@/app/(app)/candidates/[id]/delete-candidate-button";
import { DepartmentChips } from "@/components/departments/department-chip";
import { loadDepartmentContext } from "@/lib/departments-repo";

export default async function CandidateProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  // getCurrentProfile is request-cached: the layout has already resolved it, so
  // this adds no round-trip. It carries the viewer's id as well as their role,
  // and the id is what decides who sees a document's remove control.
  const [
    { data: candidate },
    profile,
    { data: placements },
    activity,
    deployments,
    departments,
    { data: attachments },
  ] = await Promise.all([
    supabase.from("candidates").select("*").eq("id", id).single(),
    getCurrentProfile(),
    // Company wide. "When are they next free" is a question about the
    // person, not about one department's book of work.
    supabase.rpc("candidate_commitments").eq("candidate_id", id),
    loadActivity("candidate", id),
    loadDeployments(supabase, id),
    loadDepartmentContext(),
    // The documents on this person's file. Ascending, so each heading reads in
    // the order they were attached; the grouping into headings is done in the
    // pure module so it can be asserted without a database.
    supabase
      .from("candidate_attachments")
      .select("*")
      .eq("candidate_id", id)
      .order("created_at", { ascending: true }),
  ]);

  if (!candidate) notFound();

  const isAdmin = profile?.isAdmin ?? false;

  // The availability badge says what they are today; this says when they are
  // next free, which is the question anyone planning a bid team is asking.
  const freeFrom = availableFrom(candidate, placements ?? []);

  // Worked out on the server so the warning is ready before the button is
  // pressed, rather than after the document has already been built.
  const missingForTemplate = missingTemplateFields(candidate as unknown as CvSource);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link href="/candidates" className="inline-flex items-center gap-1.5 text-body-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" />
        Back to candidates
      </Link>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-display font-semibold text-foreground">{candidate.full_name}</h1>
          <p className="mt-1 text-body-lg text-muted-foreground">
            {candidate.current_role ?? "No role set"}
            {candidate.location ? ` · ${candidate.location}` : ""}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <StatusBadge status={candidate.status} />
            <AvailabilityBadge availability={candidate.availability} />
            {candidate.years_experience != null && (
              <span className="text-body-sm text-muted-foreground">{candidate.years_experience} yrs experience</span>
            )}
            {/* Where they are filed. A person filed nowhere is said so, with the
                way to fix it, rather than left looking like everyone else. */}
            <DepartmentChips ids={candidate.department_ids ?? []} departments={departments.all} emptyLabel="No department" />
            {(candidate.department_ids ?? []).length === 0 && (
              <Link href={`/candidates/${id}/edit`} className="text-body-sm text-primary underline">
                File under a department
              </Link>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {candidate.cv_file_path && (
            <CvDownloadButton path={candidate.cv_file_path} filename={candidate.cv_original_filename} />
          )}
          <TippCvButton
            candidateId={candidate.id}
            candidateName={candidate.full_name}
            missingFields={missingForTemplate}
            brandName={departments.active?.name ?? null}
          />
          <Button variant="outline" size="sm" render={<Link href={`/candidates/${id}/edit`} />} nativeButton={false}>
            <Pencil className="size-4" />
            Edit
          </Button>
          {isAdmin && <DeleteCandidateButton candidateId={candidate.id} candidateName={candidate.full_name} />}
        </div>
      </div>

      {/* Above everything else on purpose: "where is this person right now"
          is the first question anyone opening a profile is asking. */}
      <DeploymentsPanel deployments={deployments} />

      <CandidateCvView candidate={candidate} freeFrom={freeFrom} />

      {/* The system's own sections. */}
      {(candidate.resource_categories.length > 0 || candidate.sectors.length > 0 || candidate.additional_roles.length > 0) && (
        <Card title="Matching profile">
          <div className="space-y-3">
            {candidate.resource_categories.length > 0 && (
              <div>
                <div className="mb-1 text-label-sm font-medium text-muted-foreground">Resource categories</div>
                <div className="flex flex-wrap gap-1.5">
                  {candidate.resource_categories.map((cat) => (
                    <span key={cat} className="inline-flex items-center rounded-lg bg-primary/10 px-2 py-0.5 text-label-md font-medium text-primary">
                      {cat}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {candidate.sectors.length > 0 && (
              <div>
                <div className="mb-1 text-label-sm font-medium text-muted-foreground">Sectors</div>
                <Chips tags={candidate.sectors} />
              </div>
            )}
            {candidate.additional_roles.length > 0 && (
              <div>
                <div className="mb-1 text-label-sm font-medium text-muted-foreground">Additional roles</div>
                <Chips tags={candidate.additional_roles} />
              </div>
            )}
          </div>
        </Card>
      )}

      <Card
        title="Documents"
        action={
          <AttachmentUploadDialog
            candidateId={candidate.id}
            certificateNames={certificateTitleSuggestions(candidate.certificates)}
          />
        }
      >
        <div className="space-y-4">
          {/* The CV keeps its own line at the top. It is deliberately not one
              of the six kinds: it lives on the candidate row, it is what the
              TiPP CV is generated from, and a new one replaces it rather than
              adding to the pile. */}
          <div>
            <h3 className="mb-1.5 text-label-sm font-medium text-muted-foreground">CV</h3>
            {candidate.cv_file_path ? (
              <CvDownloadButton path={candidate.cv_file_path} filename={candidate.cv_original_filename} />
            ) : (
              <p className="text-body-sm text-muted-foreground">No CV on file.</p>
            )}
          </div>
          <CandidateAttachments
            attachments={attachments ?? []}
            viewerId={profile?.id ?? null}
            isAdmin={isAdmin}
          />
        </div>
      </Card>

      {candidate.notes && (
        <Card title="Notes">
          <p className="whitespace-pre-wrap text-body-sm text-foreground">{candidate.notes}</p>
        </Card>
      )}

      <ActivityTimeline entityType="candidate" entityId={id} entries={activity} />
    </div>
  );
}
