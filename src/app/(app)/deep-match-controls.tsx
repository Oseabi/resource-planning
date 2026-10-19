"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AI_RERANK_N, parseDeepMatchNote, type Confidence } from "@/lib/deep-match/fields";
import { cn } from "@/lib/utils";

/**
 * Ask the AI to read this seat's shortlist and say who it would interview.
 *
 * One seat per press, deliberately. Ten seats at once would be ten calls and
 * four minutes of a sixty second budget, so there is no button for it.
 */
export function DeepMatchButton({
  positionId,
  matchCount,
}: {
  positionId: string;
  /** Fewer than two and there is nothing to put in an order. */
  matchCount: number;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, start] = useTransition();

  function run() {
    setError(null);
    start(async () => {
      try {
        const res = await fetch("/api/matches/deep-match", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ positionId }),
        });
        // An expired session is answered by the middleware with a redirect to
        // the sign-in page, which fetch follows and reports as a perfectly
        // good 200 of HTML. Without this the button would spin, succeed and
        // do nothing, and the only clue would be that no note appeared.
        if (res.redirected || !res.headers.get("content-type")?.includes("application/json")) {
          setError("Your session has expired. Sign in again, then try once more.");
          return;
        }
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          setError(data.error ?? "The deep match could not be run.");
          return;
        }
        router.refresh();
      } catch {
        setError("The deep match could not be reached.");
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {error && <span className="text-body-sm text-destructive">{error}</span>}
      <Button
        variant="outline"
        size="sm"
        onClick={run}
        disabled={isPending || matchCount < 2}
        title={
          matchCount < 2
            ? "There needs to be more than one candidate on the shortlist to put them in an order."
            : `Ask the AI to read the top ${AI_RERANK_N} and say who it would interview first.`
        }
      >
        {isPending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
        {isPending ? "Reading..." : `Deep match top ${AI_RERANK_N}`}
      </Button>
    </div>
  );
}

const CONFIDENCE_CLASS: Record<Confidence, string> = {
  high: "bg-success/10 text-success",
  medium: "bg-strong-match/10 text-strong-match",
  low: "bg-muted text-muted-foreground",
};

/**
 * What the AI said about one candidate on one seat.
 *
 * Kept visually apart from the score and from the breakdown, and carrying the
 * sentence that says what it is: the ranking on screen is still the computed
 * one, and this changed nothing about it.
 */
export function DeepMatchNoteBlock({
  note,
  currentScore,
}: {
  note: string | null;
  /** What they score now, so a note written against another number says so. */
  currentScore?: number | null;
}) {
  const parsed = parseDeepMatchNote(note);
  if (!parsed?.reason) return null;

  const when = parsed.at ? new Date(parsed.at) : null;
  // A note survives a re-run of matching, so it can outlive the number it was
  // written about. Saying so is the difference between context and a lie.
  const stale =
    parsed.score != null && currentScore != null && parsed.score !== currentScore ? parsed.score : null;
  return (
    <div className="border-t border-border bg-primary/5 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Sparkles className="size-3.5 shrink-0 text-primary" />
        <span className="text-label-sm uppercase tracking-wide text-muted-foreground">
          AI second opinion
        </span>
        {parsed.of > 0 && (
          <span className="rounded-lg bg-muted px-2 py-0.5 text-label-md text-muted-foreground">
            suggested {parsed.rank} of {parsed.of}
          </span>
        )}
        <span className={cn("rounded-lg px-2 py-0.5 text-label-md font-medium", CONFIDENCE_CLASS[parsed.confidence])}>
          {parsed.confidence} confidence
        </span>
      </div>
      <p className="mt-1.5 whitespace-pre-wrap text-body-sm text-foreground">{parsed.reason}</p>
      {stale != null && (
        <p className="mt-1.5 text-label-md text-strong-match">
          Written when this person scored {stale}. They score {currentScore} now, so run the deep
          match again to refresh it.
        </p>
      )}
      <p className="mt-1.5 text-label-md text-muted-foreground">
        An opinion. The score and the order above are computed locally and are not changed by it.
        {parsed.model ? ` Read by ${parsed.model}` : ""}
        {when ? ` on ${when.toLocaleDateString("en-ZA")}` : ""}
      </p>
    </div>
  );
}
