import Link from "next/link";
import { Users, UserSquare2, FileText, UploadCloud, FilePlus2, ArrowRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RoleDistributionChart, type RoleCount } from "@/components/charts/role-distribution-chart";
import { JOB_ALERT_THRESHOLD } from "@/lib/scoring";
import { cn } from "@/lib/utils";

export default async function DashboardPage() {
  const supabase = await createClient();

  const [
    { count: totalCandidates },
    { count: activeRequirements },
    { count: liveTenders },
    { data: candidates },
    { data: openReqs },
  ] = await Promise.all([
    supabase.from("candidates").select("id", { count: "exact", head: true }),
    supabase.from("job_requirements").select("id", { count: "exact", head: true }).eq("status", "open"),
    supabase.from("tenders").select("id", { count: "exact", head: true }).eq("status", "live"),
    supabase.from("candidates").select("id, full_name, current_role"),
    supabase.from("job_requirements").select("id, title, client").eq("status", "open"),
  ]);

  // Urgent match alerts: ≥80% scores against open requirements.
  const openReqIds = (openReqs ?? []).map((r) => r.id);
  let urgent: { candidate: string; candidateId: string; requirement: string; score: number }[] = [];
  if (openReqIds.length) {
    const { data: matches } = await supabase
      .from("matches")
      .select("candidate_id, match_target_id, score")
      .eq("match_target_type", "job_requirement")
      .in("match_target_id", openReqIds)
      .gte("score", JOB_ALERT_THRESHOLD)
      .order("score", { ascending: false })
      .limit(6);

    const candById = new Map((candidates ?? []).map((c) => [c.id, c.full_name]));
    const reqById = new Map((openReqs ?? []).map((r) => [r.id, r.title]));
    urgent = (matches ?? []).map((m) => ({
      candidate: candById.get(m.candidate_id) ?? "Unknown",
      candidateId: m.candidate_id,
      requirement: reqById.get(m.match_target_id) ?? "Requirement",
      score: m.score,
    }));
  }

  // Role distribution (top 6 primary roles).
  const roleCounts = new Map<string, number>();
  for (const c of candidates ?? []) {
    const role = c.current_role?.trim() || "Unassigned";
    roleCounts.set(role, (roleCounts.get(role) ?? 0) + 1);
  }
  const roleData: RoleCount[] = [...roleCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([role, count]) => ({ role, count }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-display font-semibold text-foreground">Overview</h1>
        <p className="mt-1 text-body-lg text-muted-foreground">
          Resource planning metrics and active matches.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard icon={<Users className="size-4" />} label="Total candidates" value={totalCandidates ?? 0} href="/candidates" />
        <StatCard icon={<UserSquare2 className="size-4" />} label="Active job requirements" value={activeRequirements ?? 0} href="/job-requirements" />
        <StatCard icon={<FileText className="size-4" />} label="Live tenders" value={liveTenders ?? 0} href="/tenders" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_300px]">
        <div className="space-y-4">
          {/* Urgent match alerts */}
          <div className="overflow-hidden rounded-lg border border-border bg-card shadow-card">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h2 className="text-headline-sm font-semibold text-foreground">Urgent Match Alerts</h2>
              <Link href="/job-requirements" className="inline-flex items-center gap-1 text-body-sm text-primary hover:underline">
                View all
                <ArrowRight className="size-3.5" />
              </Link>
            </div>
            {urgent.length === 0 ? (
              <p className="px-4 py-8 text-center text-body-sm text-muted-foreground">
                No matches at {JOB_ALERT_THRESHOLD}%+ yet. Run matching on an open requirement to see
                strong candidates here.
              </p>
            ) : (
              <>
                {/* Desktop: table */}
                <div className="hidden md:block">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Candidate</TableHead>
                        <TableHead>Requirement</TableHead>
                        <TableHead className="text-right">Score</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {urgent.map((u, i) => (
                        <TableRow key={i}>
                          <TableCell>
                            <Link href={`/candidates/${u.candidateId}`} className="font-medium text-foreground hover:text-primary">
                              {u.candidate}
                            </Link>
                          </TableCell>
                          <TableCell className="text-muted-foreground">{u.requirement}</TableCell>
                          <TableCell className="text-right">
                            <span className={cn("rounded-lg px-2 py-0.5 text-label-md font-semibold", u.score >= 80 ? "bg-primary/10 text-primary" : "bg-strong-match/10 text-strong-match")}>
                              {u.score}%
                            </span>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                {/* Mobile: stacked cards */}
                <ul className="divide-y divide-border md:hidden">
                  {urgent.map((u, i) => (
                    <li key={i} className="flex items-start justify-between gap-3 px-4 py-3">
                      <div className="min-w-0">
                        <Link href={`/candidates/${u.candidateId}`} className="block truncate font-medium text-foreground hover:text-primary">
                          {u.candidate}
                        </Link>
                        <div className="truncate text-body-sm text-muted-foreground">{u.requirement}</div>
                      </div>
                      <span className={cn("shrink-0 rounded-lg px-2 py-0.5 text-label-md font-semibold", u.score >= 80 ? "bg-primary/10 text-primary" : "bg-strong-match/10 text-strong-match")}>
                        {u.score}%
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>

          {/* Role distribution */}
          <div className="rounded-lg border border-border bg-card shadow-card p-4">
            <h2 className="mb-2 text-headline-sm font-semibold text-foreground">Role Distribution</h2>
            <RoleDistributionChart data={roleData} />
          </div>
        </div>

        {/* Quick actions */}
        <div className="h-fit rounded-lg border border-border bg-card shadow-card p-4">
          <h2 className="mb-3 text-headline-sm font-semibold text-foreground">Quick Actions</h2>
          <div className="space-y-2">
            <QuickAction
              href="/candidates"
              icon={<UploadCloud className="size-4" />}
              title="Submit CV"
              description="Parse new candidate data"
            />
            <QuickAction
              href="/job-requirements/new"
              icon={<UserSquare2 className="size-4" />}
              title="Create Requirement"
              description="Define a new job role"
            />
            <QuickAction
              href="/tenders/new"
              icon={<FilePlus2 className="size-4" />}
              title="New Tender"
              description="Start project bidding"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  href,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  href: string;
}) {
  return (
    <Link href={href} className="rounded-lg border border-border bg-card shadow-card px-4 py-3 transition-all hover:border-primary/40 hover:shadow-card-hover">
      <div className="flex items-center justify-between">
        <span className="text-label-sm uppercase tracking-wide text-muted-foreground">{label}</span>
        <span className="text-muted-foreground">{icon}</span>
      </div>
      <div className="mt-1 text-display font-semibold text-foreground">{value.toLocaleString()}</div>
    </Link>
  );
}

function QuickAction({
  href,
  icon,
  title,
  description,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-start gap-3 rounded-md border border-border p-3 transition-colors hover:border-primary/40 hover:bg-primary/5"
    >
      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-accent text-primary">
        {icon}
      </span>
      <span>
        <span className="block text-body-sm font-medium text-foreground">{title}</span>
        <span className="block text-body-sm text-muted-foreground">{description}</span>
      </span>
    </Link>
  );
}
