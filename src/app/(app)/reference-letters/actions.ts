"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";

type ReferenceLetterUpdate = Database["public"]["Tables"]["reference_letters"]["Update"];

// Shares the OEM letters bucket rather than adding a third. Both are bid
// attachments with the same access rules, and a separate bucket would mean
// another set of policies to keep in step for no gain. Paths are prefixed so
// the two never collide.
const LETTER_BUCKET = "oem-letters";

export interface ReferenceLetterFormFields {
  client: string;
  project_title: string;
  categories: string[];
  sectors: string[];
  contract_value: number | null;
  work_started_on: string | null;
  work_completed_on: string | null;
  issue_date: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  reference_number: string | null;
  notes: string | null;
}

export type SaveReferenceLetterResult = { error: string | null; id?: string };

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100);
}

function parsePayload(formData: FormData): ReferenceLetterFormFields {
  return JSON.parse(String(formData.get("payload") ?? "{}")) as ReferenceLetterFormFields;
}

async function uploadLetter(file: File): Promise<{ path: string; originalName: string }> {
  const admin = createAdminClient();
  const ext = file.name.includes(".") ? file.name.split(".").pop() : "bin";
  const path = `references/${crypto.randomUUID()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  const { error } = await admin.storage.from(LETTER_BUCKET).upload(path, buffer, {
    contentType: file.type || "application/octet-stream",
    upsert: false,
  });
  if (error) throw new Error(`Upload failed: ${error.message}`);
  return { path, originalName: sanitizeFilename(file.name) };
}

/** Shared column mapping for insert and update. */
function toColumns(fields: ReferenceLetterFormFields) {
  return {
    client: fields.client.trim(),
    project_title: fields.project_title.trim(),
    categories: fields.categories,
    sectors: fields.sectors,
    contract_value: fields.contract_value,
    work_started_on: fields.work_started_on || null,
    work_completed_on: fields.work_completed_on || null,
    issue_date: fields.issue_date || null,
    contact_name: fields.contact_name,
    contact_email: fields.contact_email,
    contact_phone: fields.contact_phone,
    reference_number: fields.reference_number,
    notes: fields.notes,
  };
}

function validate(fields: ReferenceLetterFormFields): string | null {
  if (!fields.client?.trim()) return "Client is required.";
  if (!fields.project_title?.trim()) return "Project is required.";
  if (
    fields.work_started_on &&
    fields.work_completed_on &&
    fields.work_completed_on < fields.work_started_on
  ) {
    return "The work cannot finish before it starts.";
  }
  return null;
}

export async function createReferenceLetter(
  formData: FormData,
): Promise<SaveReferenceLetterResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  let fields: ReferenceLetterFormFields;
  try {
    fields = parsePayload(formData);
  } catch {
    return { error: "Invalid form data." };
  }

  const invalid = validate(fields);
  if (invalid) return { error: invalid };

  let filePath: string | null = null;
  let fileName: string | null = null;
  const file = formData.get("file");
  if (file instanceof File && file.size > 0) {
    try {
      const uploaded = await uploadLetter(file);
      filePath = uploaded.path;
      fileName = uploaded.originalName;
    } catch (e) {
      return { error: e instanceof Error ? e.message : "Upload failed." };
    }
  }

  const { data, error } = await supabase
    .from("reference_letters")
    .insert({
      ...toColumns(fields),
      file_path: filePath,
      original_filename: fileName,
      created_by: user.id,
    })
    .select("id")
    .single();

  if (error || !data) return { error: error?.message ?? "Could not save the letter." };

  revalidatePath("/reference-letters");
  // Every tender's compliance line counts these.
  revalidatePath("/tenders");
  return { error: null, id: data.id };
}

export async function updateReferenceLetter(
  formData: FormData,
): Promise<SaveReferenceLetterResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const id = String(formData.get("letterId") ?? "");
  if (!id) return { error: "Missing letter id." };

  let fields: ReferenceLetterFormFields;
  try {
    fields = parsePayload(formData);
  } catch {
    return { error: "Invalid form data." };
  }

  const invalid = validate(fields);
  if (invalid) return { error: invalid };

  const updates: ReferenceLetterUpdate = toColumns(fields);

  const file = formData.get("file");
  if (file instanceof File && file.size > 0) {
    try {
      const uploaded = await uploadLetter(file);
      updates.file_path = uploaded.path;
      updates.original_filename = uploaded.originalName;
    } catch (e) {
      return { error: e instanceof Error ? e.message : "Upload failed." };
    }
  }

  const { error } = await supabase.from("reference_letters").update(updates).eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/reference-letters");
  revalidatePath(`/reference-letters/${id}`);
  revalidatePath("/tenders");
  return { error: null, id };
}

export async function deleteReferenceLetter(id: string): Promise<{ error: string | null }> {
  const supabase = await createClient();

  const { data: letter } = await supabase
    .from("reference_letters")
    .select("file_path")
    .eq("id", id)
    .single();

  // Counted, not assumed. A delete RLS filters out returns zero rows and NO
  // error, and falling through would remove the signed letter from storage
  // with the service-role client while the record survives pointing at
  // nothing, which is the one state a bid pack cannot recover from.
  const { data: deleted, error } = await supabase
    .from("reference_letters")
    .delete()
    .eq("id", id)
    .select("id");
  if (error) return { error: error.message };
  if (!deleted || deleted.length === 0) {
    return { error: "Only admins can delete a reference letter." };
  }

  if (letter?.file_path) {
    await createAdminClient().storage.from(LETTER_BUCKET).remove([letter.file_path]);
  }

  revalidatePath("/reference-letters");
  revalidatePath("/tenders");
  return { error: null };
}

export async function getSignedReferenceUrl(path: string): Promise<{ url: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { url: null };

  const { data } = await createAdminClient()
    .storage.from(LETTER_BUCKET)
    .createSignedUrl(path, 120); // 2-minute link
  return { url: data?.signedUrl ?? null };
}
