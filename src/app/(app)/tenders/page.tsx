import Link from "next/link";
import { Plus, FileText } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/layout/empty-state";
import { TenderStatusBadge, StrengthBar } from "@/app/(app)/tenders/tender-badges";
import { RfqUploadZone } from "@/app/(app)/tenders/rfq-upload-zone";
import { poolStrength } from "@/lib/matching";

function formatValue(value: number | null): string {
  if (value == null) return "—";
  if (value >= 1_000_000) return `R${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `R${(value / 1_000).toFixed(0)}k`;
  return `R${value}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });
}

export default async function TendersPage() {
  const supabase = await createClient();

  const { data: tenders } = await supabase
    .from("tenders")
    .select("id, title, client, value, submission_deadline, status")
    .order("created_at", { ascending: false });

  const rows = tenders ?? [];

  // Match strength per tender from persisted matches.
  const strengthByTender = new Map<string, number>();
  if (rows.length) {
    const { data: matches } = await supabase
      .from("matches")
      .select("match_target_id, score")
      .eq("match_target_type", "tender")
      .in(
        "match_target_id",
        rows.map((t) => t.id),
      );
    const grouped = new Map<string, number[]>();
    for (const m of matches ?? []) {
      const list = grouped.get(m.match_target_id) ?? [];
      list.push(m.score);
      grouped.set(m.match_target_id, list);
    }
    for (const [tid, scores] of grouped) strengthByTender.set(tid, poolStrength(scores));
  }

  const liveCount = rows.filter((t) => t.status === "live").length;
  const now = new Date();
  const in7 = new Date(now.getTime() + 7 * 24 * 3600 * 1000);
  const deadlinesSoon = rows.filter((t) => {
    if (!t.submission_deadline || t.status === "won" || t.status === "lost") return false;
    const d = new Date(t.submission_deadline + "T00:00:00");
    return d >= now && d <= in7;
  }).length;
  const strengths = [...strengthByTender.values()];
  const avgStrength = strengths.length
    ? Math.round(strengths.reduce((s, v) => s + v, 0) / strengths.length)
    : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-display font-semibold text-foreground">Tender &amp; RFQ Manager</h1>
          <p className="mt-1 text-body-lg text-muted-foreground">
            Track bids, analyze requirements, and match teams.
          </p>
        </div>
        <Button render={<Link href="/tenders/new" />} nativeButton={false}>
          <Plus className="size-4" />
          Create New Tender
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Live tenders" value={String(liveCount)} />
        <StatCard label="Deadlines (next 7 days)" value={String(deadlinesSoon)} accent={deadlinesSoon > 0} />
        <StatCard label="Avg. match strength" value={strengths.length ? `${avgStrength}%` : "—"} />
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-card shadow-card">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-headline-sm font-semibold text-foreground">Current Tenders</h2>
        </div>
        {rows.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="No tenders yet"
            description="Upload an RFQ below to parse its requirements automatically, or create a tender manually to start tracking a bid."
          />
        ) : (
          <>
            {/* Desktop: data table */}
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tender title</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead>Value</TableHead>
                    <TableHead>Deadline</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Match strength</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((t) => {
                    const strength = strengthByTender.get(t.id);
                    return (
                      <TableRow key={t.id}>
                        <TableCell>
                          <Link href={`/tenders/${t.id}`} className="font-medium text-foreground hover:text-primary">
                            {t.title}
                          </Link>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{t.client ?? "—"}</TableCell>
                        <TableCell className="text-foreground">{formatValue(t.value)}</TableCell>
                        <TableCell className="text-foreground">{formatDate(t.submission_deadline)}</TableCell>
                        <TableCell>
                          <TenderStatusBadge status={t.status} />
                        </TableCell>
                        <TableCell>
                          {strength != null ? (
                            <StrengthBar value={strength} />
                          ) : (
                            <span className="text-body-sm text-muted-foreground">Not matched</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {/* Mobile: stacked cards */}
            <ul className="divide-y divide-border md:hidden">
              {rows.map((t) => {
                const strength = strengthByTender.get(t.id);
                return (
                  <li key={t.id}>
                    <Link href={`/tenders/${t.id}`} className="block px-4 py-3 transition-colors hover:bg-muted/50">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate font-medium text-foreground">{t.title}</div>
                          <div className="truncate text-body-sm text-muted-foreground">
                            {t.client ?? "—"} · {formatValue(t.value)} · Due {formatDate(t.submission_deadline)}
                          </div>
                        </div>
                        <TenderStatusBadge status={t.status} />
                      </div>
                      <div className="mt-2">
                        {strength != null ? (
                          <StrengthBar value={strength} />
                        ) : (
                          <span className="text-body-sm text-muted-foreground">Not matched</span>
                        )}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>

      <RfqUploadZone />
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-card shadow-card px-4 py-3">
      <div className="text-label-sm uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={accent ? "text-display font-semibold text-destructive" : "text-display font-semibold text-foreground"}>
        {value}
      </div>
    </div>
  );
}
