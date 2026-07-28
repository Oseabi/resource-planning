"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";

type OemLetterUpdate = Database["public"]["Tables"]["oem_letters"]["Update"];

const LETTER_BUCKET = "oem-letters";

export interface OemLetterFormFields {
  title: string;
  oem_vendor: string;
  categories: string[];
  reference_number: string | null;
  issued_to: string | null;
  issue_date: string | null;
  expiry_date: string | null;
  notes: string | null;
}

export type SaveLetterResult = { error: string | null; id?: string };

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100);
}

function parsePayload(formData: FormData): OemLetterFormFields {
  return JSON.parse(String(formData.get("payload") ?? "{}")) as OemLetterFormFields;
}

async function uploadLetter(file: File): Promise<{ path: string; originalName: string }> {
  const admin = createAdminClient();
  const ext = file.name.includes(".") ? file.name.split(".").pop() : "bin";
  const path = `letters/${crypto.randomUUID()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  const { error } = await admin.storage.from(LETTER_BUCKET).upload(path, buffer, {
    contentType: file.type || "application/octet-stream",
    upsert: false,
  });
  if (error) throw new Error(`Upload failed: ${error.message}`);
  return { path, originalName: sanitizeFilename(file.name) };
}

/** Shared column mapping for insert + update. */
function toColumns(fields: OemLetterFormFields) {
  return {
    title: fields.title.trim(),
    oem_vendor: fields.oem_vendor.trim(),
    categories: fields.categories,
    reference_number: fields.reference_number,
    issued_to: fields.issued_to,
    issue_date: fields.issue_date || null,
    expiry_date: fields.expiry_date || null,
    notes: fields.notes,
  };
}

export async function createOemLetter(formData: FormData): Promise<SaveLetterResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  let fields: OemLetterFormFields;
  try {
    fields = parsePayload(formData);
  } catch {
    return { error: "Invalid form data." };
  }

  if (!fields.title?.trim()) return { error: "Title is required." };
  if (!fields.oem_vendor?.trim()) return { error: "OEM / vendor is required." };

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
    .from("oem_letters")
    .insert({
      ...toColumns(fields),
      file_path: filePath,
      original_filename: fileName,
      created_by: user.id,
    })
    .select("id")
    .single();

  if (error || !data) return { error: error?.message ?? "Could not save the letter." };

  revalidatePath("/oem-letters");
  return { error: null, id: data.id };
}

export async function updateOemLetter(formData: FormData): Promise<SaveLetterResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const id = String(formData.get("letterId") ?? "");
  if (!id) return { error: "Missing letter id." };

  let fields: OemLetterFormFields;
  try {
    fields = parsePayload(formData);
  } catch {
    return { error: "Invalid form data." };
  }

  if (!fields.title?.trim()) return { error: "Title is required." };
  if (!fields.oem_vendor?.trim()) return { error: "OEM / vendor is required." };

  const updates: OemLetterUpdate = toColumns(fields);

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

  const { error } = await supabase.from("oem_letters").update(updates).eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/oem-letters");
  revalidatePath(`/oem-letters/${id}`);
  return { error: null, id };
}

export async function deleteOemLetter(id: string): Promise<{ error: string | null }> {
  const supabase = await createClient();

  const { data: letter } = await supabase
    .from("oem_letters")
    .select("file_path")
    .eq("id", id)
    .single();

  // RLS restricts DELETE to admins; a non-admin call is rejected here.
  const { error } = await supabase.from("oem_letters").delete().eq("id", id);
  if (error) return { error: error.message };

  if (letter?.file_path) {
    await createAdminClient().storage.from(LETTER_BUCKET).remove([letter.file_path]);
  }

  revalidatePath("/oem-letters");
  return { error: null };
}

export async function getSignedLetterUrl(path: string): Promise<{ url: string | null }> {
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
