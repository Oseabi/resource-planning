"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/app/(app)/audit-actions";
import { recordEvent } from "@/app/(app)/activity-actions";
import {
  attachmentContentType,
  attachmentFileError,
  attachmentKindLabel,
  attachmentStoragePath,
  isAttachmentKind,
} from "@/lib/candidate-attachments";
import type { CandidateAttachmentKind } from "@/lib/supabase/database.types";
import { discardStoredFile, storeCandidateFile, type StoredFile } from "@/lib/candidate-file-store";

// Shares the private cvs bucket rather than adding a fourth. Tender documents
// already live in it under tenders/ and the CVs under candidates/; documents on
// a person's file live under attachments/. It also means deleteCandidate clears
// the CV and every attachment in one call, because they are in the same bucket.
const ATTACHMENT_BUCKET = "cvs";

// A "use server" module can only export async functions, so this is the fourth
// copy of a one-line helper rather than an import. A shared src/lib/filenames.ts
// would be the tidy-up, and is not this change.
function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100);
}

export type AttachmentResult = { error: string | null; id?: string };

/**
 * Attach a document to a person's file.
 *
 * The file is required, unlike the letters modules where a row of metadata
 * stands on its own: an attachment is the file. It goes to storage with the
 * service-role client, because the bucket is private and has no object
 * policies, but the row is inserted through the caller's own client so the
 * insert policy applies.
 */
export async function uploadCandidateAttachment(formData: FormData): Promise<AttachmentResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const candidateId = String(formData.get("candidateId") ?? "");
  if (!candidateId) return { error: "Missing candidate id." };

  let fields: { kind: CandidateAttachmentKind; title: string };
  try {
    fields = JSON.parse(String(formData.get("payload") ?? "{}"));
  } catch {
    return { error: "Invalid form data." };
  }

  if (!isAttachmentKind(fields.kind)) return { error: "Pick what kind of document this is." };
  const title = fields.title?.trim();
  if (!title) return { error: "Give the document a title." };

  const file = formData.get("file");
  if (!(file instanceof File)) return { error: "Choose a file to attach." };
  // The dialog runs this too, so nobody waits for a round trip to be told. It
  // runs again here because the dialog's copy is a convenience, not a gate.
  const fileError = attachmentFileError(file);
  if (fileError) return { error: fileError };

  let stored: StoredFile;
  try {
    stored = await storeCandidateFile(file, candidateId, attachmentStoragePath(crypto.randomUUID(), file.name),
                                      attachmentContentType(file.name, file.type));
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Upload failed." };
  }

  const { data, error } = await supabase
    .from("candidate_attachments")
    .insert({
      candidate_id: candidateId,
      kind: fields.kind,
      title,
      ...(stored.kind === "drive"
        ? { drive_id: stored.driveId, drive_item_id: stored.itemId, file_path: null }
        : { file_path: stored.path }),
      original_filename: sanitizeFilename(file.name) || "document",
      created_by: user.id,
    })
    .select("id")
    .single();

  if (error || !data) {
    // The path existed only in the row that just failed, so without this the
    // object is an orphan nobody can ever find, let alone remove.
    await discardStoredFile(stored);
    return { error: error?.message ?? "Could not attach the document." };
  }

  await recordAudit({
    action: "created",
    entityType: "candidate_attachment",
    entityId: data.id,
    entityLabel: title,
    detail: { kind: fields.kind, candidate_id: candidateId },
  });

  // The label rather than the stored value, because the timeline prints a
  // detail's scalars verbatim.
  await recordEvent("candidate", candidateId, "document_attached", {
    kind: attachmentKindLabel(fields.kind),
    title,
  });

  revalidatePath(`/candidates/${candidateId}`);
  return { error: null, id: data.id };
}

/** Remove a document and the file behind it. Admins, and whoever attached it. */
export async function deleteCandidateAttachment(
  attachmentId: string,
): Promise<{ error: string | null }> {
  const supabase = await createClient();

  // Read before deleting: the path, the label and the page to revalidate are
  // all on the row that is about to go.
  const { data: attachment } = await supabase
    .from("candidate_attachments")
    .select("candidate_id, title, kind, file_path")
    .eq("id", attachmentId)
    .single();
  if (!attachment) return { error: "That document is no longer there." };

  // Counted, not assumed. The delete policy is admin-or-uploader, and a
  // filtered-out delete comes back with zero rows and NO error; falling
  // through would remove the file from storage with the service-role client
  // while the row survives pointing at nothing.
  const { data: deleted, error } = await supabase
    .from("candidate_attachments")
    .delete()
    .eq("id", attachmentId)
    .select("id");
  if (error) return { error: error.message };
  if (!deleted || deleted.length === 0) {
    return { error: "You can only remove a document you attached, unless you are an admin." };
  }

  await recordAudit({
    action: "deleted",
    entityType: "candidate_attachment",
    entityId: attachmentId,
    entityLabel: attachment.title,
    detail: { kind: attachment.kind, candidate_id: attachment.candidate_id },
  });

  // Deliberately no purgeActivity, which both letters modules call here. An
  // attachment is not an activity entity, so the only thing that call could
  // name is the candidate, and it would wipe their whole timeline.
  await recordEvent("candidate", attachment.candidate_id, "document_removed", {
    kind: attachmentKindLabel(attachment.kind),
    title: attachment.title,
  });

  // A SharePoint file stays in the library; only a bucket copy is removed.
  if (attachment.file_path) {
    await createAdminClient().storage.from(ATTACHMENT_BUCKET).remove([attachment.file_path]);
  }

  revalidatePath(`/candidates/${attachment.candidate_id}`);
  return { error: null };
}
