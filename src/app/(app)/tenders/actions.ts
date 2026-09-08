"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isCurrentUserAdmin } from "@/lib/auth/current-user";
import { purgeActivity, recordEvent } from "@/app/(app)/activity-actions";
import { validateExtension, placementsAlignedTo } from "@/lib/delivery";
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
  contract_end_date: string | null;
  reference_letters_required: number | null;
  required_roles: string[];
  required_skills: string[];
  required_certifications: string[];
  sectors: string[];
  min_experience_years: number | null;
  status: TenderStatus;
}

export type SaveTenderResult = { id?: string; error?: string };

export interface ExtendTenderResult {
  error: string | null;
  /** Placements whose end date moved with the contract. */
  moved?: number;
  /** Left alone because they carried an end date of their own. */
  keptOverrides?: number;
  /** Could not move: they start after the new end date. */
  skipped?: number;
}

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
  // This action had no auth call at all. Harmless while every authenticated
  // user could edit every tender, and a hole the moment they cannot.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  if (!fields.title?.trim()) return { error: "Title is required." };

  const { positions, ...tenderColumns } = fields;

  // Counted, not assumed. An update RLS filters out returns zero rows and no
  // error, so without this the action would report success on a tender the
  // caller cannot see, and then go on to rewrite its seats.
  const { data: updated, error } = await supabase
    .from("tenders")
    .update({ ...tenderColumns, title: fields.title.trim() })
    .eq("id", id)
    .select("id");

  if (error) return { error: error.message };
  if (!updated || updated.length === 0) {
    return { error: "That tender no longer exists, or you do not have permission to edit it." };
  }

  const positionsResult = await replacePositions(supabase, "tender", id, positions ?? []);
  if (positionsResult.error) return { error: positionsResult.error };

  revalidatePath("/tenders");
  revalidatePath(`/tenders/${id}`);
  return { id };
}

/**
 * Delete a tender and everything hanging off it.
 *
 * Nothing here can be left to the database. positions.parent_id,
 * placements.source_id and activity.entity_id are all polymorphic across two
 * parent tables, so none of them carries a foreign key and none of them
 * cascades. Deleting only the tender row used to leave its seats behind, and
 * through them their assignments, so a candidate's profile went on showing a
 * seat on a project that no longer opens.
 */
export async function deleteTender(id: string): Promise<{ error: string | null }> {
  const supabase = await createClient();

  // Checked before anything is removed, not left to RLS. RLS restricts DELETE
  // on tenders to admins but deliberately allows any authenticated user to
  // delete positions and placements, so the sweep below would succeed for a
  // non-admin and then fail on the tender itself, gutting a record that
  // survives.
  if (!(await isCurrentUserAdmin())) {
    return { error: "Only an admin can delete a tender." };
  }

  const [{ data: tender }, { data: positions }, { data: placements }] = await Promise.all([
    supabase.from("tenders").select("source_document_path").eq("id", id).single(),
    supabase.from("positions").select("id").eq("parent_type", "tender").eq("parent_id", id),
    supabase
      .from("placements")
      .select("id, candidate_id")
      .eq("source_type", "tender")
      .eq("source_id", id),
  ]);

  const positionIds = (positions ?? []).map((p) => p.id);
  const affectedCandidates = [...new Set((placements ?? []).map((p) => p.candidate_id))];

  // Dependents first, parent last. A failure part way then leaves a tender that
  // still lists its seats, which is visible on the page and can be retried. The
  // other order leaves orphans with no parent left to retry from.
  if ((placements ?? []).length > 0) {
    const { error: placementError } = await supabase
      .from("placements")
      .delete()
      .eq("source_type", "tender")
      .eq("source_id", id);
    if (placementError) return { error: placementError.message };
  }

  if (positionIds.length > 0) {
    const { error: matchError } = await supabase
      .from("matches")
      .delete()
      .eq("match_target_type", "position")
      .in("match_target_id", positionIds);
    if (matchError) return { error: matchError.message };
  }

  // Match rows written before 0012 moved scoring onto positions. Nothing writes
  // this type any more, but rows from that era can still be sitting there.
  await supabase.from("matches").delete().eq("match_target_type", "tender").eq("match_target_id", id);

  if (positionIds.length > 0) {
    // Assignments reference positions with a real foreign key, so removing the
    // seats takes them with it.
    const { error: positionError } = await supabase
      .from("positions")
      .delete()
      .eq("parent_type", "tender")
      .eq("parent_id", id);
    if (positionError) return { error: positionError.message };
  }

  const { error } = await supabase.from("tenders").delete().eq("id", id);
  if (error) return { error: error.message };

  await purgeActivity("tender", id);

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

  if (tender?.source_document_path) {
    await createAdminClient().storage.from(DOC_BUCKET).remove([tender.source_document_path]);
  }

  revalidatePath("/tenders");
  revalidatePath("/dashboard");
  if (affectedCandidates.length > 0) {
    revalidatePath("/candidates");
    revalidatePath("/analytics");
  }
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
  /** Optional. Without it the placement is open ended and has no duration. */
  endDate?: string,
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

  // This button places against the bid as a whole, so it has no seat in hand.
  // If the candidate already holds one on this bid, link to it, otherwise the
  // profile can name the project but not the role they are doing on it.
  // Two queries rather than an embedded join: the Database types are written by
  // hand and declare no relationships, so PostgREST embedding has nothing to
  // resolve against.
  const { data: seats } = await supabase
    .from("positions")
    .select("id")
    .eq("parent_type", "tender")
    .eq("parent_id", tenderId);

  let positionId: string | null = null;
  if (seats && seats.length > 0) {
    const { data: held } = await supabase
      .from("assignments")
      .select("position_id")
      .eq("candidate_id", candidateId)
      .in(
        "position_id",
        seats.map((s) => s.id),
      )
      .limit(1);
    positionId = held?.[0]?.position_id ?? null;
  }

  const { error } = await supabase.from("placements").insert({
    candidate_id: candidateId,
    source_type: "tender",
    source_id: tenderId,
    position_id: positionId,
    fee_value: feeValue,
    start_date: startDate,
    end_date: endDate || null,
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

  // The signed URL is minted with the service-role client, which bypasses RLS,
  // so being signed in cannot be the whole check: any path handed to this
  // action would be honoured. Resolve the path back to its tender through the
  // ordinary client first, so RLS decides whether the caller may see it.
  const { data: owner } = await supabase
    .from("tenders")
    .select("id")
    .eq("source_document_path", path)
    .maybeSingle();
  if (!owner) return { url: null };

  const { data } = await createAdminClient().storage.from(DOC_BUCKET).createSignedUrl(path, 120);
  return { url: data?.signedUrl ?? null };
}

/**
 * Push a won contract's end date out, and take the team with it.
 *
 * "Aligned" means a placement ends on exactly the contract's previous end date.
 * Anyone on a different date was set that way deliberately, so they stay where
 * they are: moving them would quietly undo a decision somebody made on purpose.
 *
 * Three writes with no transaction around them, because the Supabase client has
 * none. The tender moves first: if the placements then fail, the team is behind
 * a contract that has moved, which the delivery panel shows and which can be
 * fixed. The reverse would leave people committed past a contract that never
 * moved, which nothing would surface.
 */
export async function extendTender(
  tenderId: string,
  newEndDate: string,
  note?: string,
): Promise<ExtendTenderResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const { data: tender } = await supabase
    .from("tenders")
    .select("id, status, contract_start_date, contract_end_date")
    .eq("id", tenderId)
    .single();
  if (!tender) return { error: "That tender no longer exists. Reload the page." };

  const invalid = validateExtension(tender, newEndDate);
  if (invalid) return { error: invalid };

  // Captured before anything is written. This is the "moved from" the audit
  // trail records, and it decides who counts as following the contract.
  const previousEnd = tender.contract_end_date;

  // Filtered on source, not position_id, which is ON DELETE SET NULL: a
  // placement whose seat was deleted afterwards is still a real commitment on
  // this contract and has to move with it.
  const { data: rows } = await supabase
    .from("placements")
    .select("id, start_date, end_date")
    .eq("source_type", "tender")
    .eq("source_id", tenderId);

  // Partitioned in JS rather than with .neq("end_date", previousEnd), which
  // would silently drop every open-ended row, because NULL compared to a date
  // is NULL rather than true.
  const { aligned, overridden } = placementsAlignedTo(rows ?? [], previousEnd);
  // A placement starting after the new end would violate
  // placements_end_after_start and fail the whole batch, so it is reported
  // rather than moved.
  const movable = aligned.filter((p) => p.start_date <= newEndDate);
  const skipped = aligned.length - movable.length;

  const { error: tenderError } = await supabase
    .from("tenders")
    .update({ contract_end_date: newEndDate })
    .eq("id", tenderId);
  if (tenderError) return { error: tenderError.message };

  let moved = 0;
  if (movable.length > 0) {
    // .select() and a row count for the same reason as unassignCandidate: an
    // UPDATE matching nothing is not an error, and RLS filters rows rather than
    // raising, so without the count a no-op would report success.
    const { data: updated, error: placementError } = await supabase
      .from("placements")
      .update({ end_date: newEndDate })
      .in(
        "id",
        movable.map((p) => p.id),
      )
      .select("id");
    moved = updated?.length ?? 0;

    if (placementError || moved !== movable.length) {
      const stuck = movable.length - moved;
      // Recorded even on a partial failure. The contract genuinely did move,
      // and a trail that omits it would be worse than one that admits the mess.
      await recordEvent("tender", tenderId, "extended", {
        from: previousEnd ?? "no end date",
        to: newEndDate,
        placements_moved: moved,
      });
      revalidatePath(`/tenders/${tenderId}`);
      return {
        error: `The contract was extended, but ${stuck} placement${stuck === 1 ? "" : "s"} could not be moved. Set the dates on the delivery panel.`,
        moved,
      };
    }
  }

  await recordEvent("tender", tenderId, "extended", {
    from: previousEnd ?? "no end date",
    to: newEndDate,
    placements_moved: moved,
    overrides_kept: overridden.length,
    ...(skipped > 0 ? { skipped } : {}),
    ...(note?.trim() ? { note: note.trim() } : {}),
  });

  revalidatePath(`/tenders/${tenderId}`);
  revalidatePath("/tenders");
  revalidatePath("/candidates");
  revalidatePath("/dashboard");
  return { error: null, moved, keptOverrides: overridden.length, skipped };
}

/**
 * Give open-ended placements on this contract the tender's end date.
 *
 * Separate from extendTender on purpose. "This contract was extended" and "we
 * never recorded an end date in the first place" are different facts, and
 * folding them together would have the timeline say something untrue.
 *
 * Needed because every team confirmed before the contract window existed was
 * written with no end date, so those people read as committed indefinitely and
 * are missing from every forward-looking number.
 */
export async function alignPlacementsToContract(
  tenderId: string,
): Promise<{ error: string | null; moved?: number }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const { data: tender } = await supabase
    .from("tenders")
    .select("id, contract_end_date")
    .eq("id", tenderId)
    .single();
  if (!tender) return { error: "That tender no longer exists. Reload the page." };
  if (!tender.contract_end_date) {
    return { error: "Set a contract end date on this tender first." };
  }

  const end = tender.contract_end_date;
  const { data: rows } = await supabase
    .from("placements")
    .select("id, start_date")
    .eq("source_type", "tender")
    .eq("source_id", tenderId)
    .is("end_date", null);

  // Anyone who started after the contract closes cannot take that end date, and
  // the check constraint would reject the whole batch for it.
  const movable = (rows ?? []).filter((p) => p.start_date <= end);
  if (movable.length === 0) return { error: null, moved: 0 };

  const { data: updated, error } = await supabase
    .from("placements")
    .update({ end_date: end })
    .in(
      "id",
      movable.map((p) => p.id),
    )
    .select("id");
  if (error) return { error: error.message };
  const moved = updated?.length ?? 0;
  if (moved === 0) {
    return { error: "Those dates could not be saved. Reload the page and try again." };
  }

  await recordEvent("tender", tenderId, "dates_aligned", { moved, to: end });

  revalidatePath(`/tenders/${tenderId}`);
  revalidatePath("/candidates");
  revalidatePath("/dashboard");
  return { error: null, moved };
}
