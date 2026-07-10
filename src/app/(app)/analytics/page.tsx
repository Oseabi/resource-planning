import { Briefcase, Timer, Banknote, Trophy } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  PlacementTrendsChart,
  type MonthlyPlacements,
} from "@/components/charts/placement-trends-chart";
import { cn } from "@/lib/utils";

const MONTHS_SHOWN = 6;

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(d: Date): string {
  return d.toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
}

export default async function AnalyticsPage() {
  const supabase = await createClient();

  const [
    { data: placements },
    { data: requirements },
    { data: tenders },
    { data: candidates },
  ] = await Promise.all([
    supabase.from("placements").select("id, candidate_id, source_type, source_id, fee_value, created_at, created_by"),
    supabase.from("job_requirements").select("id, title, client, status, created_at, required_skills"),
    supabase.from("tenders").select("id, status, required_skills"),
    supabase.from("candidates").select("id, status, availability, skills, technical_skills"),
  ]);

  const allPlacements = placements ?? [];
  const allReqs = requirements ?? [];
  const allTenders = tenders ?? [];
  const allCandidates = candidates ?? [];

  // --- KPIs -----------------------------------------------------------------
  const totalPlacements = allPlacements.length;
  const totalRevenue = allPlacements.reduce((s, p) => s + (p.fee_value ?? 0), 0);
  const recruiterCount = new Set(allPlacements.map((p) => p.created_by).filter(Boolean)).size;
  const revenuePerRecruiter = recruiterCount ? Math.round(totalRevenue / recruiterCount) : 0;

  const reqById = new Map(allReqs.map((r) => [r.id, r]));
  const fillDays = allPlacements
    .filter((p) => p.source_type === "job_requirement")
    .map((p) => {
      const req = reqById.get(p.source_id);
      if (!req) return null;
      const days =
        (new Date(p.created_at).getTime() - new Date(req.created_at).getTime()) / 86_400_000;
      return days >= 0 ? days : null;
    })
    .filter((d): d is number => d != null);
  const avgTimeToFill = fillDays.length
    ? Math.round(fillDays.reduce((s, d) => s + d, 0) / fillDays.length)
    : null;

  const won = allTenders.filter((t) => t.status === "won").length;
  const lost = allTenders.filter((t) => t.status === "lost").length;
  const winRate = won + lost > 0 ? Math.round((won / (won + lost)) * 100) : null;

  // --- Placement trends (last 6 months) --------------------------------------
  const now = new Date();
  const trendData: MonthlyPlacements[] = [];
  const trendIndex = new Map<string, MonthlyPlacements>();
  for (let i = MONTHS_SHOWN - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const entry = { month: monthLabel(d), requirement: 0, tender: 0 };
    trendIndex.set(monthKey(d), entry);
    trendData.push(entry);
  }
  for (const p of allPlacements) {
    const entry = trendIndex.get(monthKey(new Date(p.created_at)));
    if (!entry) continue;
    if (p.source_type === "tender") entry.tender += 1;
    else entry.requirement += 1;
  }

  // --- Pool health ------------------------------------------------------------
  const pool = allCandidates.filter((c) => c.status !== "placed");
  const poolTotal = pool.length || 1;
  const availability = {
    available: pool.filter((c) => c.availability === "available").length,
    notice_period: pool.filter((c) => c.availability === "notice_period").length,
    unavailable: pool.filter((c) => c.availability === "unavailable").length,
  };

  // --- Top skills deficit -------------------------------------------------------
  const demandedSkills = new Set<string>();
  for (const r of allReqs.filter((r) => r.status === "open")) {
    for (const s of r.required_skills) demandedSkills.add(s);
  }
  for (const t of allTenders.filter((t) => t.status === "live" || t.status === "draft")) {
    for (const s of t.required_skills) demandedSkills.add(s);
  }
  const activePool = allCandidates.filter((c) => c.status === "active");
  const skillCoverage = [...demandedSkills].map((skill) => {
    const key = skill.toLowerCase();
    const covered = activePool.filter(
      (c) =>
        c.skills.some((s) => s.toLowerCase() === key) ||
        c.technical_skills.some((s) => s.toLowerCase() === key),
    ).length;
    return { skill, covered };
  });
  const deficits = skillCoverage
    .filter((s) => s.covered <= 1)
    .sort((a, b) => a.covered - b.covered)
    .slice(0, 8);

  // --- Client performance ---------------------------------------------------------
  const placedByReq = new Map<string, number>();
  for (const p of allPlacements.filter((p) => p.source_type === "job_requirement")) {
    placedByReq.set(p.source_id, (placedByReq.get(p.source_id) ?? 0) + 1);
  }
  const clientRows = new Map<string, { openReqs: number; totalReqs: number; placements: number }>();
  for (const r of allReqs) {
    const client = r.client?.trim() || "—";
    const row = clientRows.get(client) ?? { openReqs: 0, totalReqs: 0, placements: 0 };
    row.totalReqs += 1;
    if (r.status === "open") row.openReqs += 1;
    row.placements += placedByReq.get(r.id) ?? 0;
    clientRows.set(client, row);
  }
  const clients = [...clientRows.entries()].sort((a, b) => b[1].totalReqs - a[1].totalReqs);

  const fmtMoney = (n: number) =>
    new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR", maximumFractionDigits: 0 }).format(n);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-display font-semibold text-foreground">Analytics Overview</h1>
        <p className="mt-1 text-body-lg text-muted-foreground">
          Performance metrics for placements, requirements, and tenders.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi icon={<Briefcase className="size-4" />} label="Total placements" value={String(totalPlacements)} />
        <Kpi
          icon={<Timer className="size-4" />}
          label="Avg time-to-fill"
          value={avgTimeToFill != null ? `${avgTimeToFill} days` : "—"}
        />
        <Kpi
          icon={<Banknote className="size-4" />}
          label="Revenue / recruiter"
          value={recruiterCount ? fmtMoney(revenuePerRecruiter) : "—"}
          sub={`Total ${fmtMoney(totalRevenue)}`}
        />
        <Kpi
          icon={<Trophy className="size-4" />}
          label="Tender win rate"
          value={winRate != null ? `${winRate}%` : "—"}
          sub={won + lost > 0 ? `${won} won · ${lost} lost` : "No decided tenders yet"}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_300px]">
        <div className="rounded-lg border border-border bg-card shadow-card p-4">
          <h2 className="mb-2 text-headline-sm font-semibold text-foreground">Placement Trends</h2>
          <PlacementTrendsChart data={trendData} />
        </div>

        <div className="space-y-4">
          <div className="rounded-lg border border-border bg-card shadow-card p-4">
            <h2 className="mb-3 text-headline-sm font-semibold text-foreground">Pool Health</h2>
            <HealthBar label="Available" count={availability.available} total={poolTotal} barClass="bg-success" />
            <HealthBar label="Notice period" count={availability.notice_period} total={poolTotal} barClass="bg-strong-match" />
            <HealthBar label="Unavailable" count={availability.unavailable} total={poolTotal} barClass="bg-border" />
          </div>

          <div className="rounded-lg border border-border bg-card shadow-card p-4">
            <h2 className="mb-2 text-headline-sm font-semibold text-foreground">Top Skills Deficit</h2>
            {deficits.length === 0 ? (
              <p className="text-body-sm text-muted-foreground">
                No demanded skills are under-covered right now.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {deficits.map((d) => (
                  <span
                    key={d.skill}
                    className={cn(
                      "inline-flex items-center rounded-lg border px-2 py-0.5 text-label-md",
                      d.covered === 0
                        ? "border-destructive/30 bg-destructive/10 text-destructive"
                        : "border-strong-match/30 bg-strong-match/10 text-strong-match",
                    )}
                    title={`${d.covered} active candidate(s) have this`}
                  >
                    {d.skill}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-card shadow-card">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-headline-sm font-semibold text-foreground">Client Performance</h2>
        </div>
        {clients.length === 0 ? (
          <p className="px-4 py-8 text-center text-body-sm text-muted-foreground">
            No clients yet — create job requirements to see per-client performance.
          </p>
        ) : (
          <>
            {/* Desktop: data table */}
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Client</TableHead>
                    <TableHead className="text-right">Open reqs</TableHead>
                    <TableHead className="text-right">Total reqs</TableHead>
                    <TableHead className="text-right">Placements</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {clients.map(([client, row]) => (
                    <TableRow key={client}>
                      <TableCell className="font-medium text-foreground">{client}</TableCell>
                      <TableCell className="text-right text-foreground">{row.openReqs}</TableCell>
                      <TableCell className="text-right text-muted-foreground">{row.totalReqs}</TableCell>
                      <TableCell className="text-right text-foreground">{row.placements}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Mobile: stacked cards */}
            <ul className="divide-y divide-border md:hidden">
              {clients.map(([client, row]) => (
                <li key={client} className="px-4 py-3">
                  <div className="font-medium text-foreground">{client}</div>
                  <div className="mt-1 flex gap-4 text-body-sm text-muted-foreground">
                    <span><span className="text-foreground">{row.openReqs}</span> open</span>
                    <span><span className="text-foreground">{row.totalReqs}</span> total</span>
                    <span><span className="text-foreground">{row.placements}</span> placed</span>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

function Kpi({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card shadow-card px-4 py-3">
      <div className="flex items-center justify-between">
        <span className="text-label-sm uppercase tracking-wide text-muted-foreground">{label}</span>
        <span className="text-muted-foreground">{icon}</span>
      </div>
      <div className="mt-1 text-display font-semibold text-foreground">{value}</div>
      {sub && <div className="text-body-sm text-muted-foreground">{sub}</div>}
    </div>
  );
}

function HealthBar({
  label,
  count,
  total,
  barClass,
}: {
  label: string;
  count: number;
  total: number;
  barClass: string;
}) {
  const pct = Math.round((count / total) * 100);
  return (
    <div className="mb-3 last:mb-0">
      <div className="flex items-center justify-between text-body-sm">
        <span className="text-foreground">{label}</span>
        <span className="text-muted-foreground">{pct}%</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full", barClass)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
