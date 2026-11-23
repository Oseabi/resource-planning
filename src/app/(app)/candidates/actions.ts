"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { purgeActivity } from "@/app/(app)/activity-actions";
import { recordAudit } from "@/app/(app)/audit-actions";
import { createAdminClient } from "@/lib/supabase/admin";
import type {
  CandidateAvailability,
  CandidateStatus,
  Database,
  WorkExperience,
  Education,
  SkillCategory,
  Certificate,
  ProjectGroup,
} from "@/lib/supabase/database.types";
import { toCandidateColumns } from "@/lib/candidate-columns";
import { loadDepartmentContext } from "@/lib/departments-repo";
import { storeCandidateFile } from "@/lib/candidate-file-store";

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
  /** The CV's own words for it ("1 Calendar Month"); printed on the generated CV. */
  availability_note: string | null;
  /** Employment equity group, needed by the TiPP Focus CV template. */
  designated_group: string | null;
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
  /** The business units this person is filed under; may be several, may be none. */
  department_ids: string[];
  linkedin_url: string | null;
  portfolio_url: string | null;
  work_experience: WorkExperience[];
  education: Education[];
  /** ISO date, or the template's "05 February 1989", which is converted on save. */
  date_of_birth: string | null;
  /** ISO date, or the cover page's "07 September 2026", converted on save. */
  cv_as_of: string | null;
  skill_matrix: SkillCategory[];
  certificates: Certificate[];
  projects: ProjectGroup[];
  achievements: string | null;
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

/**
 * Keep an uploaded CV: in SharePoint when it is configured, otherwise in the
 * private bucket. Returns the columns to set on the candidate row.
 */
async function uploadCv(file: File, candidateId: string): Promise<CandidateUpdate> {
  const ext = file.name.includes(".") ? file.name.split(".").pop() : "bin";
  const stored = await storeCandidateFile(file, candidateId, `candidates/${crypto.randomUUID()}.${ext}`);
  return stored.kind === "drive"
    ? { cv_drive_id: stored.driveId, cv_drive_item_id: stored.itemId, cv_file_path: null, cv_original_filename: sanitizeFilename(file.name) }
    // The SharePoint columns are left out here so a bucket upload also works on
    // a database without migration 0027; they are only ever set together with
    // SharePoint being configured, when uploads go the other way.
    : { cv_file_path: stored.path, cv_original_filename: sanitizeFilename(file.name) };
}

function parsePayload(formData: FormData): { fields: CandidateFormFields; force: boolean } {
  const raw = String(formData.get("payload") ?? "{}");
  const parsed = JSON.parse(raw) as CandidateFormFields & { force?: boolean };
  const { force = false, ...fields } = parsed;
  return { fields, force };
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

  // The id is chosen here so an uploaded CV can be filed in SharePoint under
  // the candidate's own folder before the row exists.
  const newId = crypto.randomUUID();
  let cvColumns: CandidateUpdate = {};
  const file = formData.get("file");
  if (file instanceof File && file.size > 0) {
    try {
      cvColumns = await uploadCv(file, newId);
    } catch (e) {
      return { status: "error", message: e instanceof Error ? e.message : "CV upload failed." };
    }
  }

  const { all: departments } = await loadDepartmentContext();
  const { data, error } = await supabase
    .from("candidates")
    .insert({
      ...toCandidateColumns(fields, departments),
      ...cvColumns,
      id: newId,
      created_by: user.id,
    })
    .select("id")
    .single();

  if (error || !data) {
    return { status: "error", message: error?.message ?? "Could not save candidate." };
  }

  await recordAudit({
    action: "created",
    entityType: "candidate",
    entityId: data.id,
    entityLabel: fields.full_name,
    detail: { from_cv: Boolean(cvColumns.cv_original_filename) },
  });

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

  const { all: departments } = await loadDepartmentContext();
  const updates: CandidateUpdate = toCandidateColumns(fields, departments);

  const file = formData.get("file");
  if (file instanceof File && file.size > 0) {
    try {
      Object.assign(updates, await uploadCv(file, candidateId));
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

  // Fetch the CV path before deleting so we can clean up storage. "*" so this
  // works with or without the SharePoint columns from migration 0027.
  const { data: candidate } = await supabase
    .from("candidates")
    .select("*")
    .eq("id", candidateId)
    .single();

  // The attachment rows go with the candidate on the cascade in 0026; their
  // stored files do not, and once the rows are gone nothing anywhere knows the
  // paths. Collected here, removed after the delete has actually succeeded.
  const { data: attachments } = await supabase
    .from("candidate_attachments")
    .select("file_path")
    .eq("candidate_id", candidateId);

  // RLS restricts DELETE to admins, and a filtered-out delete comes back with
  // zero rows and NO error. Without counting them this would fall through and
  // remove the CV from storage with the service-role client, which bypasses
  // RLS, leaving the record intact and pointing at a file that is gone.
  const { data: deleted, error } = await supabase
    .from("candidates")
    .delete()
    .eq("id", candidateId)
    .select("id");
  if (error) return { error: error.message };
  if (!deleted || deleted.length === 0) {
    return { error: "Only admins can delete a candidate." };
  }

  await recordAudit({
    action: "deleted",
    entityType: "candidate",
    entityId: candidateId,
    entityLabel: candidate?.full_name ?? null,
    detail: {
      had_cv: Boolean(candidate?.cv_file_path || candidate?.cv_drive_item_id),
      attachments: attachments?.length ?? 0,
    },
  });

  await purgeActivity("candidate", candidateId);

  // One call: the CV and every attachment are in the same private bucket, the
  // CV under candidates/ and the documents under attachments/. Files in
  // SharePoint are left alone: the library is the company archive, so only
  // the link to them goes with the record.
  const storagePaths = [
    ...(candidate?.cv_file_path ? [candidate.cv_file_path] : []),
    ...(attachments ?? []).map((a) => a.file_path).filter((p): p is string => Boolean(p)),
  ];
  if (storagePaths.length > 0) {
    await createAdminClient().storage.from(CV_BUCKET).remove(storagePaths);
  }

  revalidatePath("/candidates");
  return { error: null };
}
