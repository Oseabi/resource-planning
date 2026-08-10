/**
 * Analytics computations, pure functions over plain row shapes so every metric
 * is unit-testable without a database. The page layer fetches rows and hands
 * them straight in.
 */
import { expiryStatus, type ExpiryStatus } from "@/lib/oem-letters";

// --- Shared row shapes (structural: only the columns each metric needs) -------

export interface CandidateRow {
  id: string;
  status: string;
  availability: string;
  years_experience: number | null;
  resource_categories: string[];
  skills: string[];
  technical_skills: string[];
  certifications: string[];
}

export interface TenderRow {
  id: string;
  status: string;
  client: string | null;
  value: number | null;
  submission_deadline: string | null;
  sectors: string[];
}

export interface RequirementRow {
  id: string;
  status: string;
  created_at: string;
  required_skills: string[];
}

export interface PlacementRow {
  source_type: string;
  source_id: string;
  fee_value: number | null;
  created_at: string;
  created_by: string | null;
}

export interface LetterRow {
  oem_vendor: string;
  categories: string[];
  expiry_date: string | null;
}

export interface CountedSlice {
  name: string;
  count: number;
}

const MS_PER_DAY = 86_400_000;

function pct(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

// --- Pool intelligence -------------------------------------------------------

export interface CategoryStat {
  name: string;
  total: number;
  available: number;
  placed: number;
}

/**
 * Headcount per resource category (ERP, EA, …). A candidate tagged with several
 * categories counts in each. Candidates with no category land in "Uncategorised"
 * so the gap is visible rather than hidden.
 */
export function categoryBreakdown(candidates: CandidateRow[]): CategoryStat[] {
  const map = new Map<string, CategoryStat>();

  for (const c of candidates) {
    const keys = c.resource_categories.length ? c.resource_categories : ["Uncategorised"];
    for (const raw of keys) {
      const name = raw.trim() || "Uncategorised";
      const stat = map.get(name) ?? { name, total: 0, available: 0, placed: 0 };
      stat.total += 1;
      if (c.status === "placed") stat.placed += 1;
      else if (c.availability === "available") stat.available += 1;
      map.set(name, stat);
    }
  }

  return [...map.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
}

export const EXPERIENCE_BANDS = ["0–2 yrs", "3–5 yrs", "6–10 yrs", "10+ yrs"] as const;

/** Seniority spread of the pool; "Unknown" covers candidates with no figure. */
export function experienceBands(candidates: CandidateRow[]): CountedSlice[] {
  const counts = new Map<string, number>(EXPERIENCE_BANDS.map((b) => [b, 0]));
  let unknown = 0;

  for (const c of candidates) {
    const y = c.years_experience;
    if (y == null) {
      unknown += 1;
      continue;
    }
    const band = y <= 2 ? "0–2 yrs" : y <= 5 ? "3–5 yrs" : y <= 10 ? "6–10 yrs" : "10+ yrs";
    counts.set(band, (counts.get(band) ?? 0) + 1);
  }

  const out: CountedSlice[] = EXPERIENCE_BANDS.map((b) => ({ name: b, count: counts.get(b) ?? 0 }));
  if (unknown > 0) out.push({ name: "Unknown", count: unknown });
  return out;
}

export interface PoolHealth {
  total: number;
  available: number;
  noticePeriod: number;
  unavailable: number;
  placed: number;
  /** Share of the non-placed pool that is available right now. */
  availablePct: number;
}

export function poolHealth(candidates: CandidateRow[]): PoolHealth {
  const placed = candidates.filter((c) => c.status === "placed").length;
  const pool = candidates.filter((c) => c.status !== "placed");
  const available = pool.filter((c) => c.availability === "available").length;
  return {
    total: candidates.length,
    available,
    noticePeriod: pool.filter((c) => c.availability === "notice_period").length,
    unavailable: pool.filter((c) => c.availability === "unavailable").length,
    placed,
    availablePct: pct(available, pool.length),
  };
}

export interface SkillGap {
  skill: string;
  covered: number;
}

/**
 * Demanded skills ranked by how thinly the active pool covers them, the
 * hiring shortlist. `demand` is the union of skills across open work.
 */
export function skillGaps(
  demand: string[],
  candidates: CandidateRow[],
  limit = 8,
): SkillGap[] {
  const active = candidates.filter((c) => c.status === "active");
  const seen = new Set<string>();

  const gaps: SkillGap[] = [];
  for (const raw of demand) {
    const skill = raw.trim();
    const key = skill.toLowerCase();
    if (!skill || seen.has(key)) continue;
    seen.add(key);
    const covered = active.filter(
      (c) =>
        c.skills.some((s) => s.toLowerCase() === key) ||
        c.technical_skills.some((s) => s.toLowerCase() === key),
    ).length;
    gaps.push({ skill, covered });
  }

  return gaps.sort((a, b) => a.covered - b.covered || a.skill.localeCompare(b.skill)).slice(0, limit);
}

// --- Tender & bid performance ------------------------------------------------

export interface TenderPerformance {
  won: number;
  lost: number;
  live: number;
  submitted: number;
  draft: number;
  /** Percentage of decided bids that were won; null when nothing is decided yet. */
  winRate: number | null;
  wonValue: number;
  lostValue: number;
  pipelineValue: number;
  avgDealSize: number | null;
}

export function tenderPerformance(tenders: TenderRow[]): TenderPerformance {
  const by = (s: string) => tenders.filter((t) => t.status === s);
  const sum = (rows: TenderRow[]) => rows.reduce((acc, t) => acc + (t.value ?? 0), 0);

  const won = by("won");
  const lost = by("lost");
  const live = by("live");
  const submitted = by("submitted");
  const decided = won.length + lost.length;

  return {
    won: won.length,
    lost: lost.length,
    live: live.length,
    submitted: submitted.length,
    draft: by("draft").length,
    winRate: decided > 0 ? Math.round((won.length / decided) * 100) : null,
    wonValue: sum(won),
    lostValue: sum(lost),
    pipelineValue: sum([...live, ...submitted]),
    avgDealSize: won.length > 0 ? Math.round(sum(won) / won.length) : null,
  };
}

export interface ClientPerformance {
  client: string;
  bids: number;
  won: number;
  lost: number;
  winRate: number | null;
  value: number;
}

/** Bid record per client, worst-performing surfaced by the caller as needed. */
export function winRateByClient(tenders: TenderRow[]): ClientPerformance[] {
  const map = new Map<string, ClientPerformance>();

  for (const t of tenders) {
    const client = t.client?.trim() || "-";
    const row =
      map.get(client) ?? { client, bids: 0, won: 0, lost: 0, winRate: null, value: 0 };
    row.bids += 1;
    if (t.status === "won") {
      row.won += 1;
      row.value += t.value ?? 0;
    }
    if (t.status === "lost") row.lost += 1;
    map.set(client, row);
  }

  for (const row of map.values()) {
    const decided = row.won + row.lost;
    row.winRate = decided > 0 ? Math.round((row.won / decided) * 100) : null;
  }

  return [...map.values()].sort((a, b) => b.bids - a.bids || a.client.localeCompare(b.client));
}

export interface DeadlineRisk {
  id: string;
  client: string | null;
  daysLeft: number;
  value: number | null;
}

/**
 * Open bids (draft/live) whose submission deadline is inside `withinDays`,
 * soonest first. Already-overdue bids are included with a negative countdown.
 */
export function deadlinesAtRisk(
  tenders: TenderRow[],
  withinDays = 30,
  today: Date = new Date(),
): DeadlineRisk[] {
  const start = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());

  return tenders
    .filter((t) => (t.status === "draft" || t.status === "live") && t.submission_deadline)
    .map((t) => {
      const due = new Date(`${t.submission_deadline}T00:00:00Z`).getTime();
      return {
        id: t.id,
        client: t.client,
        daysLeft: Math.round((due - start) / MS_PER_DAY),
        value: t.value,
      };
    })
    .filter((t) => Number.isFinite(t.daysLeft) && t.daysLeft <= withinDays)
    .sort((a, b) => a.daysLeft - b.daysLeft);
}

/** Union of skills demanded by open requirements and in-flight tenders. */
/**
 * Skills wanted by work that is still open, drawn from its positions.
 *
 * Demand is per seat, so a role needed three times weighs the same as one needed
 * once, this measures whether the pool covers a skill at all, not how deep.
 */
export function demandedSkills(
  requirements: { id: string; status: string }[],
  tenders: { id: string; status: string }[],
  positions: { parent_type: string; parent_id: string; required_skills: string[] }[],
): string[] {
  const openParents = new Set<string>([
    ...requirements.filter((r) => r.status === "open").map((r) => `job_requirement:${r.id}`),
    ...tenders
      .filter((t) => t.status === "live" || t.status === "draft")
      .map((t) => `tender:${t.id}`),
  ]);

  const out = new Set<string>();
  for (const position of positions) {
    if (!openParents.has(`${position.parent_type}:${position.parent_id}`)) continue;
    for (const skill of position.required_skills) out.add(skill);
  }
  return [...out];
}

// --- Compliance & readiness --------------------------------------------------

export interface ComplianceSummary {
  total: number;
  valid: number;
  expiringSoon: number;
  expired: number;
  noExpiry: number;
  vendors: number;
  /** Share of letters that are still usable in a bid. */
  readyPct: number;
}

export function complianceSummary(
  letters: LetterRow[],
  today: Date = new Date(),
): ComplianceSummary {
  const counts: Record<ExpiryStatus, number> = {
    valid: 0,
    expiring_soon: 0,
    expired: 0,
    unknown: 0,
  };
  for (const l of letters) counts[expiryStatus(l.expiry_date, today)] += 1;

  const usable = counts.valid + counts.expiring_soon + counts.unknown;
  return {
    total: letters.length,
    valid: counts.valid,
    expiringSoon: counts.expiring_soon,
    expired: counts.expired,
    noExpiry: counts.unknown,
    vendors: new Set(letters.map((l) => l.oem_vendor.trim()).filter(Boolean)).size,
    readyPct: pct(usable, letters.length),
  };
}

/** Certifications held across the active pool, most common first. */
export function certificationCoverage(
  candidates: CandidateRow[],
  limit = 8,
): CountedSlice[] {
  const counts = new Map<string, number>();
  for (const c of candidates.filter((c) => c.status === "active")) {
    for (const raw of new Set(c.certifications.map((x) => x.trim()).filter(Boolean))) {
      counts.set(raw, (counts.get(raw) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, limit);
}

/** Practice areas that have people but no OEM letter backing them (or vice versa). */
export function categoryReadiness(
  candidates: CandidateRow[],
  letters: LetterRow[],
): { name: string; people: number; letters: number }[] {
  const names = new Set<string>();
  const people = new Map<string, number>();
  const docs = new Map<string, number>();

  for (const c of candidates) {
    for (const raw of c.resource_categories) {
      const n = raw.trim();
      if (!n) continue;
      names.add(n);
      people.set(n, (people.get(n) ?? 0) + 1);
    }
  }
  for (const l of letters) {
    for (const raw of l.categories) {
      const n = raw.trim();
      if (!n) continue;
      names.add(n);
      docs.set(n, (docs.get(n) ?? 0) + 1);
    }
  }

  return [...names]
    .map((name) => ({ name, people: people.get(name) ?? 0, letters: docs.get(name) ?? 0 }))
    .sort((a, b) => b.people - a.people || a.name.localeCompare(b.name));
}

// --- Recruiter & delivery ops ------------------------------------------------

/** Mean days between a requirement opening and a candidate being placed on it. */
export function avgTimeToFill(
  placements: PlacementRow[],
  requirements: { id: string; created_at: string }[],
): number | null {
  const byId = new Map(requirements.map((r) => [r.id, r]));
  const spans: number[] = [];

  for (const p of placements.filter((p) => p.source_type === "job_requirement")) {
    const req = byId.get(p.source_id);
    if (!req) continue;
    const days =
      (new Date(p.created_at).getTime() - new Date(req.created_at).getTime()) / MS_PER_DAY;
    if (days >= 0) spans.push(days);
  }

  if (spans.length === 0) return null;
  return Math.round(spans.reduce((a, b) => a + b, 0) / spans.length);
}

export interface RecruiterStat {
  recruiterId: string;
  placements: number;
  revenue: number;
}

export function recruiterLeaderboard(placements: PlacementRow[]): RecruiterStat[] {
  const map = new Map<string, RecruiterStat>();
  for (const p of placements) {
    const id = p.created_by ?? "unattributed";
    const row = map.get(id) ?? { recruiterId: id, placements: 0, revenue: 0 };
    row.placements += 1;
    row.revenue += p.fee_value ?? 0;
    map.set(id, row);
  }
  return [...map.values()].sort((a, b) => b.placements - a.placements || b.revenue - a.revenue);
}

export interface AgeingBucket {
  name: string;
  count: number;
}

const AGEING_BUCKETS = [
  { name: "< 2 weeks", max: 14 },
  { name: "2–4 weeks", max: 28 },
  { name: "1–3 months", max: 90 },
  { name: "3 months+", max: Infinity },
];

/** How long open requirements have been sitting unfilled. */
export function requirementAgeing(
  requirements: RequirementRow[],
  today: Date = new Date(),
): AgeingBucket[] {
  const counts = new Map<string, number>(AGEING_BUCKETS.map((b) => [b.name, 0]));

  for (const r of requirements.filter((r) => r.status === "open")) {
    const age = (today.getTime() - new Date(r.created_at).getTime()) / MS_PER_DAY;
    if (!Number.isFinite(age) || age < 0) continue;
    const bucket = AGEING_BUCKETS.find((b) => age < b.max) ?? AGEING_BUCKETS[AGEING_BUCKETS.length - 1];
    counts.set(bucket.name, (counts.get(bucket.name) ?? 0) + 1);
  }

  return AGEING_BUCKETS.map((b) => ({ name: b.name, count: counts.get(b.name) ?? 0 }));
}

/** Distribution of persisted match scores, for judging match quality. */
export function matchScoreBands(scores: number[]): CountedSlice[] {
  const bands = [
    { name: "80–100%", test: (s: number) => s >= 80 },
    { name: "70–79%", test: (s: number) => s >= 70 && s < 80 },
    { name: "50–69%", test: (s: number) => s >= 50 && s < 70 },
    { name: "< 50%", test: (s: number) => s < 50 },
  ];
  return bands.map((b) => ({ name: b.name, count: scores.filter(b.test).length }));
}
