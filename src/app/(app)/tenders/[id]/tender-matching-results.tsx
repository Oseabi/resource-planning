"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Zap, Eye, Download, Loader2, AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { TENDER_STRONG_MATCH_THRESHOLD, type PoolGap } from "@/lib/matching";
import { runTenderMatch, placeCandidateForTender } from "@/app/(app)/tenders/actions";

export interface TenderMatchView {
  matchId: string;
  candidateId: string;
  name: string;
  role: string | null;
  score: number;
}

function scoreBadgeClass(score: number): string {
  if (score >= 80) return "bg-primary/10 text-primary";
  if (score >= TENDER_STRONG_MATCH_THRESHOLD) return "bg-strong-match/10 text-strong-match";
  return "bg-muted text-muted-foreground";
}

export function TenderMatchingResults({
  tenderId,
  tenderTitle,
  matches,
  poolStrengthValue,
  poolGaps,
}: {
  tenderId: string;
  tenderTitle: string;
  matches: TenderMatchView[];
  poolStrengthValue: number;
  poolGaps: PoolGap[];
}) {
  const router = useRouter();
  const [includeAll, setIncludeAll] = useState(false);
  const [running, startRun] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);
  const [placeFor, setPlaceFor] = useState<TenderMatchView | null>(null);

  const gaps = poolGaps.filter((g) => g.covered === 0);
  const strongCount = matches.filter((m) => m.score >= TENDER_STRONG_MATCH_THRESHOLD).length;

  function handleRunMatch() {
    setNotice(null);
    startRun(async () => {
      const res = await runTenderMatch(tenderId, includeAll);
      if (res.error) setNotice(res.error);
      else router.refresh();
    });
  }

  function exportCsv() {
    const header = ["Candidate", "Current Role", "Score", "Strong Match"];
    const lines = matches.map((m) =>
      [m.name, m.role ?? "", `${m.score}%`, m.score >= TENDER_STRONG_MATCH_THRESHOLD ? "Yes" : "No"]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(","),
    );
    const csv = [header.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${tenderTitle.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-matches.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-body-sm text-muted-foreground">
          <input type="checkbox" checked={includeAll} onChange={(e) => setIncludeAll(e.target.checked)} />
          Include inactive / placed candidates
        </label>
        <div className="flex items-center gap-2">
          {matches.length > 0 && (
            <Button variant="outline" size="sm" onClick={exportCsv}>
              <Download className="size-4" />
              Export Match List
            </Button>
          )}
          <Button onClick={handleRunMatch} disabled={running}>
            {running ? <Loader2 className="size-4 animate-spin" /> : <Zap className="size-4" />}
            Match Candidates
          </Button>
        </div>
      </div>

      {notice && (
        <div className="flex items-center gap-2 rounded-md border border-border bg-muted px-3 py-2 text-body-sm text-foreground">
          <AlertTriangle className="size-4 text-strong-match" />
          {notice}
        </div>
      )}

      {matches.length === 0 ? (
        <div className="rounded-md border border-dashed border-border bg-card p-10 text-center">
          <p className="text-body-md text-muted-foreground">
            No matches yet. Click <span className="font-medium text-foreground">Match Candidates</span> to
            score {includeAll ? "all" : "active"} candidates against this tender.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr]">
          {/* Pool analysis */}
          <div className="space-y-4">
            <div className="rounded-lg border border-border bg-card shadow-card p-4">
              <h2 className="text-headline-sm font-semibold text-foreground">Match Preview</h2>
              <div className="mt-3 rounded-md border border-primary/20 bg-primary/5 p-3 text-body-sm text-foreground">
                <div className="flex items-start gap-2">
                  <Info className="mt-0.5 size-4 shrink-0 text-primary" />
                  <span>
                    Current pool strength is <strong>{poolStrengthValue}%</strong>.{" "}
                    {gaps.length > 0 ? (
                      <>
                        You have no strong match for{" "}
                        <strong>{gaps.map((g) => g.role).join(", ")}</strong> — consider sourcing for
                        {gaps.length === 1 ? " this role" : " these roles"}.
                      </>
                    ) : (
                      <>All required roles have at least one strong match.</>
                    )}
                  </span>
                </div>
              </div>
              {poolGaps.length > 0 && (
                <ul className="mt-3 space-y-1.5">
                  {poolGaps.map((g) => (
                    <li key={g.role} className="flex items-center justify-between text-body-sm">
                      <span className="text-foreground">{g.role}</span>
                      <span
                        className={cn(
                          "rounded-lg px-2 py-0.5 text-label-md font-medium",
                          g.covered > 0 ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive",
                        )}
                      >
                        {g.covered > 0 ? `${g.covered} strong` : "gap"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Strong matches" value={strongCount} />
              <Stat label="Pool strength" value={`${poolStrengthValue}%`} />
            </div>
          </div>

          {/* Matched candidates */}
          <div className="rounded-lg border border-border bg-card shadow-card">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h2 className="text-headline-sm font-semibold text-foreground">Top Matched Candidates</h2>
              <span className="text-body-sm text-muted-foreground">{matches.length} scored</span>
            </div>
            <ul>
              {matches.map((m) => (
                <li key={m.matchId} className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-3 last:border-0">
                  <div className="flex min-w-0 flex-[1_1_100%] items-center gap-3 sm:flex-1">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-label-md font-semibold text-accent-foreground">
                      {m.name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <Link href={`/candidates/${m.candidateId}`} className="block truncate font-medium text-foreground hover:text-primary">
                        {m.name}
                      </Link>
                      <div className="truncate text-body-sm text-muted-foreground">{m.role ?? "—"}</div>
                    </div>
                    <span className={cn("shrink-0 rounded-lg px-2 py-0.5 text-label-md font-semibold", scoreBadgeClass(m.score))}>
                      {m.score}%
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 pl-12 sm:ml-auto sm:gap-3 sm:pl-0">
                    {m.score >= TENDER_STRONG_MATCH_THRESHOLD && (
                      <span className="inline-flex shrink-0 items-center gap-1 text-label-md text-success" title="Strong match">
                        <CheckCircle2 className="size-4" />
                        Strong match
                      </span>
                    )}
                    <Button variant="ghost" size="sm" onClick={() => setPlaceFor(m)}>
                      Place
                    </Button>
                    <Button variant="ghost" size="icon-sm" render={<Link href={`/candidates/${m.candidateId}`} />} nativeButton={false}>
                      <Eye className="size-4" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <PlaceDialog
        tenderId={tenderId}
        match={placeFor}
        onClose={() => setPlaceFor(null)}
        onPlaced={() => {
          setPlaceFor(null);
          setNotice("Candidate placed.");
          router.refresh();
        }}
      />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-border bg-card shadow-card px-4 py-3">
      <div className="text-label-sm uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-display font-semibold text-foreground">{value}</div>
    </div>
  );
}

function PlaceDialog({
  tenderId,
  match,
  onClose,
  onPlaced,
}: {
  tenderId: string;
  match: TenderMatchView | null;
  onClose: () => void;
  onPlaced: () => void;
}) {
  const [fee, setFee] = useState("");
  const [startDate, setStartDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    if (!match) return;
    startTransition(async () => {
      const res = await placeCandidateForTender(tenderId, match.candidateId, Number(fee || 0), startDate);
      if (res.error) setError(res.error);
      else {
        setFee("");
        setStartDate("");
        onPlaced();
      }
    });
  }

  return (
    <Dialog open={!!match} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Place {match?.name}</DialogTitle>
          <DialogDescription>
            Record the placement fee and start date. This marks the candidate as placed.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="tplace-fee">Placement fee</Label>
            <Input id="tplace-fee" type="number" min={0} step="0.01" value={fee} onChange={(e) => setFee(e.target.value)} placeholder="e.g. 15000" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tplace-start">Start date</Label>
            <Input id="tplace-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          {error && <p className="text-body-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button onClick={submit} disabled={pending || !startDate}>
            {pending ? "Placing..." : "Confirm placement"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
