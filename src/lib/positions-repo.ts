import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, PositionParentType } from "@/lib/supabase/database.types";
import { cleanPositions, type PositionInput } from "@/lib/positions";

type Client = SupabaseClient<Database>;

export type PositionRow = Database["public"]["Tables"]["positions"]["Row"];

/** Positions for one parent, in the order the user arranged them. */
export async function loadPositions(
  supabase: Client,
  parentType: PositionParentType,
  parentId: string,
): Promise<PositionRow[]> {
  const { data } = await supabase
    .from("positions")
    .select("*")
    .eq("parent_type", parentType)
    .eq("parent_id", parentId)
    .order("sort_order", { ascending: true });
  return data ?? [];
}

/**
 * Replace a parent's positions with what the form submitted.
 *
 * Rows are matched by id so existing positions keep theirs — assignments and
 * match rows reference position ids, and recreating them would orphan both.
 * Lines the user removed are deleted, which cascades their assignments.
 */
export async function replacePositions(
  supabase: Client,
  parentType: PositionParentType,
  parentId: string,
  positions: PositionInput[],
): Promise<{ error: string | null }> {
  const cleaned = cleanPositions(positions);
  const keptIds = cleaned.map((p) => p.id).filter((id): id is string => Boolean(id));

  // Remove lines the user deleted (cascades their assignments).
  let deleteQuery = supabase
    .from("positions")
    .delete()
    .eq("parent_type", parentType)
    .eq("parent_id", parentId);
  if (keptIds.length > 0) {
    deleteQuery = deleteQuery.not("id", "in", `(${keptIds.join(",")})`);
  }
  const { error: deleteError } = await deleteQuery;
  if (deleteError) return { error: deleteError.message };

  if (cleaned.length === 0) return { error: null };

  for (const [index, position] of cleaned.entries()) {
    if (!position.id) continue;
    const { error } = await supabase
      .from("positions")
      .update({
        role: position.role,
        quantity: position.quantity,
        min_experience_years: position.min_experience_years,
        required_skills: position.required_skills,
        required_certifications: position.required_certifications,
        required_availability: position.required_availability ?? null,
        notes: position.notes ?? null,
        sort_order: index,
      })
      .eq("id", position.id);
    if (error) return { error: error.message };
  }

  const created = cleaned
    .map((position, index) => ({ position, index }))
    .filter(({ position }) => !position.id);

  if (created.length > 0) {
    const { error } = await supabase.from("positions").insert(
      created.map(({ position, index }) => ({
        parent_type: parentType,
        parent_id: parentId,
        role: position.role,
        quantity: position.quantity,
        min_experience_years: position.min_experience_years,
        required_skills: position.required_skills,
        required_certifications: position.required_certifications,
        required_availability: position.required_availability ?? null,
        notes: position.notes ?? null,
        sort_order: index,
      })),
    );
    if (error) return { error: error.message };
  }

  return { error: null };
}

/**
 * Everything a detail page needs to show each role with its own shortlist:
 * positions, their assignment counts, and their ranked matches with candidate
 * names — assembled in three queries rather than one per position.
 */
export async function loadPositionViews(
  supabase: Client,
  parentType: PositionParentType,
  parentId: string,
) {
  const positions = await loadPositions(supabase, parentType, parentId);
  if (positions.length === 0) return [];

  const positionIds = positions.map((p) => p.id);

  const [{ data: matchRows }, { data: assignmentRows }] = await Promise.all([
    supabase
      .from("matches")
      .select("candidate_id, match_target_id, score")
      .eq("match_target_type", "position")
      .in("match_target_id", positionIds)
      .order("score", { ascending: false }),
    supabase.from("assignments").select("position_id, candidate_id").in("position_id", positionIds),
  ]);

  const candidateIds = [...new Set((matchRows ?? []).map((m) => m.candidate_id))];
  const candById = new Map<string, { full_name: string; current_role: string | null }>();
  if (candidateIds.length > 0) {
    const { data: candidates } = await supabase
      .from("candidates")
      .select("id, full_name, current_role")
      .in("id", candidateIds);
    for (const c of candidates ?? []) {
      candById.set(c.id, { full_name: c.full_name, current_role: c.current_role });
    }
  }

  const filledByPosition = new Map<string, number>();
  for (const a of assignmentRows ?? []) {
    filledByPosition.set(a.position_id, (filledByPosition.get(a.position_id) ?? 0) + 1);
  }

  return positions.map((position) => ({
    id: position.id,
    role: position.role,
    quantity: position.quantity,
    minExperienceYears: position.min_experience_years,
    requiredSkills: position.required_skills,
    requiredCertifications: position.required_certifications,
    filled: filledByPosition.get(position.id) ?? 0,
    matches: (matchRows ?? [])
      .filter((m) => m.match_target_id === position.id)
      .map((m) => ({
        candidateId: m.candidate_id,
        name: candById.get(m.candidate_id)?.full_name ?? "Unknown candidate",
        role: candById.get(m.candidate_id)?.current_role ?? null,
        score: m.score,
      })),
  }));
}

/** Map DB rows back to the form shape. */
export function toPositionInputs(rows: PositionRow[]): PositionInput[] {
  return rows.map((r) => ({
    id: r.id,
    role: r.role,
    quantity: r.quantity,
    min_experience_years: r.min_experience_years,
    required_skills: r.required_skills,
    required_certifications: r.required_certifications,
    required_availability: r.required_availability,
    notes: r.notes,
  }));
}
