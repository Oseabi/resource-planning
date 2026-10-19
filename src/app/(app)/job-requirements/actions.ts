"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { resolveTenderDepartment } from "@/lib/departments";
import { getCurrentProfile, isCurrentUserAdmin } from "@/lib/auth/current-user";
import { purgeActivity } from "@/app/(app)/activity-actions";
import { recordAudit } from "@/app/(app)/audit-actions";
import type { JobRequirementStatus, Json } from "@/lib/supabase/database.types";
import {
  scoreCandidateForPosition,
  toScoreBreakdownJson,
  decideAlert,
  bestMatchPerCandidate,
  ALERT_BATCH_CAP,
} from "@/lib/matching";
import { replacePositions, loadPositions, toPositionInputs } from "@/lib/positions-repo";
import type { PositionInput } from "@/lib/positions";
import { sendMatchAlert, isEmailConfigured } from "@/lib/email/resend";

export interface RequirementFormFields {
  title: string;
  /** The business unit that owns this vacancy, and therefore who can see it. */
  department_id: string | null;
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

  const profile = await getCurrentProfile();
  const { data: departments } = await supabase.from("departments").select("id, name, slug");
  const resolved = resolveTenderDepartment({
    isAdmin: profile?.isAdmin ?? false,
    creatorDepartmentId: profile?.departmentId ?? null,
    submittedDepartmentId: fields.department_id,
    departments: departments ?? [],
  });
  if (resolved.error) return { error: resolved.error };

  // Positions live in their own table, so they must not reach this insert.
  const { positions, ...requirementColumns } = fields;

  const { data, error } = await supabase
    .from("job_requirements")
    .insert({
      ...requirementColumns,
      title: fields.title.trim(),
      department_id: resolved.departmentId!,
      created_by: user.id,
    })
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

  await recordAudit({
    action: "created",
    entityType: "job_requirement",
    entityId: data.id,
    entityLabel: fields.title.trim(),
    detail: { department_id: resolved.departmentId },
  });

  revalidatePath("/job-requirements");
  return { id: data.id };
}

export async function updateRequirement(
  id: string,
  fields: RequirementFormFields,
): Promise<SaveRequirementResult> {
  const supabase = await createClient();
  // This action had no auth call at all. Harmless while every authenticated
  // user could edit every requirement, and a hole the moment they cannot.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  if (!fields.title?.trim()) return { error: "Title is required." };

  const { positions, department_id, ...requirementColumns } = fields;

  // Only an admin moves a vacancy between departments, and only to a real one.
  const profile = await getCurrentProfile();
  const departmentChange = profile?.isAdmin && department_id ? { department_id } : {};

  // Counted, not assumed, for the same reason as updateTender.
  const { data: updated, error } = await supabase
    .from("job_requirements")
    .update({ ...requirementColumns, ...departmentChange, title: fields.title.trim() })
    .eq("id", id)
    .select("id");

  if (error) return { error: error.message };
  if (!updated || updated.length === 0) {
    return { error: "That requirement no longer exists, or you do not have permission to edit it." };
  }

  const positionsResult = await replacePositions(supabase, "job_requirement", id, positions ?? []);
  if (positionsResult.error) return { error: positionsResult.error };

  revalidatePath("/job-requirements");
  revalidatePath(`/job-requirements/${id}`);
  return { id };
}

export async function deleteRequirement(id: string): Promise<{ error: string | null }> {
  const supabase = await createClient();

  // Checked before anything is removed rather than left to RLS. RLS restricts
  // DELETE on job_requirements to admins but allows any authenticated user to
  // delete positions and placements, so the sweep below would succeed for a
  // non-admin and then fail on the requirement itself, gutting a record that
  // survives.
  if (!(await isCurrentUserAdmin())) {
    return { error: "Only an admin can delete a job requirement." };
  }

  // Placements reference a requirement by a plain source_id, so the database
  // cannot cascade them, they are removed here along with the requirement.
  const [{ data: requirement }, { data: positions }, { data: placements }] = await Promise.all([
    supabase.from("job_requirements").select("title").eq("id", id).single(),
    supabase.from("positions").select("id").eq("parent_type", "job_requirement").eq("parent_id", id),
    supabase
      .from("placements")
      .select("id, candidate_id")
      .eq("source_type", "job_requirement")
      .eq("source_id", id),
  ]);

  const positionIds = (positions ?? []).map((p) => p.id);
  const affectedCandidates = [...new Set((placements ?? []).map((p) => p.candidate_id))];

  if ((placements ?? []).length > 0) {
    const { error: placementError } = await supabase
      .from("placements")
      .delete()
      .eq("source_type", "job_requirement")
      .eq("source_id", id);
    if (placementError) return { error: placementError.message };
  }

  // Seats scored per position since 0012. Removed before the positions
  // themselves, which nothing would cascade from.
  if (positionIds.length > 0) {
    const { error: matchError } = await supabase
      .from("matches")
      .delete()
      .eq("match_target_type", "position")
      .in("match_target_id", positionIds);
    if (matchError) return { error: matchError.message };

    // Assignments reference positions with a real foreign key, so removing the
    // seats takes them with it.
    const { error: positionError } = await supabase
      .from("positions")
      .delete()
      .eq("parent_type", "job_requirement")
      .eq("parent_id", id);
    if (positionError) return { error: positionError.message };
  }

  const { error } = await supabase.from("job_requirements").delete().eq("id", id);
  if (error) return { error: error.message };

  await recordAudit({
    action: "deleted",
    entityType: "job_requirement",
    entityId: id,
    entityLabel: requirement?.title ?? null,
    detail: { seats: positions?.length ?? 0, placements: placements?.length ?? 0 },
  });

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

  // Match rows written before 0012 moved scoring onto positions. Nothing writes
  // this type any more, but rows from that era can still be sitting there.
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
  /** Candidates who cleared the threshold but fell outside ALERT_BATCH_CAP. */
  alertsSuppressed?: number;
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

  // The seat ids are already in hand, so the alert sweep needs no second query
  // to find out which match rows this run just wrote.
  const alerts = await maybeSendAutoAlerts(
    supabase,
    requirement,
    positions.map((p) => p.id!),
  );

  revalidatePath(`/job-requirements/${requirementId}`);
  return { matched: rows.length, alertsSent: alerts.sent, alertsSuppressed: alerts.suppressed };
}

type SupabaseServer = Awaited<ReturnType<typeof createClient>>;
type RequirementRow = { id: string; title: string; client: string | null; manager_email: string | null };

/**
 * Email the hiring manager about candidates who cleared the threshold.
 *
 * Matching writes one row per candidate per seat, so this works on the
 * candidate's best row and on the highest score they have ever been alerted at
 * across this requirement's seats. One person is one email: the manager is
 * asking whether there is somebody good for the job, not for a message per
 * seat. Tenders have no manager to write to and deliberately have no
 * equivalent of this.
 */
async function maybeSendAutoAlerts(
  supabase: SupabaseServer,
  requirement: RequirementRow,
  positionIds: string[],
): Promise<{ sent: number; suppressed: number }> {
  const none = { sent: 0, suppressed: 0 };
  if (!requirement.manager_email || !isEmailConfigured()) return none;
  if (positionIds.length === 0) return none;

  // Scoring moved onto positions in 0012, so the rows this requirement owns are
  // the ones against its seats. Reading them by requirement id, as this did
  // until now, matched nothing and sent no alert at all.
  const { data: matches } = await supabase
    .from("matches")
    .select("id, score, alerted_score, candidate_id")
    .eq("match_target_type", "position")
    .in("match_target_id", positionIds);

  if (!matches) return none;

  const eligible = bestMatchPerCandidate(matches).filter((m) =>
    decideAlert(m.alertedHighWater, m.row.score),
  );
  if (eligible.length === 0) return none;

  // Already sorted by score, so the cap keeps the strongest candidates.
  const toAlert = eligible.slice(0, ALERT_BATCH_CAP);
  const suppressed = eligible.length - toAlert.length;

  const { data: candidates } = await supabase
    .from("candidates")
    .select("id, full_name, current_role")
    .in(
      "id",
      toAlert.map((m) => m.row.candidate_id),
    );
  const candById = new Map((candidates ?? []).map((c) => [c.id, c]));

  let sent = 0;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  for (const { row } of toAlert) {
    const candidate = candById.get(row.candidate_id);
    if (!candidate) continue;
    const result = await sendMatchAlert({
      to: requirement.manager_email,
      candidateName: candidate.full_name,
      candidateRole: candidate.current_role,
      requirementTitle: requirement.title,
      client: requirement.client,
      score: row.score,
      appUrl,
      candidateId: candidate.id,
    });
    if (result.configured && result.ok) {
      // Marked on the row that was actually alerted. The candidate's other
      // seats stay unmarked by design: the high-water mark above is what
      // governs whether they hear about this person again.
      await supabase
        .from("matches")
        .update({ alert_sent: true, alerted_score: row.score })
        .eq("id", row.id);
      await supabase.from("match_alerts").insert({
        match_id: row.id,
        sent_to: requirement.manager_email,
        status: "sent",
      });
      sent += 1;
    }
  }
  return { sent, suppressed };
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
    .select("id, score, match_target_type, match_target_id, candidate_id")
    .eq("id", matchId)
    .single();
  if (!match) return { status: "error", message: "Match not found." };

  // Since 0012 a match points at a seat, not at the requirement, so getting
  // back to the manager's address goes through the seat's parent. Reading
  // job_requirements by match_target_id, as this did until now, looked up a
  // position id in the requirements table and never found anything.
  if (match.match_target_type !== "position") {
    return { status: "error", message: "That match was scored before seats existed. Re-run matching first." };
  }

  const { data: seat } = await supabase
    .from("positions")
    .select("role, parent_type, parent_id")
    .eq("id", match.match_target_id)
    .single();
  if (!seat) return { status: "error", message: "The seat this match was scored against is gone." };
  if (seat.parent_type !== "job_requirement") {
    return { status: "error", message: "That match is against a tender, which has no hiring manager to alert." };
  }

  const { data: requirement } = await supabase
    .from("job_requirements")
    .select("id, title, client, manager_email")
    .eq("id", seat.parent_id)
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
    // Which seat they scored best on. The button alerts on a candidate's best
    // row across the requirement, so without this the manager cannot tell.
    role: seat.role,
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

  revalidatePath(`/job-requirements/${requirement.id}`);
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
