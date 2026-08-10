"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MessageSquare, Activity as ActivityIcon, Trash2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { addNote, deleteNote, type ActivityEntry } from "@/app/(app)/activity-actions";
import type { ActivityEntityType } from "@/lib/supabase/database.types";

/**
 * Past-tense sentences for recorded events.
 *
 * Kept here rather than written at insert time so the wording can be improved
 * without rewriting history, and so a row whose action is not recognised still
 * renders as something readable instead of disappearing.
 */
const EVENT_LABELS: Record<string, string> = {
  assigned: "Assigned to a seat",
  unassigned: "Removed from a seat",
  placed: "Placed",
  team_confirmed: "Bid team confirmed",
  status_changed: "Status changed",
  matched: "Matching run",
  created: "Created",
  updated: "Updated",
};

function eventLabel(action: string | null): string {
  if (!action) return "Activity";
  return EVENT_LABELS[action] ?? action.replace(/_/g, " ");
}

/** Detail is free-form jsonb, so render only what is a plain scalar. */
function detailLine(detail: Record<string, unknown>): string | null {
  const parts = Object.entries(detail)
    .filter(([, v]) => typeof v === "string" || typeof v === "number")
    .map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function ActivityTimeline({
  entityType,
  entityId,
  entries,
}: {
  entityType: ActivityEntityType;
  entityId: string;
  entries: ActivityEntry[];
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit() {
    if (!body.trim()) return;
    setError(null);
    startTransition(async () => {
      const result = await addNote(entityType, entityId, body);
      if (result.error) {
        setError(result.error);
        return;
      }
      setBody("");
      router.refresh();
    });
  }

  function remove(id: string) {
    setError(null);
    startTransition(async () => {
      const result = await deleteNote(entityType, entityId, id);
      if (result.error) setError(result.error);
      else router.refresh();
    });
  }

  return (
    <div className="rounded-lg border border-border bg-card shadow-card">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-headline-sm font-semibold text-foreground">Notes and activity</h2>
      </div>

      <div className="border-b border-border p-4">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          // Ctrl+Enter to send, so plain Enter can still start a new paragraph.
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
          }}
          rows={2}
          placeholder="Add a note for the team..."
          className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-body-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/20"
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="text-body-sm text-muted-foreground">Ctrl+Enter to post</span>
          <Button size="sm" onClick={submit} disabled={isPending || !body.trim()}>
            <Send className="size-4" />
            {isPending ? "Posting..." : "Post note"}
          </Button>
        </div>
        {error && <p className="mt-2 text-body-sm text-destructive">{error}</p>}
      </div>

      {entries.length === 0 ? (
        <p className="px-4 py-8 text-center text-body-sm text-muted-foreground">
          Nothing recorded yet. Notes you add and actions the system takes will both appear here.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {entries.map((entry) => {
            const isNote = entry.kind === "note";
            const detail = detailLine(entry.detail);
            return (
              <li key={entry.id} className="flex gap-3 px-4 py-3">
                <div
                  className={cn(
                    "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full",
                    isNote ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
                  )}
                >
                  {isNote ? (
                    <MessageSquare className="size-3.5" />
                  ) : (
                    <ActivityIcon className="size-3.5" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-body-sm font-medium text-foreground">
                      {entry.actorName}
                    </span>
                    {!isNote && (
                      <span className="text-body-sm text-muted-foreground">
                        {eventLabel(entry.action)}
                      </span>
                    )}
                    <span className="text-label-md text-muted-foreground">
                      {timeAgo(entry.createdAt)}
                    </span>
                  </div>
                  {isNote && entry.body && (
                    <p className="mt-0.5 whitespace-pre-wrap text-body-sm text-foreground">
                      {entry.body}
                    </p>
                  )}
                  {detail && <p className="mt-0.5 text-body-sm text-muted-foreground">{detail}</p>}
                </div>
                {entry.canDelete && (
                  <button
                    type="button"
                    onClick={() => remove(entry.id)}
                    disabled={isPending}
                    aria-label="Delete entry"
                    className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 className="size-4" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
