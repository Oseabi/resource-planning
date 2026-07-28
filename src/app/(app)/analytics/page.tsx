import Link from "next/link";
import {
  Briefcase,
  Timer,
  Banknote,
  Trophy,
  Users,
  ShieldCheck,
  AlertTriangle,
  TrendingUp,
  Layers,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  PlacementTrendsChart,
  type MonthlyPlacements,
} from "@/components/charts/placement-trends-chart";
import {
  categoryBreakdown,
  experienceBands,
  poolHealth,
  skillGaps,
  demandedSkills,
  tenderPerformance,
  winRateByClient,
  deadlinesAtRisk,
  complianceSummary,
  certificationCoverage,
  categoryReadiness,
  avgTimeToFill,
  recruiterLeaderboard,
  requirementAgeing,
  matchScoreBands,
} from "@/lib/analytics";
import { cn } from "@/lib/utils";

const MONTHS_SHOWN = 6;

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function monthLabel(d: Date): string {
  return d.toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
}

const money = (n: number) =>
  new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency: "ZAR",
    maximumFractionDigits: 0,
  }).format(n);

export default async function AnalyticsPage() {
  const supabase = await createClient();

  const [
    { data: placements },
    { data: requirements },
    { data: tenders },
    { data: candidates },
    { data: letters },
    { data: matches },
    { data: profiles },
  ] = await Promise.all([
    supabase.from("placements").select("source_type, source_id, fee_value, created_at, created_by"),
    supabase.from("job_requirements").select("id, status, created_at, required_skills"),
    supabase
      .from("tenders")
      .select("id, status, client, value, submission_deadline, sectors, required_skills"),
    supabase
      .from("candidates")
      .select(
        "id, status, availability, years_experience, resource_categories, skills, technical_skills, certifications",
      ),
    supabase.from("oem_letters").select("oem_vendor, categories, expiry_date"),
    supabase.from("matches").select("score"),
    supabase.from("profiles").select("id, full_name"),
  ]);

  const allPlacements = placements ?? [];
  const allReqs = requirements ?? [];
  const allTenders = tenders ?? [];
  const allCandidates = candidates ?? [];
  const allLetters = letters ?? [];
  const allMatches = matches ?? [];
  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));

  // --- Computed metrics ------------------------------------------------------
  const health = poolHealth(allCandidates);
  const categories = categoryBreakdown(allCandidates);
  const bands = experienceBands(allCandidates);
  const gaps = skillGaps(demandedSkills(allReqs, allTenders), allCandidates);

  const perf = tenderPerformance(allTenders);
  const clients = winRateByClient(allTenders).slice(0, 8);
  const atRisk = deadlinesAtRisk(allTenders, 30);

  const compliance = complianceSummary(allLetters);
  const certs = certificationCoverage(allCandidates);
  const readiness = categoryReadiness(allCandidates, allLetters);

  const timeToFill = avgTimeToFill(allPlacements, allReqs);
  const recruiters = recruiterLeaderboard(allPlacements).slice(0, 8);
  const ageing = requirementAgeing(allReqs);
  const scoreBands = matchScoreBands(allMatches.map((m) => m.score));

  const totalRevenue = allPlacements.reduce((s, p) => s + (p.fee_value ?? 0), 0);

  // Placement trends (last 6 months)
  const now = new Date();
  const trend: MonthlyPlacements[] = [];
  const trendIndex = new Map<string, MonthlyPlacements>();
  for (let i = MONTHS_SHOWN - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const entry = { month: monthLabel(d), requirement: 0, tender: 0 };
    trendIndex.set(monthKey(d), entry);
    trend.push(entry);
  }
  for (const p of allPlacements) {
    const entry = trendIndex.get(monthKey(new Date(p.created_at)));
    if (!entry) continue;
    if (p.source_type === "tender") entry.tender += 1;
    else entry.requirement += 1;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-display font-semibold text-foreground">Analytics</h1>
        <p className="mt-1 text-body-lg text-muted-foreground">
          Pool strength, bid performance, compliance readiness, and delivery operations.
        </p>
      </div>

      {/* Headline KPIs spanning every area */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          icon={<Briefcase className="size-4" />}
          label="Total placements"
          value={String(allPlacements.length)}
          sub={`${money(totalRevenue)} in fees`}
        />
        <Kpi
          icon={<Timer className="size-4" />}
          label="Avg time-to-fill"
          value={timeToFill != null ? `${timeToFill} days` : "—"}
        />
        <Kpi
          icon={<Trophy className="size-4" />}
          label="Tender win rate"
          value={perf.winRate != null ? `${perf.winRate}%` : "—"}
          sub={perf.won + perf.lost > 0 ? `${perf.won} won · ${perf.lost} lost` : "No decided bids yet"}
        />
        <Kpi
          icon={<ShieldCheck className="size-4" />}
          label="OEM bid-ready"
          value={compliance.total > 0 ? `${compliance.readyPct}%` : "—"}
          sub={
            compliance.total > 0
              ? `${compliance.total} letters · ${compliance.expired} expired`
              : "No letters on file"
          }
          tone={compliance.expired > 0 ? "bad" : undefined}
        />
      </div>

      <Tabs defaultValue="pool">
        <TabsList>
          <TabsTrigger value="pool">Resource Pool</TabsTrigger>
          <TabsTrigger value="tenders">Tenders &amp; Bids</TabsTrigger>
          <TabsTrigger value="compliance">Compliance</TabsTrigger>
          <TabsTrigger value="ops">Operations</TabsTrigger>
        </TabsList>

        {/* ---------------- Resource pool ---------------- */}
        <TabsContent value="pool" className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi icon={<Users className="size-4" />} label="Total candidates" value={String(health.total)} />
            <Kpi
              icon={<Users className="size-4" />}
              label="Available now"
              value={String(health.available)}
              sub={`${health.availablePct}% of the bench`}
              tone="good"
            />
            <Kpi icon={<Users className="size-4" />} label="On notice" value={String(health.noticePeriod)} />
            <Kpi icon={<Briefcase className="size-4" />} label="Currently placed" value={String(health.placed)} />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card title="Resource categories" icon={<Layers className="size-4" />}>
              {categories.length === 0 ? (
                <Empty>Tag candidates with resource categories to see the breakdown.</Empty>
              ) : (
                <div className="space-y-2.5">
                  {categories.map((c) => (
                    <div key={c.name}>
                      <div className="flex items-baseline justify-between gap-2 text-body-sm">
                        <Link
                          href={`/candidates?category=${encodeURIComponent(c.name)}`}
                          className="truncate font-medium text-foreground hover:text-primary"
                        >
                          {c.name}
                        </Link>
                        <span className="shrink-0 text-muted-foreground">
                          {c.total} · {c.available} available
                        </span>
                      </div>
                      <Bar value={c.total} total={categories[0].total} className="bg-primary" />
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card title="Experience spread">
              <div className="space-y-2.5">
                {bands.map((b) => (
                  <div key={b.name}>
                    <div className="flex items-baseline justify-between gap-2 text-body-sm">
                      <span className="text-foreground">{b.name}</span>
                      <span className="text-muted-foreground">{b.count}</span>
                    </div>
                    <Bar
                      value={b.count}
                      total={Math.max(...bands.map((x) => x.count), 1)}
                      className="bg-strong-match"
                    />
                  </div>
                ))}
              </div>
            </Card>
          </div>

          <Card title="Demanded skills with the thinnest cover" icon={<AlertTriangle className="size-4" />}>
            {gaps.length === 0 ? (
              <Empty>No open requirements or live tenders yet, so there is no demand to measure against.</Empty>
            ) : (
              <div className="flex flex-wrap gap-2">
                {gaps.map((g) => (
                  <span
                    key={g.skill}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-label-md font-medium",
                      g.covered === 0
                        ? "bg-destructive/10 text-destructive"
                        : "bg-strong-match/10 text-strong-match",
                    )}
                  >
                    {g.skill}
                    <span className="opacity-70">{g.covered === 0 ? "nobody" : g.covered}</span>
                  </span>
                ))}
              </div>
            )}
          </Card>
        </TabsContent>

        {/* ---------------- Tenders ---------------- */}
        <TabsContent value="tenders" className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi
              icon={<Banknote className="size-4" />}
              label="Pipeline value"
              value={money(perf.pipelineValue)}
              sub={`${perf.live} live · ${perf.submitted} submitted`}
            />
            <Kpi icon={<Trophy className="size-4" />} label="Value won" value={money(perf.wonValue)} tone="good" />
            <Kpi icon={<TrendingUp className="size-4" />} label="Value lost" value={money(perf.lostValue)} />
            <Kpi
              icon={<Banknote className="size-4" />}
              label="Avg deal size"
              value={perf.avgDealSize != null ? money(perf.avgDealSize) : "—"}
            />
          </div>

          <Card title="Deadlines in the next 30 days" icon={<AlertTriangle className="size-4" />}>
            {atRisk.length === 0 ? (
              <Empty>No open bids with a deadline in the next 30 days.</Empty>
            ) : (
              <ul className="divide-y divide-border">
                {atRisk.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-3 py-2">
                    <Link
                      href={`/tenders/${t.id}`}
                      className="min-w-0 truncate font-medium text-foreground hover:text-primary"
                    >
                      {t.client ?? "Untitled bid"}
                    </Link>
                    <div className="flex shrink-0 items-center gap-3">
                      <span className="text-body-sm text-muted-foreground">
                        {t.value != null ? money(t.value) : "—"}
                      </span>
                      <span
                        className={cn(
                          "rounded-lg px-2 py-0.5 text-label-md font-semibold",
                          t.daysLeft < 0
                            ? "bg-destructive/10 text-destructive"
                            : t.daysLeft <= 7
                              ? "bg-strong-match/10 text-strong-match"
                              : "bg-muted text-muted-foreground",
                        )}
                      >
                        {t.daysLeft < 0 ? `${Math.abs(t.daysLeft)}d overdue` : `${t.daysLeft}d left`}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Client bid record">
            {clients.length === 0 ? (
              <Empty>No tenders captured yet.</Empty>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Client</TableHead>
                      <TableHead className="text-right">Bids</TableHead>
                      <TableHead className="text-right">Won</TableHead>
                      <TableHead className="text-right">Lost</TableHead>
                      <TableHead className="text-right">Win rate</TableHead>
                      <TableHead className="text-right">Value won</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {clients.map((c) => (
                      <TableRow key={c.client}>
                        <TableCell className="font-medium text-foreground">{c.client}</TableCell>
                        <TableCell className="text-right">{c.bids}</TableCell>
                        <TableCell className="text-right text-success">{c.won}</TableCell>
                        <TableCell className="text-right text-muted-foreground">{c.lost}</TableCell>
                        <TableCell className="text-right">
                          {c.winRate != null ? `${c.winRate}%` : "—"}
                        </TableCell>
                        <TableCell className="text-right">{money(c.value)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </Card>
        </TabsContent>

        {/* ---------------- Compliance ---------------- */}
        <TabsContent value="compliance" className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi
              icon={<ShieldCheck className="size-4" />}
              label="Letters on file"
              value={String(compliance.total)}
              sub={`${compliance.vendors} vendors`}
            />
            <Kpi icon={<ShieldCheck className="size-4" />} label="Valid" value={String(compliance.valid)} tone="good" />
            <Kpi
              icon={<AlertTriangle className="size-4" />}
              label="Expiring soon"
              value={String(compliance.expiringSoon)}
              tone={compliance.expiringSoon > 0 ? "warn" : undefined}
            />
            <Kpi
              icon={<AlertTriangle className="size-4" />}
              label="Expired"
              value={String(compliance.expired)}
              tone={compliance.expired > 0 ? "bad" : undefined}
            />
          </div>

          <Card title="Capability vs paperwork by practice area" icon={<Layers className="size-4" />}>
            {readiness.length === 0 ? (
              <Empty>
                Tag candidates and OEM letters with practice areas to see where you have people but no
                authorisation — or authorisation but nobody to deliver.
              </Empty>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Practice area</TableHead>
                      <TableHead className="text-right">People</TableHead>
                      <TableHead className="text-right">OEM letters</TableHead>
                      <TableHead>Readiness</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {readiness.map((r) => {
                      const missingPaperwork = r.people > 0 && r.letters === 0;
                      const missingPeople = r.letters > 0 && r.people === 0;
                      return (
                        <TableRow key={r.name}>
                          <TableCell className="font-medium text-foreground">{r.name}</TableCell>
                          <TableCell className="text-right">{r.people}</TableCell>
                          <TableCell className="text-right">{r.letters}</TableCell>
                          <TableCell>
                            {missingPaperwork ? (
                              <span className="rounded-lg bg-strong-match/10 px-2 py-0.5 text-label-md text-strong-match">
                                No OEM letter
                              </span>
                            ) : missingPeople ? (
                              <span className="rounded-lg bg-muted px-2 py-0.5 text-label-md text-muted-foreground">
                                No resources
                              </span>
                            ) : (
                              <span className="rounded-lg bg-success/10 px-2 py-0.5 text-label-md text-success">
                                Covered
                              </span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </Card>

          <Card title="Certification coverage across the active pool">
            {certs.length === 0 ? (
              <Empty>No certifications captured on active candidates yet.</Empty>
            ) : (
              <div className="space-y-2.5">
                {certs.map((c) => (
                  <div key={c.name}>
                    <div className="flex items-baseline justify-between gap-2 text-body-sm">
                      <span className="truncate text-foreground">{c.name}</span>
                      <span className="shrink-0 text-muted-foreground">
                        {c.count} {c.count === 1 ? "person" : "people"}
                      </span>
                    </div>
                    <Bar value={c.count} total={certs[0].count} className="bg-success" />
                  </div>
                ))}
              </div>
            )}
          </Card>
        </TabsContent>

        {/* ---------------- Operations ---------------- */}
        <TabsContent value="ops" className="space-y-4">
          <Card title="Placement trends">
            <PlacementTrendsChart data={trend} />
          </Card>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card title="Open requirement ageing">
              <div className="space-y-2.5">
                {ageing.map((a, i) => (
                  <div key={a.name}>
                    <div className="flex items-baseline justify-between gap-2 text-body-sm">
                      <span className="text-foreground">{a.name}</span>
                      <span className="text-muted-foreground">{a.count}</span>
                    </div>
                    <Bar
                      value={a.count}
                      total={Math.max(...ageing.map((x) => x.count), 1)}
                      className={i >= 2 ? "bg-destructive" : "bg-primary"}
                    />
                  </div>
                ))}
              </div>
            </Card>

            <Card title="Match quality distribution">
              {allMatches.length === 0 ? (
                <Empty>Run matching on a requirement or tender to populate this.</Empty>
              ) : (
                <div className="space-y-2.5">
                  {scoreBands.map((b, i) => (
                    <div key={b.name}>
                      <div className="flex items-baseline justify-between gap-2 text-body-sm">
                        <span className="text-foreground">{b.name}</span>
                        <span className="text-muted-foreground">{b.count}</span>
                      </div>
                      <Bar
                        value={b.count}
                        total={Math.max(...scoreBands.map((x) => x.count), 1)}
                        className={
                          i === 0 ? "bg-success" : i === 1 ? "bg-strong-match" : "bg-muted-foreground/40"
                        }
                      />
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>

          <Card title="Recruiter leaderboard">
            {recruiters.length === 0 ? (
              <Empty>No placements recorded yet.</Empty>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Recruiter</TableHead>
                      <TableHead className="text-right">Placements</TableHead>
                      <TableHead className="text-right">Fees</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recruiters.map((r) => (
                      <TableRow key={r.recruiterId}>
                        <TableCell className="font-medium text-foreground">
                          {nameById.get(r.recruiterId) ?? "Unattributed"}
                        </TableCell>
                        <TableCell className="text-right">{r.placements}</TableCell>
                        <TableCell className="text-right">{money(r.revenue)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// --- Presentation helpers ----------------------------------------------------

function Kpi({
  icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  tone?: "good" | "warn" | "bad";
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-card">
      <div className="flex items-center gap-2 text-label-sm uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </div>
      <div
        className={cn(
          "mt-1 text-display font-semibold",
          tone === "good"
            ? "text-success"
            : tone === "warn"
              ? "text-strong-match"
              : tone === "bad"
                ? "text-destructive"
                : "text-foreground",
        )}
      >
        {value}
      </div>
      {sub && <div className="mt-0.5 text-body-sm text-muted-foreground">{sub}</div>}
    </div>
  );
}

function Card({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-card">
      <h2 className="mb-3 flex items-center gap-2 text-headline-sm font-semibold text-foreground">
        {icon}
        {title}
      </h2>
      {children}
    </div>
  );
}

function Bar({ value, total, className }: { value: number; total: number; className: string }) {
  const width = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div className={cn("h-full rounded-full", className)} style={{ width: `${width}%` }} />
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-6 text-center text-body-sm text-muted-foreground">{children}</p>;
}
