import { cn } from "@/lib/utils";
import type { TenderStatus } from "@/lib/supabase/database.types";

const STATUS_STYLES: Record<TenderStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  live: "bg-primary/10 text-primary",
  submitted: "bg-accent text-accent-foreground",
  won: "bg-success/10 text-success",
  lost: "bg-destructive/10 text-destructive",
};

const STATUS_LABEL: Record<TenderStatus, string> = {
  draft: "Draft",
  live: "Live",
  submitted: "Submitted",
  won: "Won",
  lost: "Lost",
};

export function TenderStatusBadge({ status }: { status: TenderStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg px-2 py-0.5 text-label-md font-medium",
        STATUS_STYLES[status],
      )}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {STATUS_LABEL[status]}
    </span>
  );
}

/** Horizontal match-strength bar: green ≥70, orange ≥40, grey below. */
export function StrengthBar({ value }: { value: number }) {
  const color = value >= 70 ? "bg-success" : value >= 40 ? "bg-strong-match" : "bg-muted-foreground/40";
  return (
    <span className="inline-flex items-center gap-2">
      <span className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
        <span className={cn("block h-full rounded-full", color)} style={{ width: `${Math.min(100, value)}%` }} />
      </span>
      <span className="text-body-sm text-foreground">{value}%</span>
    </span>
  );
}
