import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, PositionParentType } from "@/lib/supabase/database.types";
import { stintPhase, type StintPhase } from "@/lib/availability";

type Client = SupabaseClient<Database>;

/** One seat a candidate holds, on a bid or a vacancy, with its dates. */
export interface Deployment {
  positionId: string;
  role: string;
  /** 'proposed' on a bid not yet won; 'placed' once it is real. */
  status: string;
  parentType: PositionParentType;
  parentId: string;
  /** The bid or requirement title. */
  project: string;
  client: string | null;
  href: string;
  startDate: string | null;
  endDate: string | null;
  feeValue: number | null;
  phase: StintPhase;
}

const PHASE_ORDER: Record<StintPhase, number> = { current: 0, upcoming: 1, finished: 2 };

/**
 * Everywhere a candidate is committed: which project, which seat, and for how
 * long.
 *
 * Assignments are the source of truth for *where* someone sits, and placements
 * carry the commercial dates. They are separate on purpose, because a tender
 * seat is a proposal with no dates until the bid is won, so an assignment can
 * legitimately exist with no placement behind it.
 *
 * Four queries rather than a join, because parent_id is polymorphic across two
 * tables and placements link back by (position_id, candidate_id) with no
 * foreign key, so PostgREST has no relationship to follow.
 */
export async function loadDeployments(
  supabase: Client,
  candidateId: string,
): Promise<Deployment[]> {
  const { data: assignments } = await supabase
    .from("assignments")
    .select("position_id, candidate_id, status")
    .eq("candidate_id", candidateId);

  if (!assignments || assignments.length === 0) return [];

  const positionIds = assignments.map((a) => a.position_id);

  const [{ data: positions }, { data: placements }] = await Promise.all([
    supabase
      .from("positions")
      .select("id, role, parent_type, parent_id")
      .in("id", positionIds),
    supabase
      .from("placements")
      .select("position_id, start_date, end_date, fee_value")
      .eq("candidate_id", candidateId),
  ]);

  const positionById = new Map((positions ?? []).map((p) => [p.id, p]));
  const placementByPosition = new Map(
    (placements ?? []).filter((p) => p.position_id).map((p) => [p.position_id!, p]),
  );

  // Titles for both parent kinds, fetched per kind since they are separate tables.
  const tenderIds = [
    ...new Set(
      (positions ?? []).filter((p) => p.parent_type === "tender").map((p) => p.parent_id),
    ),
  ];
  const requirementIds = [
    ...new Set(
      (positions ?? [])
        .filter((p) => p.parent_type === "job_requirement")
        .map((p) => p.parent_id),
    ),
  ];

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

  for (const a of assignments) {
    const position = positionById.get(a.position_id);
    if (!position) continue;

    const placement = placementByPosition.get(a.position_id);
    const parent = parentById.get(position.parent_id);
    const start = placement?.start_date ?? null;
    const end = placement?.end_date ?? null;

    rows.push({
      positionId: position.id,
      role: position.role,
      status: a.status,
      parentType: position.parent_type,
      parentId: position.parent_id,
      project: parent?.title ?? "Removed record",
      client: parent?.client ?? null,
      href:
        position.parent_type === "tender"
          ? `/tenders/${position.parent_id}`
          : `/job-requirements/${position.parent_id}`,
      startDate: start,
      endDate: end,
      feeValue: placement?.fee_value ?? null,
      // A proposal has no dates yet, so it cannot be anything but upcoming.
      phase: start ? stintPhase(start, end) : "upcoming",
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
