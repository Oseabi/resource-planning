"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { purgeActivity } from "@/app/(app)/activity-actions";
import type { JobRequirementStatus, Json } from "@/lib/supabase/database.types";
import {
  scoreCandidateForPosition,
  toScoreBreakdownJson,
  decideAlert,
} from "@/lib/matching";
import { replacePositions, loadPositions, toPositionInputs } from "@/lib/positions-repo";
import type { PositionInput } from "@/lib/positions";
import { sendMatchAlert, isEmailConfigured } from "@/lib/email/resend";

export interface RequirementFormFields {
  title: string;
  /** Roles this requirement must staff; persisted to the positions table. */
  positions: PositionInput[];
  client: string | null;
  required_role: string | null;
  required_skills: string[];
  required_certifications: string[];
  required_qualifications: string[];
  sectors: string[];
  min_experience_years: number | null;
  location: string | null;
  required_availability: string | null;
  manager_email: string | null;
  status: JobRequirementStatus;
}

export type SaveRequirementResult = { id?: string; error?: string };

export async function createRequirement(
  fields: RequirementFormFields,
): Promise<SaveRequirementResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };
  if (!fields.title?.trim()) return { error: "Title is required." };

  // Positions live in their own table, so they must not reach this insert.
  const { positions, ...requirementColumns } = fields;

  const { data, error } = await supabase
    .from("job_requirements")
    .insert({ ...requirementColumns, title: fields.title.trim(), created_by: user.id })
    .select("id")
    .single();

  if (error || !data) return { error: error?.message ?? "Could not create requirement." };

  const positionsResult = await replacePositions(
    supabase,
    "job_requirement",
    data.id,
    positions ?? [],
  );
  if (positionsResult.error) return { error: positionsResult.error };

  revalidatePath("/job-requirements");
  return { id: data.id };
}

export async function updateRequirement(
  id: string,
  fields: RequirementFormFields,
): Promise<SaveRequirementResult> {
  const supabase = await createClient();
  if (!fields.title?.trim()) return { error: "Title is required." };

  const { positions, ...requirementColumns } = fields;

  const { error } = await supabase
    .from("job_requirements")
    .update({ ...requirementColumns, title: fields.title.trim() })
    .eq("id", id);

  if (error) return { error: error.message };

  const positionsResult = await replacePositions(supabase, "job_requirement", id, positions ?? []);
  if (positionsResult.error) return { error: positionsResult.error };

  revalidatePath("/job-requirements");
  revalidatePath(`/job-requirements/${id}`);
  return { id };
}

export async function deleteRequirement(id: string): Promise<{ error: string | null }> {
  const supabase = await createClient();

  // Placements reference a requirement by a plain source_id, so the database
  // cannot cascade them, they are removed here along with the requirement.
  const { data: placements } = await supabase
    .from("placements")
    .select("id, candidate_id")
    .eq("source_type", "job_requirement")
    .eq("source_id", id);

  const affectedCandidates = [...new Set((placements ?? []).map((p) => p.candidate_id))];

  if ((placements ?? []).length > 0) {
    const { error: placementError } = await supabase
      .from("placements")
      .delete()
      .eq("source_type", "job_requirement")
      .eq("source_id", id);
    if (placementError) return { error: placementError.message };
  }

  // RLS restricts DELETE to admins; a non-admin call is rejected here.
  const { error } = await supabase.from("job_requirements").delete().eq("id", id);
  if (error) return { error: error.message };

  await purgeActivity("job_requirement", id);

  // A placement marks its candidate "placed" via trigger, and nothing reverses
  // that on delete. Free anyone left with no remaining placement, otherwise they
  // stay hidden from matching with no record explaining why.
  for (const candidateId of affectedCandidates) {
    const { count } = await supabase
      .from("placements")
      .select("id", { count: "exact", head: true })
      .eq("candidate_id", candidateId);
    if ((count ?? 0) === 0) {
      await supabase.from("candidates").update({ status: "active" }).eq("id", candidateId);
    }
  }

  // Clean up computed match scores for this requirement.
  await supabase
    .from("matches")
    .delete()
    .eq("match_target_type", "job_requirement")
    .eq("match_target_id", id);

  revalidatePath("/job-requirements");
  // Candidate statuses and the placement-derived metrics may both have changed.
  if (affectedCandidates.length > 0) {
    revalidatePath("/candidates");
    revalidatePath("/analytics");
  }
  return { error: null };
}

export interface RunMatchResult {
  error?: string;
  matched?: number;
  alertsSent?: number;
}

/** Score all (active) candidates against a requirement and persist to matches. */
export async function runMatch(
  requirementId: string,
  includeAllStatuses = false,
): Promise<RunMatchResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const { data: requirement, error: reqErr } = await supabase
    .from("job_requirements")
    .select("*")
    .eq("id", requirementId)
    .single();
  if (reqErr || !requirement) return { error: "Requirement not found." };

  const positions = toPositionInputs(await loadPositions(supabase, "job_requirement", requirementId));
  if (positions.length === 0) {
    return { error: "Add at least one role to this requirement before matching." };
  }

  let candidatesQuery = supabase
    .from("candidates")
    .select(
      "id, current_role, additional_roles, skills, technical_skills, certifications, years_experience, availability",
    );
  if (!includeAllStatuses) candidatesQuery = candidatesQuery.eq("status", "active");

  const { data: candidates, error: candErr } = await candidatesQuery;
  if (candErr) return { error: candErr.message };
  if (!candidates || candidates.length === 0) return { matched: 0, alertsSent: 0 };

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

  // Upsert: preserves alert_sent / alerted_score on existing rows (not in payload).
  const { error: upsertErr } = await supabase
    .from("matches")
    .upsert(rows, { onConflict: "candidate_id,match_target_type,match_target_id" });
  if (upsertErr) return { error: upsertErr.message };

  const alertsSent = await maybeSendAutoAlerts(supabase, requirement);

  revalidatePath(`/job-requirements/${requirementId}`);
  return { matched: rows.length, alertsSent };
}

type SupabaseServer = Awaited<ReturnType<typeof createClient>>;
type RequirementRow = { id: string; title: string; client: string | null; manager_email: string | null };

async function maybeSendAutoAlerts(
  supabase: SupabaseServer,
  requirement: RequirementRow,
): Promise<number> {
  if (!requirement.manager_email || !isEmailConfigured()) return 0;

  const { data: matches } = await supabase
    .from("matches")
    .select("id, score, alerted_score, candidate_id")
    .eq("match_target_type", "job_requirement")
    .eq("match_target_id", requirement.id);

  if (!matches) return 0;

  const toAlert = matches.filter((m) => decideAlert(m.alerted_score, m.score));
  if (toAlert.length === 0) return 0;

  const { data: candidates } = await supabase
    .from("candidates")
    .select("id, full_name, current_role")
    .in(
      "id",
      toAlert.map((m) => m.candidate_id),
    );
  const candById = new Map((candidates ?? []).map((c) => [c.id, c]));

  let sent = 0;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  for (const m of toAlert) {
    const candidate = candById.get(m.candidate_id);
    if (!candidate) continue;
    const result = await sendMatchAlert({
      to: requirement.manager_email,
      candidateName: candidate.full_name,
      candidateRole: candidate.current_role,
      requirementTitle: requirement.title,
      client: requirement.client,
      score: m.score,
      appUrl,
      candidateId: candidate.id,
    });
    if (result.configured && result.ok) {
      await supabase
        .from("matches")
        .update({ alert_sent: true, alerted_score: m.score })
        .eq("id", m.id);
      await supabase.from("match_alerts").insert({
        match_id: m.id,
        sent_to: requirement.manager_email,
        status: "sent",
      });
      sent += 1;
    }
  }
  return sent;
}

export type SendAlertResult = { status: "sent" | "not_configured" | "no_manager" | "error"; message?: string };

/** Manually send an alert for a single match. */
export async function sendAlert(matchId: string): Promise<SendAlertResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { status: "error", message: "Not authenticated." };

  const { data: match } = await supabase
    .from("matches")
    .select("id, score, match_target_id, candidate_id")
    .eq("id", matchId)
    .single();
  if (!match) return { status: "error", message: "Match not found." };

  const { data: requirement } = await supabase
    .from("job_requirements")
    .select("title, client, manager_email")
    .eq("id", match.match_target_id)
    .single();
  if (!requirement) return { status: "error", message: "Requirement not found." };
  if (!requirement.manager_email) return { status: "no_manager" };

  const { data: candidate } = await supabase
    .from("candidates")
    .select("id, full_name, current_role")
    .eq("id", match.candidate_id)
    .single();
  if (!candidate) return { status: "error", message: "Candidate not found." };

  const result = await sendMatchAlert({
    to: requirement.manager_email,
    candidateName: candidate.full_name,
    candidateRole: candidate.current_role,
    requirementTitle: requirement.title,
    client: requirement.client,
    score: match.score,
    appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "",
    candidateId: candidate.id,
  });

  if (!result.configured) return { status: "not_configured" };
  if (!result.ok) return { status: "error", message: result.error };

  await supabase
    .from("matches")
    .update({ alert_sent: true, alerted_score: match.score })
    .eq("id", matchId);
  await supabase.from("match_alerts").insert({
    match_id: matchId,
    sent_to: requirement.manager_email,
    status: "sent",
  });

  revalidatePath(`/job-requirements/${match.match_target_id}`);
  return { status: "sent" };
}

export async function placeCandidate(
  requirementId: string,
  candidateId: string,
  feeValue: number,
  startDate: string,
  /** Optional. Without it the placement is open ended and has no duration. */
  endDate?: string,
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };
  if (!(feeValue >= 0) || !startDate) return { error: "Fee and start date are required." };

  // Guard against double-placing the same candidate on the same requirement.
  const { data: existing } = await supabase
    .from("placements")
    .select("id")
    .eq("candidate_id", candidateId)
    .eq("source_type", "job_requirement")
    .eq("source_id", requirementId)
    .limit(1);
  if (existing && existing.length > 0) {
    return { error: "This candidate has already been placed on this requirement." };
  }

  const { error } = await supabase.from("placements").insert({
    candidate_id: candidateId,
    source_type: "job_requirement",
    source_id: requirementId,
    fee_value: feeValue,
    start_date: startDate,
    end_date: endDate || null,
    created_by: user.id,
  });
  if (error) return { error: error.message };

  revalidatePath(`/job-requirements/${requirementId}`);
  revalidatePath("/candidates");
  return { error: null };
}
