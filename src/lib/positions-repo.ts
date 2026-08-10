import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, PositionParentType } from "@/lib/supabase/database.types";
import { cleanPositions, type CandidateProfile, type PositionInput } from "@/lib/positions";

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
 * Rows are matched by id so existing positions keep theirs, assignments and
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
 * names, assembled in three queries rather than one per position.
 */
export async function loadPositionViews(
  supabase: Client,
  parentType: PositionParentType,
  parentId: string,
) {
  const positions = await loadPositions(supabase, parentType, parentId);
  if (positions.length === 0) {
    return { positions: [], aggregated: [], candidatePool: {} as Record<string, CandidateProfile> };
  }

  const positionIds = positions.map((p) => p.id);

  const [{ data: matchRows }, { data: assignmentRows }] = await Promise.all([
    supabase
      .from("matches")
      .select("id, candidate_id, match_target_id, score, score_breakdown, alert_sent")
      .eq("match_target_type", "position")
      .in("match_target_id", positionIds)
      .order("score", { ascending: false }),
    supabase
      .from("assignments")
      .select("position_id, candidate_id, status")
      .in("position_id", positionIds),
  ]);

  // Names are needed for everyone shortlisted *and* everyone already seated.
  const candidateIds = [
    ...new Set([
      ...(matchRows ?? []).map((m) => m.candidate_id),
      ...(assignmentRows ?? []).map((a) => a.candidate_id),
    ]),
  ];
  const candById = new Map<
    string,
    { full_name: string; current_role: string | null; status: string }
  >();
  // Keyed by id so the client can re-score a candidate against any seat without
  // another round-trip. One entry per person, not one per match row.
  const candidatePool: Record<string, CandidateProfile> = {};
  if (candidateIds.length > 0) {
    const { data: candidates } = await supabase
      .from("candidates")
      .select(
        "id, full_name, current_role, status, additional_roles, skills, technical_skills, certifications, years_experience, availability",
      )
      .in("id", candidateIds);
    for (const c of candidates ?? []) {
      candById.set(c.id, {
        full_name: c.full_name,
        current_role: c.current_role,
        status: c.status,
      });
      candidatePool[c.id] = {
        id: c.id,
        full_name: c.full_name,
        current_role: c.current_role,
        additional_roles: c.additional_roles,
        skills: c.skills,
        technical_skills: c.technical_skills,
        certifications: c.certifications,
        years_experience: c.years_experience,
        availability: c.availability,
      };
    }
  }

  const assignedByPosition = new Map<
    string,
    { candidateId: string; name: string; role: string | null; status: string }[]
  >();
  for (const a of assignmentRows ?? []) {
    const list = assignedByPosition.get(a.position_id) ?? [];
    list.push({
      candidateId: a.candidate_id,
      name: candById.get(a.candidate_id)?.full_name ?? "Unknown candidate",
      role: candById.get(a.candidate_id)?.current_role ?? null,
      status: a.status,
    });
    assignedByPosition.set(a.position_id, list);
  }

  const positionViews = positions.map((position) => ({
    id: position.id,
    role: position.role,
    quantity: position.quantity,
    minExperienceYears: position.min_experience_years,
    requiredSkills: position.required_skills,
    requiredCertifications: position.required_certifications,
    filled: (assignedByPosition.get(position.id) ?? []).length,
    assigned: assignedByPosition.get(position.id) ?? [],
    matches: (matchRows ?? [])
      .filter((m) => m.match_target_id === position.id)
      .map((m) => ({
        candidateId: m.candidate_id,
        name: candById.get(m.candidate_id)?.full_name ?? "Unknown candidate",
        role: candById.get(m.candidate_id)?.current_role ?? null,
        score: m.score,
      })),
  }));

  // Parent-level shortlist: a candidate's best score across every seat. Matching
  // is per position now, so without this roll-up the overall panel, which owns
  // the Match button, export and alerts, would have nothing to show.
  const zero = { role: 0, skills: 0, certifications: 0, experience: 0, availability: 0 };
  type MatchRow = NonNullable<typeof matchRows>[number];
  const bestByCandidate = new Map<string, MatchRow>();
  for (const m of matchRows ?? []) {
    const current = bestByCandidate.get(m.candidate_id);
    if (!current || m.score > current.score) bestByCandidate.set(m.candidate_id, m);
  }

  const aggregated = [...bestByCandidate.values()]
    .sort((a, b) => b.score - a.score)
    .map((m) => {
      const sb = (m.score_breakdown ?? {}) as {
        breakdown?: typeof zero;
        points?: typeof zero;
      };
      const cand = candById.get(m.candidate_id);
      return {
        matchId: m.id,
        candidateId: m.candidate_id,
        name: cand?.full_name ?? "Unknown candidate",
        role: cand?.current_role ?? null,
        status: cand?.status ?? "active",
        score: m.score,
        breakdown: sb.breakdown ?? zero,
        points: sb.points ?? zero,
        alertSent: m.alert_sent,
      };
    });

  return { positions: positionViews, aggregated, candidatePool };
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
