import Link from "next/link";
import {
  CalendarClock,
  Users,
  AlertTriangle,
  ShieldAlert,
  UploadCloud,
  UserSquare2,
  FilePlus2,
  ArrowRight,
  UserPlus,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { JOB_ALERT_THRESHOLD, TENDER_STRONG_MATCH_THRESHOLD } from "@/lib/scoring";
import { deadlinesAtRisk, poolHealth, categoryBreakdown, complianceSummary } from "@/lib/analytics";
import { seatCount } from "@/lib/positions";
import { expiryStatus, daysUntilExpiry } from "@/lib/oem-letters";
import { ExpiryBadge } from "@/app/(app)/oem-letters/expiry-badge";

/** Bids inside this many days are the ones worth looking at this morning. */
const DEADLINE_WINDOW_DAYS = 14;
/** Everything, so the panel can list bids in deadline order using one helper. */
const ALL_DEADLINES = 3650;

export default async function DashboardPage() {
  const supabase = await createClient();

  const [{ data: tenders }, { data: letters }, { data: candidates }] = await Promise.all([
    supabase
      .from("tenders")
      .select("id, title, client, status, value, submission_deadline, sectors, required_skills"),
    supabase.from("oem_letters").select("id, title, oem_vendor, categories, expiry_date"),
    supabase
      .from("candidates")
      .select(
        "id, status, availability, years_experience, resource_categories, skills, technical_skills, certifications",
      ),
  ]);

  const allTenders = tenders ?? [];
  const allLetters = letters ?? [];
  const allCandidates = candidates ?? [];

  // Only bids still being put together can act on what this page says.
  const openTenders = allTenders.filter((t) => t.status === "draft" || t.status === "live");
  const openTenderIds = openTenders.map((t) => t.id);

  const { data: positions } = openTenderIds.length
    ? await supabase
        .from("positions")
        .select("id, parent_id, role, quantity")
        .eq("parent_type", "tender")
        .in("parent_id", openTenderIds)
    : { data: [] };

  const allPositions = positions ?? [];
  const positionIds = allPositions.map((p) => p.id);

  const [{ data: assignments }, { data: matchRows }] = positionIds.length
    ? await Promise.all([
        supabase.from("assignments").select("position_id, candidate_id").in("position_id", positionIds),
        supabase
          .from("matches")
          .select("candidate_id, match_target_id, score")
          .eq("match_target_type", "position")
          .in("match_target_id", positionIds)
          .gte("score", TENDER_STRONG_MATCH_THRESHOLD)
          .order("score", { ascending: false }),
      ])
    : [{ data: [] }, { data: [] }];

  const allAssignments = assignments ?? [];
  const allMatches = matchRows ?? [];

  // --- Seats, per position and per bid ---------------------------------------
  const takenByPosition = new Map<string, Set<string>>();
  for (const a of allAssignments) {
    const set = takenByPosition.get(a.position_id) ?? new Set<string>();
    set.add(a.candidate_id);
    takenByPosition.set(a.position_id, set);
  }

  const strongByPosition = new Map<string, number>();
  for (const m of allMatches) {
    strongByPosition.set(m.match_target_id, (strongByPosition.get(m.match_target_id) ?? 0) + 1);
  }

  const seatsByTender = new Map<string, { total: number; filled: number; gaps: number }>();
  for (const p of allPositions) {
    const quantity = seatCount(p);
    const filled = Math.min(takenByPosition.get(p.id)?.size ?? 0, quantity);
    const row = seatsByTender.get(p.parent_id) ?? { total: 0, filled: 0, gaps: 0 };
    row.total += quantity;
    row.filled += filled;
    // A gap is an open seat that nobody in the pool is strong enough to fill.
    if (quantity - filled > 0 && (strongByPosition.get(p.id) ?? 0) === 0) row.gaps += 1;
    seatsByTender.set(p.parent_id, row);
  }

  const totalSeats = [...seatsByTender.values()].reduce((s, r) => s + r.total, 0);
  const filledSeats = [...seatsByTender.values()].reduce((s, r) => s + r.filled, 0);
  const gapRoles = [...seatsByTender.values()].reduce((s, r) => s + r.gaps, 0);

  // --- Bids needing attention -------------------------------------------------
  const tenderById = new Map(allTenders.map((t) => [t.id, t]));
  const dated = deadlinesAtRisk(allTenders, ALL_DEADLINES);
  const closingSoon = dated.filter((d) => d.daysLeft <= DEADLINE_WINDOW_DAYS);
  const mostUrgent = closingSoon[0]?.daysLeft;

  const bids = dated.slice(0, 6).map((d) => {
    const seats = seatsByTender.get(d.id) ?? { total: 0, filled: 0, gaps: 0 };
    return {
      id: d.id,
      title: tenderById.get(d.id)?.title ?? "Untitled bid",
      client: d.client,
      daysLeft: d.daysLeft,
      ...seats,
    };
  });

  // --- Ready to assign --------------------------------------------------------
  // The panel this replaces filtered on a match type nothing writes any more, so
  // it was permanently empty. Matching is per position now.
  const positionById = new Map(allPositions.map((p) => [p.id, p]));
  const readyRaw = allMatches
    .filter((m) => m.score >= JOB_ALERT_THRESHOLD)
    .filter((m) => {
      const position = positionById.get(m.match_target_id);
      if (!position) return false;
      const taken = takenByPosition.get(position.id);
      if (taken?.has(m.candidate_id)) return false; // already holds this seat
      return seatCount(position) - (taken?.size ?? 0) > 0; // seat still open
    })
    .slice(0, 6);

  const readyNames = new Map<string, string>();
  if (readyRaw.length) {
    const { data: named } = await supabase
      .from("candidates")
      .select("id, full_name")
      .in("id", [...new Set(readyRaw.map((m) => m.candidate_id))]);
    for (const c of named ?? []) readyNames.set(c.id, c.full_name);
  }

  const ready = readyRaw.map((m) => {
    const position = positionById.get(m.match_target_id)!;
    return {
      candidateId: m.candidate_id,
      name: readyNames.get(m.candidate_id) ?? "Unknown candidate",
      role: position.role,
      tenderId: position.parent_id,
      tenderTitle: tenderById.get(position.parent_id)?.title ?? "Bid",
      score: m.score,
    };
  });

  // --- Pool and compliance ----------------------------------------------------
  const health = poolHealth(allCandidates);
  const categories = categoryBreakdown(allCandidates).slice(0, 6);
  const compliance = complianceSummary(allLetters);
  const watchLetters = allLetters
    .filter((l) => ["expired", "expiring_soon"].includes(expiryStatus(l.expiry_date)))
    .sort((a, b) => (daysUntilExpiry(a.expiry_date) ?? 0) - (daysUntilExpiry(b.expiry_date) ?? 0))
    .slice(0, 4);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-display font-semibold text-foreground">Overview</h1>
          <p className="mt-1 text-body-lg text-muted-foreground">
            What needs attention across your bids and pool today.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <QuickAction href="/candidates" icon={<UploadCloud className="size-4" />} label="Submit CV" />
          <QuickAction href="/job-requirements/new" icon={<UserSquare2 className="size-4" />} label="New requirement" />
          <QuickAction href="/tenders/new" icon={<FilePlus2 className="size-4" />} label="New tender" />
        </div>
      </div>

      {/* Risk strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <RiskTile
          icon={<CalendarClock className="size-4" />}
          label={`Bids closing in ${DEADLINE_WINDOW_DAYS} days`}
          value={closingSoon.length}
          sub={
            mostUrgent === undefined
              ? "Nothing due soon"
              : mostUrgent < 0
                ? `Soonest is ${Math.abs(mostUrgent)} days overdue`
                : `Soonest in ${mostUrgent} days`
          }
          tone={mostUrgent !== undefined && mostUrgent <= 7 ? "bad" : closingSoon.length ? "warn" : undefined}
          href="/tenders"
        />
        <RiskTile
          icon={<Users className="size-4" />}
          label="Unfilled seats"
          value={Math.max(0, totalSeats - filledSeats)}
          sub={totalSeats ? `${filledSeats} of ${totalSeats} filled on open bids` : "No roles defined yet"}
          tone={totalSeats - filledSeats > 0 ? "warn" : "good"}
          href="/tenders"
        />
        <RiskTile
          icon={<AlertTriangle className="size-4" />}
          label="Roles with no strong match"
          value={gapRoles}
          sub={gapRoles ? "Nobody in the pool clears the bar" : "Every open role has a candidate"}
          tone={gapRoles > 0 ? "bad" : "good"}
          href="/tenders"
        />
        <RiskTile
          icon={<ShieldAlert className="size-4" />}
          label="OEM letters at risk"
          value={compliance.expired + compliance.expiringSoon}
          sub={
            compliance.total === 0
              ? "No letters on file"
              : `${compliance.expired} expired, ${compliance.expiringSoon} expiring`
          }
          tone={compliance.expired > 0 ? "bad" : compliance.expiringSoon > 0 ? "warn" : "good"}
          href="/oem-letters"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_340px]">
        {/* Bids needing attention */}
        <SectionCard title="Bids needing attention" href="/tenders" linkLabel="All tenders">
          {bids.length === 0 ? (
            <Empty>No open bids with a submission deadline set.</Empty>
          ) : (
            <ul className="divide-y divide-border">
              {bids.map((b) => {
                const pct = b.total > 0 ? Math.round((b.filled / b.total) * 100) : 0;
                return (
                  <li key={b.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <Link
                          href={`/tenders/${b.id}`}
                          className="block truncate font-medium text-foreground hover:text-primary"
                        >
                          {b.title}
                        </Link>
                        <div className="truncate text-body-sm text-muted-foreground">
                          {b.client ?? "No client set"}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {b.gaps > 0 && (
                          <span className="rounded-lg bg-destructive/10 px-2 py-0.5 text-label-md font-medium text-destructive">
                            {b.gaps} unstaffable
                          </span>
                        )}
                        <span
                          className={cn(
                            "rounded-lg px-2 py-0.5 text-label-md font-semibold",
                            b.daysLeft < 0
                              ? "bg-destructive/10 text-destructive"
                              : b.daysLeft <= 7
                                ? "bg-destructive/10 text-destructive"
                                : b.daysLeft <= DEADLINE_WINDOW_DAYS
                                  ? "bg-strong-match/10 text-strong-match"
                                  : "bg-muted text-muted-foreground",
                          )}
                        >
                          {b.daysLeft < 0 ? `${Math.abs(b.daysLeft)}d overdue` : `${b.daysLeft}d left`}
                        </span>
                      </div>
                    </div>
                    <div className="mt-2 flex items-center gap-3">
                      <FillBar percent={pct} complete={b.total > 0 && b.filled >= b.total} />
                      <span className="shrink-0 text-label-md text-muted-foreground">
                        {b.total > 0 ? `${b.filled} of ${b.total} seats` : "No roles yet"}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </SectionCard>

        {/* Compliance + bench */}
        <div className="space-y-4">
          <SectionCard title="Compliance watch" href="/oem-letters" linkLabel="All letters">
            {watchLetters.length === 0 ? (
              <Empty>No letters expiring in the next 60 days.</Empty>
            ) : (
              <ul className="divide-y divide-border">
                {watchLetters.map((l) => (
                  <li key={l.id} className="flex items-start justify-between gap-2 px-4 py-2.5">
                    <div className="min-w-0">
                      <Link
                        href={`/oem-letters/${l.id}`}
                        className="block truncate text-body-sm font-medium text-foreground hover:text-primary"
                      >
                        {l.oem_vendor}
                      </Link>
                      <div className="truncate text-body-sm text-muted-foreground">{l.title}</div>
                    </div>
                    <ExpiryBadge expiryDate={l.expiry_date} />
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          <SectionCard title="Bench" href="/candidates" linkLabel="All candidates">
            <div className="space-y-2.5 px-4 py-3">
              <BenchRow label="Available now" count={health.available} total={health.total} tone="bg-success" />
              <BenchRow label="On notice" count={health.noticePeriod} total={health.total} tone="bg-strong-match" />
              <BenchRow label="Placed" count={health.placed} total={health.total} tone="bg-primary" />
              <p className="pt-1 text-body-sm text-muted-foreground">
                {health.availablePct}% of the unplaced pool is free right now.
              </p>
            </div>
          </SectionCard>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_340px]">
        {/* Ready to assign */}
        <SectionCard
          title="Ready to assign"
          href="/tenders"
          linkLabel="All tenders"
          subtitle={`Candidates scoring ${JOB_ALERT_THRESHOLD}%+ on a seat that is still open`}
        >
          {ready.length === 0 ? (
            <Empty>
              No unassigned candidate is at {JOB_ALERT_THRESHOLD}%+ on an open seat. Run matching on a
              bid to refresh this.
            </Empty>
          ) : (
            <ul className="divide-y divide-border">
              {ready.map((r, i) => (
                <li key={`${r.candidateId}-${i}`} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0">
                    <Link
                      href={`/candidates/${r.candidateId}`}
                      className="block truncate font-medium text-foreground hover:text-primary"
                    >
                      {r.name}
                    </Link>
                    <div className="truncate text-body-sm text-muted-foreground">
                      {r.role} on {r.tenderTitle}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="rounded-lg bg-primary/10 px-2 py-0.5 text-label-md font-semibold text-primary">
                      {r.score}%
                    </span>
                    <Link
                      href={`/tenders/${r.tenderId}`}
                      className="inline-flex items-center gap-1 text-body-sm text-primary hover:underline"
                    >
                      <UserPlus className="size-3.5" />
                      Assign
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        {/* Practice areas */}
        <SectionCard title="Practice areas" href="/candidates" linkLabel="All candidates">
          {categories.length === 0 ? (
            <Empty>Tag candidates with resource categories to see coverage.</Empty>
          ) : (
            <div className="space-y-2.5 px-4 py-3">
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
                      {c.total}, {c.available} free
                    </span>
                  </div>
                  <FillBar percent={c.total ? Math.round((c.available / c.total) * 100) : 0} />
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
}

function RiskTile({
  icon,
  label,
  value,
  sub,
  tone,
  href,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  sub: string;
  tone?: "good" | "warn" | "bad";
  href: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "rounded-lg border bg-card px-4 py-3 shadow-card transition-all hover:shadow-card-hover",
        tone === "bad"
          ? "border-destructive/30 hover:border-destructive/50"
          : tone === "warn"
            ? "border-strong-match/30 hover:border-strong-match/50"
            : "border-border hover:border-primary/40",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-label-sm uppercase tracking-wide text-muted-foreground">{label}</span>
        <span
          className={cn(
            tone === "bad"
              ? "text-destructive"
              : tone === "warn"
                ? "text-strong-match"
                : "text-muted-foreground",
          )}
        >
          {icon}
        </span>
      </div>
      <div
        className={cn(
          "mt-1 text-display font-semibold",
          tone === "bad" ? "text-destructive" : tone === "warn" ? "text-strong-match" : "text-foreground",
        )}
      >
        {value.toLocaleString()}
      </div>
      <div className="mt-0.5 truncate text-body-sm text-muted-foreground">{sub}</div>
    </Link>
  );
}

function SectionCard({
  title,
  subtitle,
  href,
  linkLabel,
  children,
}: {
  title: string;
  subtitle?: string;
  href: string;
  linkLabel: string;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card shadow-card">
      <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-headline-sm font-semibold text-foreground">{title}</h2>
          {subtitle && <p className="mt-0.5 truncate text-body-sm text-muted-foreground">{subtitle}</p>}
        </div>
        <Link
          href={href}
          className="inline-flex shrink-0 items-center gap-1 text-body-sm text-primary hover:underline"
        >
          {linkLabel}
          <ArrowRight className="size-3.5" />
        </Link>
      </div>
      {children}
    </div>
  );
}

function FillBar({ percent, complete }: { percent: number; complete?: boolean }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div
        className={cn("h-full rounded-full", complete ? "bg-success" : "bg-primary")}
        style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
      />
    </div>
  );
}

function BenchRow({
  label,
  count,
  total,
  tone,
}: {
  label: string;
  count: number;
  total: number;
  tone: string;
}) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-body-sm">
        <span className="text-foreground">{label}</span>
        <span className="text-muted-foreground">{count}</span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full", tone)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function QuickAction({
  href,
  icon,
  label,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-body-sm font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
    >
      <span className="text-primary">{icon}</span>
      {label}
    </Link>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-8 text-center text-body-sm text-muted-foreground">{children}</p>;
}
