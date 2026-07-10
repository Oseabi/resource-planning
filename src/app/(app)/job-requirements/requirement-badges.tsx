import { cn } from "@/lib/utils";
import type { JobRequirementStatus } from "@/lib/supabase/database.types";

const STATUS_STYLES: Record<JobRequirementStatus, string> = {
  open: "bg-primary/10 text-primary",
  on_hold: "bg-strong-match/10 text-strong-match",
  closed: "bg-muted text-muted-foreground",
};

const STATUS_LABEL: Record<JobRequirementStatus, string> = {
  open: "Open",
  on_hold: "On hold",
  closed: "Closed",
};

export function RequirementStatusBadge({ status }: { status: JobRequirementStatus }) {
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
