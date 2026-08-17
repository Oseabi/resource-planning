import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, PositionParentType } from "@/lib/supabase/database.types";
import { stintPhase, type StintPhase } from "@/lib/availability";

type Client = SupabaseClient<Database>;

/** One commitment a candidate holds, on a bid or a vacancy, with its dates. */
export interface Deployment {
  /** Stable key. Seat id where there is one, otherwise the placement's own id. */
  key: string;
  positionId: string | null;
  /** Null for a placement with no seat behind it, e.g. one predating positions. */
  role: string | null;
  /** 'proposed' on a bid not yet won, 'placed' once it is real. */
  status: "proposed" | "placed";
  parentType: PositionParentType;
  parentId: string;
  project: string;
  client: string | null;
  href: string;
  startDate: string | null;
  endDate: string | null;
  feeValue: number | null;
  phase: StintPhase;
}

const PHASE_ORDER: Record<StintPhase, number> = { current: 0, upcoming: 1, finished: 2 };

function hrefFor(parentType: PositionParentType, parentId: string): string {
  return parentType === "tender" ? `/tenders/${parentId}` : `/job-requirements/${parentId}`;
}

/**
 * Everywhere a candidate is committed: which project, which seat, and for how
 * long.
 *
 * Reads from both assignments and placements, because neither alone is
 * complete:
 *
 *   - An assignment with no placement is a *proposal*. A tender seat is held
 *     but carries no dates until the bid is won, which is the normal case for
 *     any live bid.
 *   - A placement with no assignment is real committed work that the seat model
 *     cannot see. placements.position_id is nullable for rows predating
 *     positions, and is ON DELETE SET NULL, so deleting a seat leaves the
 *     placement behind. Reading assignments alone would hide genuine placements
 *     from the profile, which is worse than showing a row with a missing role.
 *
 * Queried rather than joined because parent_id is polymorphic across two tables
 * and placements link back with no foreign key, so PostgREST has no
 * relationship to follow.
 */
export async function loadDeployments(
  supabase: Client,
  candidateId: string,
): Promise<Deployment[]> {
  const [{ data: assignments }, { data: placements }] = await Promise.all([
    supabase
      .from("assignments")
      .select("position_id, status")
      .eq("candidate_id", candidateId),
    supabase
      .from("placements")
      .select("id, position_id, source_type, source_id, start_date, end_date, fee_value")
      .eq("candidate_id", candidateId),
  ]);

  const assignmentRows = assignments ?? [];
  const placementRows = placements ?? [];
  if (assignmentRows.length === 0 && placementRows.length === 0) return [];

  const positionIds = [
    ...new Set([
      ...assignmentRows.map((a) => a.position_id),
      ...placementRows.map((p) => p.position_id).filter((id): id is string => !!id),
    ]),
  ];

  const { data: positions } = positionIds.length
    ? await supabase
        .from("positions")
        .select("id, role, parent_type, parent_id")
        .in("id", positionIds)
    : { data: [] };

  const positionById = new Map((positions ?? []).map((p) => [p.id, p]));
  const placementByPosition = new Map(
    placementRows.filter((p) => p.position_id).map((p) => [p.position_id!, p]),
  );

  // Every parent that either source points at, so titles resolve in one pass.
  const parentRefs = new Map<string, PositionParentType>();
  for (const p of positions ?? []) parentRefs.set(p.parent_id, p.parent_type);
  for (const p of placementRows) {
    if (!p.position_id) parentRefs.set(p.source_id, p.source_type);
  }

  const tenderIds = [...parentRefs].filter(([, t]) => t === "tender").map(([id]) => id);
  const requirementIds = [...parentRefs]
    .filter(([, t]) => t === "job_requirement")
    .map(([id]) => id);

  const [{ data: tenders }, { data: requirements }] = await Promise.all([
    tenderIds.length
      ? supabase.from("tenders").select("id, title, client").in("id", tenderIds)
      : Promise.resolve({ data: [] }),
    requirementIds.length
      ? supabase.from("job_requirements").select("id, title, client").in("id", requirementIds)
      : Promise.resolve({ data: [] }),
  ]);

  const parentById = new Map<string, { title: string; client: string | null }>();
  for (const t of tenders ?? []) parentById.set(t.id, { title: t.title, client: t.client });
  for (const r of requirements ?? []) parentById.set(r.id, { title: r.title, client: r.client });

  const rows: Deployment[] = [];

  // Seats the candidate holds, with their placement dates where one exists.
  for (const a of assignmentRows) {
    const position = positionById.get(a.position_id);
    if (!position) continue;

    const placement = placementByPosition.get(a.position_id);
    const parent = parentById.get(position.parent_id);
    const start = placement?.start_date ?? null;

    rows.push({
      key: position.id,
      positionId: position.id,
      role: position.role,
      status: a.status === "placed" ? "placed" : "proposed",
      parentType: position.parent_type,
      parentId: position.parent_id,
      project: parent?.title ?? "Removed record",
      client: parent?.client ?? null,
      href: hrefFor(position.parent_type, position.parent_id),
      startDate: start,
      endDate: placement?.end_date ?? null,
      feeValue: placement?.fee_value ?? null,
      // No dates yet means it has not started, whatever the calendar says.
      phase: start ? stintPhase(start, placement?.end_date ?? null) : "upcoming",
    });
  }

  // Placements with no seat behind them. Real committed work either way, so it
  // belongs on the profile even though the role is unknown.
  const seatedPositions = new Set(assignmentRows.map((a) => a.position_id));
  for (const p of placementRows) {
    if (p.position_id && seatedPositions.has(p.position_id)) continue;

    const viaPosition = p.position_id ? positionById.get(p.position_id) : undefined;
    const parentType = viaPosition?.parent_type ?? p.source_type;
    const parentId = viaPosition?.parent_id ?? p.source_id;
    const parent = parentById.get(parentId);

    rows.push({
      key: `placement:${p.id}`,
      positionId: p.position_id,
      role: viaPosition?.role ?? null,
      status: "placed",
      parentType,
      parentId,
      project: parent?.title ?? "Removed record",
      client: parent?.client ?? null,
      href: hrefFor(parentType, parentId),
      startDate: p.start_date,
      endDate: p.end_date,
      feeValue: p.fee_value,
      phase: stintPhase(p.start_date, p.end_date),
    });
  }

  // What they are on now, then what is coming, then history. Within a group,
  // soonest first for live and upcoming work, most recent first for the past.
  return rows.sort((a, b) => {
    const byPhase = PHASE_ORDER[a.phase] - PHASE_ORDER[b.phase];
    if (byPhase !== 0) return byPhase;
    if (a.phase === "finished") return (b.endDate ?? "").localeCompare(a.endDate ?? "");
    return (a.startDate ?? "9999").localeCompare(b.startDate ?? "9999");
  });
}
