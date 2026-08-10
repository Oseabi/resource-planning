"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { TenderStatus, Json } from "@/lib/supabase/database.types";
import { scoreCandidateForPosition, toScoreBreakdownJson } from "@/lib/matching";
import { replacePositions, loadPositions, toPositionInputs } from "@/lib/positions-repo";
import type { PositionInput } from "@/lib/positions";

const DOC_BUCKET = "cvs"; // shared private bucket; tender docs live under tenders/

export interface TenderFormFields {
  title: string;
  /** Roles this bid must staff; persisted to the positions table, not here. */
  positions: PositionInput[];
  reference_number: string | null;
  client: string | null;
  location: string | null;
  value: number | null;
  submission_deadline: string | null;
  contract_start_date: string | null;
  required_roles: string[];
  required_skills: string[];
  required_certifications: string[];
  sectors: string[];
  min_experience_years: number | null;
  status: TenderStatus;
}

export type SaveTenderResult = { id?: string; error?: string };

async function uploadTenderDoc(file: File): Promise<{ path: string }> {
  const admin = createAdminClient();
  const ext = file.name.includes(".") ? file.name.split(".").pop() : "bin";
  const path = `tenders/${crypto.randomUUID()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  const { error } = await admin.storage.from(DOC_BUCKET).upload(path, buffer, {
    contentType: file.type || "application/octet-stream",
    upsert: false,
  });
  if (error) throw new Error(`Document upload failed: ${error.message}`);
  return { path };
}

function parsePayload(formData: FormData): TenderFormFields {
  return JSON.parse(String(formData.get("payload") ?? "{}")) as TenderFormFields;
}

export async function createTender(formData: FormData): Promise<SaveTenderResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  let fields: TenderFormFields;
  try {
    fields = parsePayload(formData);
  } catch {
    return { error: "Invalid form data." };
  }
  if (!fields.title?.trim()) return { error: "Title is required." };

  let docPath: string | null = null;
  const file = formData.get("file");
  if (file instanceof File && file.size > 0) {
    try {
      docPath = (await uploadTenderDoc(file)).path;
    } catch (e) {
      return { error: e instanceof Error ? e.message : "Document upload failed." };
    }
  }

  // Positions live in their own table, so they must not reach the tenders insert.
  const { positions, ...tenderColumns } = fields;

  const { data, error } = await supabase
    .from("tenders")
    .insert({
      ...tenderColumns,
      title: fields.title.trim(),
      source_document_path: docPath,
      created_by: user.id,
    })
    .select("id")
    .single();

  if (error || !data) return { error: error?.message ?? "Could not create tender." };

  const positionsResult = await replacePositions(supabase, "tender", data.id, positions ?? []);
  if (positionsResult.error) return { error: positionsResult.error };

  revalidatePath("/tenders");
  return { id: data.id };
}

export async function updateTender(id: string, fields: TenderFormFields): Promise<SaveTenderResult> {
  const supabase = await createClient();
  if (!fields.title?.trim()) return { error: "Title is required." };

  const { positions, ...tenderColumns } = fields;

  const { error } = await supabase
    .from("tenders")
    .update({ ...tenderColumns, title: fields.title.trim() })
    .eq("id", id);

  if (error) return { error: error.message };

  const positionsResult = await replacePositions(supabase, "tender", id, positions ?? []);
  if (positionsResult.error) return { error: positionsResult.error };

  revalidatePath("/tenders");
  revalidatePath(`/tenders/${id}`);
  return { id };
}

export async function deleteTender(id: string): Promise<{ error: string | null }> {
  const supabase = await createClient();

  const { data: tender } = await supabase
    .from("tenders")
    .select("source_document_path")
    .eq("id", id)
    .single();

  const { error } = await supabase.from("tenders").delete().eq("id", id);
  if (error) return { error: error.message };

  // Clean up dependents: computed match scores for this tender and its RFQ file.
  await supabase.from("matches").delete().eq("match_target_type", "tender").eq("match_target_id", id);
  if (tender?.source_document_path) {
    await createAdminClient().storage.from(DOC_BUCKET).remove([tender.source_document_path]);
  }

  revalidatePath("/tenders");
  return { error: null };
}

export interface RunTenderMatchResult {
  error?: string;
  matched?: number;
}

/** Score all (active) candidates against a tender and persist to matches. */
export async function runTenderMatch(
  tenderId: string,
  includeAllStatuses = false,
): Promise<RunTenderMatchResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const { data: tender, error: tenderErr } = await supabase
    .from("tenders")
    .select("id")
    .eq("id", tenderId)
    .single();
  if (tenderErr || !tender) return { error: "Tender not found." };

  const positions = toPositionInputs(await loadPositions(supabase, "tender", tenderId));
  if (positions.length === 0) {
    return { error: "Add at least one role to this tender before matching." };
  }

  let candidatesQuery = supabase
    .from("candidates")
    .select(
      "id, current_role, additional_roles, skills, technical_skills, certifications, years_experience, availability",
    );
  if (!includeAllStatuses) candidatesQuery = candidatesQuery.eq("status", "active");

  const { data: candidates, error: candErr } = await candidatesQuery;
  if (candErr) return { error: candErr.message };
  if (!candidates || candidates.length === 0) return { matched: 0 };

  // One row per (candidate, position): each seat has its own skills, certs and
  // experience floor, so a candidate scores differently against each.
  const rows = positions.flatMap((position) =>
    candidates.map((c) => {
      const result = scoreCandidateForPosition(c, position);
      return {
        candidate_id: c.id,
        match_target_type: "position" as const,
        match_target_id: position.id!,
        score: result.total,
        score_breakdown: toScoreBreakdownJson(result) as unknown as Json,
      };
    }),
  );

  const { error: upsertErr } = await supabase
    .from("matches")
    .upsert(rows, { onConflict: "candidate_id,match_target_type,match_target_id" });
  if (upsertErr) return { error: upsertErr.message };

  revalidatePath(`/tenders/${tenderId}`);
  revalidatePath("/tenders");
  return { matched: rows.length };
}

export async function placeCandidateForTender(
  tenderId: string,
  candidateId: string,
  feeValue: number,
  startDate: string,
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };
  if (!(feeValue >= 0) || !startDate) return { error: "Fee and start date are required." };

  // Guard against double-placing the same candidate on the same tender.
  const { data: existing } = await supabase
    .from("placements")
    .select("id")
    .eq("candidate_id", candidateId)
    .eq("source_type", "tender")
    .eq("source_id", tenderId)
    .limit(1);
  if (existing && existing.length > 0) {
    return { error: "This candidate has already been placed on this tender." };
  }

  const { error } = await supabase.from("placements").insert({
    candidate_id: candidateId,
    source_type: "tender",
    source_id: tenderId,
    fee_value: feeValue,
    start_date: startDate,
    created_by: user.id,
  });
  if (error) return { error: error.message };

  revalidatePath(`/tenders/${tenderId}`);
  revalidatePath("/candidates");
  return { error: null };
}

export async function getTenderDocUrl(path: string): Promise<{ url: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { url: null };

  const { data } = await createAdminClient().storage.from(DOC_BUCKET).createSignedUrl(path, 120);
  return { url: data?.signedUrl ?? null };
}
