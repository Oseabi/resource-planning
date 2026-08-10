"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type {
  CandidateAvailability,
  CandidateStatus,
  Database,
  WorkExperience,
  Education,
} from "@/lib/supabase/database.types";

type CandidateUpdate = Database["public"]["Tables"]["candidates"]["Update"];

const CV_BUCKET = "cvs";

export interface CandidateFormFields {
  full_name: string;
  email: string | null;
  phone: string | null;
  current_role: string | null;
  additional_roles: string[];
  years_experience: number | null;
  professional_summary: string | null;
  availability: CandidateAvailability;
  /** Manual override for when they next come free; null means now. */
  available_from: string | null;
  status: CandidateStatus;
  location: string | null;
  notes: string | null;
  skills: string[];
  technical_skills: string[];
  certifications: string[];
  qualifications: string[];
  sectors: string[];
  languages: string[];
  resource_categories: string[];
  linkedin_url: string | null;
  portfolio_url: string | null;
  work_experience: WorkExperience[];
  education: Education[];
}

export interface DuplicateMatch {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
}

export type SaveCandidateState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "duplicate"; match: DuplicateMatch }
  | { status: "success"; candidateId: string };

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100);
}

async function findDuplicate(
  supabase: Awaited<ReturnType<typeof createClient>>,
  email: string | null,
  phone: string | null,
  excludeId?: string,
): Promise<DuplicateMatch | null> {
  const filters: string[] = [];
  if (email) filters.push(`email.eq.${email}`);
  if (phone) filters.push(`phone.eq.${phone}`);
  if (filters.length === 0) return null;

  let query = supabase
    .from("candidates")
    .select("id, full_name, email, phone")
    .or(filters.join(","))
    .limit(1);
  if (excludeId) query = query.neq("id", excludeId);

  const { data } = await query;
  return data && data.length > 0 ? data[0] : null;
}

async function uploadCv(
  file: File,
  candidateHint: string,
): Promise<{ path: string; originalName: string }> {
  const admin = createAdminClient();
  const ext = file.name.includes(".") ? file.name.split(".").pop() : "bin";
  const path = `${candidateHint}/${crypto.randomUUID()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  const { error } = await admin.storage.from(CV_BUCKET).upload(path, buffer, {
    contentType: file.type || "application/octet-stream",
    upsert: false,
  });
  if (error) throw new Error(`CV upload failed: ${error.message}`);
  return { path, originalName: sanitizeFilename(file.name) };
}

function parsePayload(formData: FormData): { fields: CandidateFormFields; force: boolean } {
  const raw = String(formData.get("payload") ?? "{}");
  const parsed = JSON.parse(raw) as CandidateFormFields & { force?: boolean };
  const { force = false, ...fields } = parsed;
  return { fields, force };
}

/** Map the form contract to candidate table columns (shared by insert + update). */
function toCandidateColumns(fields: CandidateFormFields): CandidateUpdate & { full_name: string } {
  return {
    full_name: fields.full_name.trim(),
    email: fields.email,
    phone: fields.phone,
    current_role: fields.current_role,
    additional_roles: fields.additional_roles,
    years_experience: fields.years_experience,
    professional_summary: fields.professional_summary,
    availability: fields.availability,
    available_from: fields.available_from,
    status: fields.status,
    location: fields.location,
    notes: fields.notes,
    skills: fields.skills,
    technical_skills: fields.technical_skills,
    certifications: fields.certifications,
    qualifications: fields.qualifications,
    sectors: fields.sectors,
    languages: fields.languages,
    resource_categories: fields.resource_categories,
    linkedin_url: fields.linkedin_url,
    portfolio_url: fields.portfolio_url,
    work_experience: fields.work_experience,
    education: fields.education,
  };
}

export async function saveCandidate(formData: FormData): Promise<SaveCandidateState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { status: "error", message: "Not authenticated." };

  let fields: CandidateFormFields;
  let force: boolean;
  try {
    ({ fields, force } = parsePayload(formData));
  } catch {
    return { status: "error", message: "Invalid form data." };
  }

  if (!fields.full_name?.trim()) {
    return { status: "error", message: "Full name is required." };
  }

  if (!force) {
    const dup = await findDuplicate(supabase, fields.email, fields.phone);
    if (dup) return { status: "duplicate", match: dup };
  }

  let cvPath: string | null = null;
  let cvName: string | null = null;
  const file = formData.get("file");
  if (file instanceof File && file.size > 0) {
    try {
      const uploaded = await uploadCv(file, "candidates");
      cvPath = uploaded.path;
      cvName = uploaded.originalName;
    } catch (e) {
      return { status: "error", message: e instanceof Error ? e.message : "CV upload failed." };
    }
  }

  const { data, error } = await supabase
    .from("candidates")
    .insert({
      ...toCandidateColumns(fields),
      cv_file_path: cvPath,
      cv_original_filename: cvName,
      created_by: user.id,
    })
    .select("id")
    .single();

  if (error || !data) {
    return { status: "error", message: error?.message ?? "Could not save candidate." };
  }

  revalidatePath("/candidates");
  return { status: "success", candidateId: data.id };
}

export async function updateCandidate(formData: FormData): Promise<SaveCandidateState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { status: "error", message: "Not authenticated." };

  const candidateId = String(formData.get("candidateId") ?? "");
  if (!candidateId) return { status: "error", message: "Missing candidate id." };

  let fields: CandidateFormFields;
  let force: boolean;
  try {
    ({ fields, force } = parsePayload(formData));
  } catch {
    return { status: "error", message: "Invalid form data." };
  }

  if (!fields.full_name?.trim()) {
    return { status: "error", message: "Full name is required." };
  }

  if (!force) {
    const dup = await findDuplicate(supabase, fields.email, fields.phone, candidateId);
    if (dup) return { status: "duplicate", match: dup };
  }

  const updates: CandidateUpdate = toCandidateColumns(fields);

  const file = formData.get("file");
  if (file instanceof File && file.size > 0) {
    try {
      const uploaded = await uploadCv(file, "candidates");
      updates.cv_file_path = uploaded.path;
      updates.cv_original_filename = uploaded.originalName;
    } catch (e) {
      return { status: "error", message: e instanceof Error ? e.message : "CV upload failed." };
    }
  }

  const { error } = await supabase.from("candidates").update(updates).eq("id", candidateId);
  if (error) return { status: "error", message: error.message };

  revalidatePath("/candidates");
  revalidatePath(`/candidates/${candidateId}`);
  return { status: "success", candidateId };
}

export async function deleteCandidate(
  candidateId: string,
): Promise<{ error: string | null }> {
  const supabase = await createClient();

  // Fetch the CV path before deleting so we can clean up storage.
  const { data: candidate } = await supabase
    .from("candidates")
    .select("cv_file_path")
    .eq("id", candidateId)
    .single();

  // RLS restricts DELETE to admins; a non-admin call is rejected here.
  const { error } = await supabase.from("candidates").delete().eq("id", candidateId);
  if (error) return { error: error.message };

  if (candidate?.cv_file_path) {
    await createAdminClient().storage.from(CV_BUCKET).remove([candidate.cv_file_path]);
  }

  revalidatePath("/candidates");
  return { error: null };
}

export async function getSignedCvUrl(path: string): Promise<{ url: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { url: null };

  const { data } = await createAdminClient()
    .storage.from(CV_BUCKET)
    .createSignedUrl(path, 120); // 2-minute link
  return { url: data?.signedUrl ?? null };
}
