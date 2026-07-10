"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Sparkles, Zap, Mail, Check, Eye, Download, Loader2, AlertTriangle } from "lucide-react";
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
import { SCORING_WEIGHTS } from "@/lib/scoring";
import { runMatch, sendAlert, placeCandidate } from "@/app/(app)/job-requirements/actions";

export interface MatchView {
  matchId: string;
  candidateId: string;
  name: string;
  role: string | null;
  status: string;
  score: number;
  breakdown: { role: number; skills: number; certifications: number; experience: number; availability: number };
  points: { role: number; skills: number; certifications: number; experience: number; availability: number };
  alertSent: boolean;
}

const CRITERIA = [
  { key: "role", label: "Role match" },
  { key: "skills", label: "Skills overlap" },
  { key: "certifications", label: "Certifications" },
  { key: "experience", label: "Experience" },
  { key: "availability", label: "Availability" },
] as const;

function scoreBadgeClass(score: number): string {
  if (score >= 80) return "bg-primary/10 text-primary";
  if (score >= 70) return "bg-strong-match/10 text-strong-match";
  return "bg-muted text-muted-foreground";
}

function squareClass(sub: number): string {
  if (sub >= 0.8) return "bg-success";
  if (sub >= 0.4) return "bg-strong-match";
  return "bg-border";
}

export function MatchingResults({
  requirementId,
  requirementTitle,
  matches,
  hasManagerEmail,
  emailConfigured,
}: {
  requirementId: string;
  requirementTitle: string;
  matches: MatchView[];
  hasManagerEmail: boolean;
  emailConfigured: boolean;
}) {
  const router = useRouter();
  const [includeAll, setIncludeAll] = useState(false);
  const [running, startRun] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);
  const [placeFor, setPlaceFor] = useState<MatchView | null>(null);
  const [alertingId, setAlertingId] = useState<string | null>(null);

  const top = matches[0] ?? null;
  const avg = matches.length
    ? Math.round(matches.reduce((s, m) => s + m.score, 0) / matches.length)
    : 0;

  function handleRunMatch() {
    setNotice(null);
    startRun(async () => {
      const res = await runMatch(requirementId, includeAll);
      if (res.error) setNotice(res.error);
      else {
        if (res.alertsSent && res.alertsSent > 0) setNotice(`${res.alertsSent} alert email(s) sent.`);
        router.refresh();
      }
    });
  }

  async function handleSendAlert(m: MatchView) {
    setNotice(null);
    setAlertingId(m.matchId);
    const res = await sendAlert(m.matchId);
    setAlertingId(null);
    if (res.status === "sent") {
      setNotice(`Alert sent for ${m.name}.`);
      router.refresh();
    } else if (res.status === "not_configured") {
      setNotice("Email is not configured. Add RESEND_API_KEY to enable match alerts.");
    } else if (res.status === "no_manager") {
      setNotice("No manager email set on this requirement — add one to send alerts.");
    } else {
      setNotice(res.message ?? "Could not send the alert.");
    }
  }

  function exportCsv() {
    const header = [
      "Candidate",
      "Current Role",
      "Score",
      "Role Pts",
      "Skills Pts",
      "Certs Pts",
      "Experience Pts",
      "Availability Pts",
    ];
    const lines = matches.map((m) =>
      [
        m.name,
        m.role ?? "",
        `${m.score}%`,
        Math.round(m.points.role),
        Math.round(m.points.skills),
        Math.round(m.points.certifications),
        Math.round(m.points.experience),
        Math.round(m.points.availability),
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(","),
    );
    const csv = [header.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${requirementTitle.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-matches.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      {/* Action bar */}
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
            score {includeAll ? "all" : "active"} candidates against this requirement.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr]">
          {/* Deep-match insight */}
          <div className="space-y-4">
            <div className="rounded-lg border border-border bg-card shadow-card p-4">
              <div className="flex items-center gap-2 text-headline-sm font-semibold text-foreground">
                <Sparkles className="size-4 text-primary" />
                Deep-Match Insight
              </div>
              {top && (
                <>
                  <div className="mt-3 flex items-center justify-between">
                    <div>
                      <div className="text-label-sm uppercase tracking-wide text-muted-foreground">Top recommendation</div>
                      <Link href={`/candidates/${top.candidateId}`} className="text-headline-sm font-semibold text-primary hover:underline">
                        {top.name}
                      </Link>
                    </div>
                    <span className={cn("rounded-lg px-2 py-1 text-label-md font-semibold", scoreBadgeClass(top.score))}>
                      {top.score}%
                    </span>
                  </div>
                  <p className="mt-2 rounded-md bg-muted px-3 py-2 text-body-sm text-muted-foreground">
                    AI narrative disabled — enable AI to generate a qualitative match summary. The
                    ranking and breakdown below are computed locally.
                  </p>
                  <div className="mt-3 space-y-2">
                    {CRITERIA.map((c) => {
                      const earned = Math.round(top.points[c.key]);
                      const weight = SCORING_WEIGHTS[c.key];
                      return (
                        <div key={c.key}>
                          <div className="flex items-center justify-between text-body-sm">
                            <span className="text-foreground">{c.label}</span>
                            <span className="text-muted-foreground">{earned}/{weight}</span>
                          </div>
                          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                            <div className="h-full rounded-full bg-primary" style={{ width: `${(earned / weight) * 100}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <Button className="mt-4 w-full" onClick={() => setPlaceFor(top)}>
                    Place Candidate
                  </Button>
                </>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Total matched" value={matches.length} />
              <Stat label="Avg score" value={`${avg}%`} />
            </div>
          </div>

          {/* Matched candidates */}
          <div className="rounded-lg border border-border bg-card shadow-card">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h2 className="text-headline-sm font-semibold text-foreground">Matched Candidates</h2>
              <span className="text-body-sm text-muted-foreground">{matches.length} scored</span>
            </div>
            <ul>
              {matches.map((m) => (
                <li key={m.matchId} className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-0">
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
                    {m.score}% Match
                  </span>
                  <div className="flex shrink-0 gap-1" title="Role · Skills · Certs · Experience · Availability">
                    {CRITERIA.map((c) => (
                      <span key={c.key} className={cn("size-3 rounded-sm", squareClass(m.breakdown[c.key]))} />
                    ))}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {m.alertSent ? (
                      <span className="inline-flex items-center gap-1 px-2 text-label-md text-success">
                        <Check className="size-3.5" /> Sent
                      </span>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleSendAlert(m)}
                        disabled={alertingId === m.matchId || !hasManagerEmail}
                        title={!hasManagerEmail ? "Add a manager email to send alerts" : emailConfigured ? "" : "Email not configured"}
                      >
                        {alertingId === m.matchId ? <Loader2 className="size-3.5 animate-spin" /> : <Mail className="size-3.5" />}
                        Send Alert
                      </Button>
                    )}
                    <Button variant="ghost" size="icon-sm" render={<Link href={`/candidates/${m.candidateId}`} />} nativeButton={false}>
                      <Eye className="size-4" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
            <div className="flex items-center gap-4 border-t border-border px-4 py-2 text-label-md text-muted-foreground">
              <Legend className="bg-success" label="High" />
              <Legend className="bg-strong-match" label="Partial" />
              <Legend className="bg-border" label="Missing" />
            </div>
          </div>
        </div>
      )}

      <PlaceDialog
        requirementId={requirementId}
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

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("size-2.5 rounded-sm", className)} />
      {label}
    </span>
  );
}

function PlaceDialog({
  requirementId,
  match,
  onClose,
  onPlaced,
}: {
  requirementId: string;
  match: MatchView | null;
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
      const res = await placeCandidate(requirementId, match.candidateId, Number(fee || 0), startDate);
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
            <Label htmlFor="place-fee">Placement fee</Label>
            <Input id="place-fee" type="number" min={0} step="0.01" value={fee} onChange={(e) => setFee(e.target.value)} placeholder="e.g. 15000" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="place-start">Start date</Label>
            <Input id="place-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
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
