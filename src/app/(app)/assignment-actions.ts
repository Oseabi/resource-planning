"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { seatCount } from "@/lib/positions";
import { recordEvent } from "@/app/(app)/activity-actions";
import { validatePlacementWindow } from "@/lib/delivery";

export type AssignResult = { error: string | null };

/** Where a parent's pages live, for revalidation. */
function parentPath(parentType: string, parentId: string): string {
  return parentType === "tender" ? `/tenders/${parentId}` : `/job-requirements/${parentId}`;
}

/**
 * Put a candidate in a seat.
 *
 * A job requirement is a real vacancy, so assigning places the candidate
 * immediately and writes a placement, that is what feeds revenue and
 * time-to-fill, and what flips them to `placed` via the existing trigger.
 *
 * A tender seat is only a proposal: the bid may not be won, so no placement is
 * written and the candidate stays available and keeps appearing in matching.
 */
export async function assignCandidate(
  positionId: string,
  candidateId: string,
  options: { feeValue?: number; startDate?: string; endDate?: string } = {},
): Promise<AssignResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const { data: position } = await supabase
    .from("positions")
    .select("id, parent_type, parent_id, role, quantity")
    .eq("id", positionId)
    .single();
  if (!position) return { error: "That role no longer exists." };

  // Seats are finite.
  const { count: taken } = await supabase
    .from("assignments")
    .select("id", { count: "exact", head: true })
    .eq("position_id", positionId);
  if ((taken ?? 0) >= seatCount(position)) {
    return { error: `All ${seatCount(position)} ${position.role} seats are already filled.` };
  }

  // A person cannot hold two seats on the same requirement or tender.
  const { data: siblings } = await supabase
    .from("positions")
    .select("id")
    .eq("parent_type", position.parent_type)
    .eq("parent_id", position.parent_id);
  const siblingIds = (siblings ?? []).map((p) => p.id);
  if (siblingIds.length > 0) {
    const { data: existing } = await supabase
      .from("assignments")
      .select("id")
      .eq("candidate_id", candidateId)
      .in("position_id", siblingIds)
      .limit(1);
    if (existing && existing.length > 0) {
      return { error: "This candidate already holds a seat here." };
    }
  }

  const isVacancy = position.parent_type === "job_requirement";

  if (isVacancy) {
    // A placement is a commercial record, so it needs its commercial terms.
    if (!(Number(options.feeValue) >= 0) || !options.startDate) {
      return { error: "Fee and start date are required to place someone on a requirement." };
    }
  }

  const { error: assignError } = await supabase.from("assignments").insert({
    position_id: positionId,
    candidate_id: candidateId,
    status: isVacancy ? "placed" : "proposed",
    created_by: user.id,
  });
  if (assignError) return { error: assignError.message };

  if (isVacancy) {
    const { error: placementError } = await supabase.from("placements").insert({
      candidate_id: candidateId,
      source_type: "job_requirement",
      source_id: position.parent_id,
      position_id: positionId,
      fee_value: Number(options.feeValue),
      start_date: options.startDate!,
      // Optional. Null means open ended, which keeps them off the forecast
      // rather than freeing them on a date nobody has actually agreed.
      end_date: options.endDate || null,
      created_by: user.id,
    });
    if (placementError) {
      // Keep the two in step rather than leaving a seat that has no placement.
      await supabase.from("assignments").delete().eq("position_id", positionId).eq("candidate_id", candidateId);
      return { error: placementError.message };
    }
  }

  // Logged on both sides: the bid needs to show who joined the team, and the
  // person needs to show what they were put forward for.
  const { data: candidate } = await supabase
    .from("candidates")
    .select("full_name")
    .eq("id", candidateId)
    .single();
  const action = isVacancy ? "placed" : "assigned";

  await Promise.all([
    recordEvent(position.parent_type, position.parent_id, action, {
      candidate: candidate?.full_name ?? "Unknown candidate",
      role: position.role,
    }),
    recordEvent("candidate", candidateId, action, { role: position.role }),
  ]);

  revalidatePath(parentPath(position.parent_type, position.parent_id));
  revalidatePath("/candidates");
  return { error: null };
}

/** Free a seat, undoing whatever the assignment created. */
export async function unassignCandidate(
  positionId: string,
  candidateId: string,
): Promise<AssignResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const { data: position } = await supabase
    .from("positions")
    .select("id, parent_type, parent_id, role")
    .eq("id", positionId)
    .single();
  if (!position) return { error: "That role no longer exists." };

  // Read the name before the assignment goes, so the trail can say who left.
  const { data: candidate } = await supabase
    .from("candidates")
    .select("full_name")
    .eq("id", candidateId)
    .single();

  // .select() so the deleted rows come back and the count can be checked.
  //
  // A DELETE that matches nothing is not an error in Postgres, and RLS filters
  // rows rather than raising, so without this a no-op reports success. That is
  // worse than a plain failure here: the caller sees "removed", the candidate is
  // freed back to active, and an "unassigned" line is written to the timeline
  // for something that never happened. An audit trail that records fictional
  // events is worse than no audit trail.
  const { data: removed, error } = await supabase
    .from("assignments")
    .delete()
    .eq("position_id", positionId)
    .eq("candidate_id", candidateId)
    .select("id");
  if (error) return { error: error.message };
  if (!removed || removed.length === 0) {
    return { error: "That seat was already free. Reload the page to see the current team." };
  }

  if (position.parent_type === "job_requirement") {
    await supabase
      .from("placements")
      .delete()
      .eq("position_id", positionId)
      .eq("candidate_id", candidateId);

    // Nothing reverses the placed flag on delete, so free anyone left with no
    // placement at all, otherwise they stay hidden from matching for good.
    const { count } = await supabase
      .from("placements")
      .select("id", { count: "exact", head: true })
      .eq("candidate_id", candidateId);
    if ((count ?? 0) === 0) {
      await supabase.from("candidates").update({ status: "active" }).eq("id", candidateId);
    }
  }

  await Promise.all([
    recordEvent(position.parent_type, position.parent_id, "unassigned", {
      candidate: candidate?.full_name ?? "Unknown candidate",
      role: position.role,
    }),
    recordEvent("candidate", candidateId, "unassigned", { role: position.role }),
  ]);

  revalidatePath(parentPath(position.parent_type, position.parent_id));
  revalidatePath("/candidates");
  return { error: null };
}

export interface CandidateConflict {
  candidateId: string;
  tenderTitles: string[];
}

/**
 * Candidates already promised to other open bids. Proposing the same senior
 * person on several tenders is normal, but the exposure should be visible.
 */
export async function findBidConflicts(
  candidateIds: string[],
  excludeParentId: string,
): Promise<CandidateConflict[]> {
  if (candidateIds.length === 0) return [];
  const supabase = await createClient();

  const { data: rows } = await supabase
    .from("assignments")
    .select("candidate_id, positions!inner(parent_type, parent_id)")
    .in("candidate_id", candidateIds)
    .eq("status", "proposed");

  type Row = { candidate_id: string; positions: { parent_type: string; parent_id: string } | null };
  const relevant = ((rows ?? []) as unknown as Row[]).filter(
    (r) => r.positions?.parent_type === "tender" && r.positions.parent_id !== excludeParentId,
  );
  if (relevant.length === 0) return [];

  const tenderIds = [...new Set(relevant.map((r) => r.positions!.parent_id))];
  const { data: tenders } = await supabase
    .from("tenders")
    .select("id, title, status")
    .in("id", tenderIds)
    .in("status", ["draft", "live", "submitted"]);

  const titleById = new Map((tenders ?? []).map((t) => [t.id, t.title]));

  const byCandidate = new Map<string, Set<string>>();
  for (const row of relevant) {
    const title = titleById.get(row.positions!.parent_id);
    if (!title) continue; // decided bids are not a conflict
    const set = byCandidate.get(row.candidate_id) ?? new Set<string>();
    set.add(title);
    byCandidate.set(row.candidate_id, set);
  }

  return [...byCandidate.entries()].map(([candidateId, titles]) => ({
    candidateId,
    tenderTitles: [...titles],
  }));
}

/**
 * Turn a won tender's proposed team into real placements.
 *
 * Called when a tender's status becomes `won`: the bid is no longer speculative,
 * so the team genuinely is placed and should count toward revenue.
 *
 * The end date matters more than it looks. Written null, every member reads as
 * committed with no end in sight, drops out of the bench forecast permanently
 * and never satisfies a "free by" question. Confirming a team used to make that
 * team invisible to every forward-looking number in the system.
 */
export async function confirmTenderTeam(
  tenderId: string,
  feeValue: number,
  startDate: string,
  /** Null keeps the placement open ended, as the vacancy path already allows. */
  endDate?: string | null,
): Promise<{ error: string | null; placed?: number }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };
  if (!(Number(feeValue) >= 0) || !startDate) {
    return { error: "Fee and start date are required." };
  }
  const windowError = validatePlacementWindow(startDate, endDate ?? null);
  if (windowError) return { error: windowError };

  const { data: positions } = await supabase
    .from("positions")
    .select("id")
    .eq("parent_type", "tender")
    .eq("parent_id", tenderId);
  const positionIds = (positions ?? []).map((p) => p.id);
  if (positionIds.length === 0) return { error: null, placed: 0 };

  const { data: proposed } = await supabase
    .from("assignments")
    .select("id, position_id, candidate_id")
    .in("position_id", positionIds)
    .eq("status", "proposed");

  if (!proposed || proposed.length === 0) return { error: null, placed: 0 };

  const { error: placementError } = await supabase.from("placements").insert(
    proposed.map((a) => ({
      candidate_id: a.candidate_id,
      source_type: "tender" as const,
      source_id: tenderId,
      position_id: a.position_id,
      fee_value: Number(feeValue),
      start_date: startDate,
      end_date: endDate || null,
      created_by: user.id,
    })),
  );
  if (placementError) return { error: placementError.message };

  const { error: statusError } = await supabase
    .from("assignments")
    .update({ status: "placed" })
    .in(
      "id",
      proposed.map((a) => a.id),
    );
  if (statusError) return { error: statusError.message };

  await recordEvent("tender", tenderId, "team_confirmed", {
    placed: proposed.length,
    start_date: startDate,
    end_date: endDate || "open ended",
  });

  revalidatePath(`/tenders/${tenderId}`);
  revalidatePath("/tenders");
  revalidatePath("/candidates");
  revalidatePath("/dashboard");
  revalidatePath("/analytics");
  return { error: null, placed: proposed.length };
}

/**
 * Move one placement's dates.
 *
 * The contract window on a tender covers the normal case, where the whole team
 * runs for the same period. This is the exception: somebody joined late, left
 * early, or the dates were recorded wrong and nothing in the app could correct
 * them, because until now no code updated a placement at all.
 *
 * A placement carrying its own end date is also what marks it as deliberately
 * overridden, so extending the contract afterwards leaves it alone.
 *
 * Deliberately does not touch candidates.status. The trigger that sets 'placed'
 * fires on insert only, so setting an end date in the past leaves someone
 * flagged as placed while availableFrom reports them free. That inconsistency
 * already exists and fixing it means deciding who owns that column, which is a
 * change of its own.
 */
export async function updatePlacementDates(
  placementId: string,
  startDate: string,
  endDate: string | null,
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const windowError = validatePlacementWindow(startDate, endDate);
  if (windowError) return { error: windowError };

  // Read first, so the timeline can say what moved from what, and so a missing
  // row is reported rather than silently ignored.
  const { data: placement } = await supabase
    .from("placements")
    .select("id, candidate_id, source_type, source_id, start_date, end_date")
    .eq("id", placementId)
    .single();
  if (!placement) return { error: "That placement no longer exists. Reload the page." };

  // .select() for the same reason unassignCandidate does it: an UPDATE matching
  // nothing is not an error and RLS filters rows rather than raising, so without
  // the count a no-op reports success and writes a timeline entry for a change
  // that never happened.
  const { data: updated, error } = await supabase
    .from("placements")
    .update({ start_date: startDate, end_date: endDate })
    .eq("id", placementId)
    .select("id");
  if (error) return { error: error.message };
  if (!updated || updated.length === 0) {
    return { error: "Those dates could not be saved. Reload the page and try again." };
  }

  const { data: candidate } = await supabase
    .from("candidates")
    .select("full_name")
    .eq("id", placement.candidate_id)
    .single();

  const detail = {
    candidate: candidate?.full_name ?? "Unknown candidate",
    from_start: placement.start_date,
    to_start: startDate,
    from_end: placement.end_date ?? "open ended",
    to_end: endDate ?? "open ended",
  };

  await Promise.all([
    recordEvent(placement.source_type, placement.source_id, "dates_changed", detail),
    recordEvent("candidate", placement.candidate_id, "dates_changed", detail),
  ]);

  revalidatePath(parentPath(placement.source_type, placement.source_id));
  revalidatePath(`/candidates/${placement.candidate_id}`);
  revalidatePath("/candidates");
  revalidatePath("/dashboard");
  return { error: null };
}
