import { cn } from "@/lib/utils";
import type { CandidateAvailability, CandidateStatus } from "@/lib/supabase/database.types";

const STATUS_STYLES: Record<CandidateStatus, string> = {
  active: "bg-primary/10 text-primary",
  inactive: "bg-muted text-muted-foreground",
  placed: "bg-success/10 text-success",
};

const STATUS_LABEL: Record<CandidateStatus, string> = {
  active: "Active",
  inactive: "Inactive",
  placed: "Placed",
};

export function StatusBadge({ status }: { status: CandidateStatus }) {
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

const AVAIL_STYLES: Record<CandidateAvailability, string> = {
  available: "bg-success/10 text-success",
  notice_period: "bg-strong-match/10 text-strong-match",
  unavailable: "bg-muted text-muted-foreground",
};

const AVAIL_LABEL: Record<CandidateAvailability, string> = {
  available: "Available",
  notice_period: "On notice",
  unavailable: "Unavailable",
};

export function AvailabilityBadge({ availability }: { availability: CandidateAvailability }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-lg px-2 py-0.5 text-label-md font-medium",
        AVAIL_STYLES[availability],
      )}
    >
      {AVAIL_LABEL[availability]}
    </span>
  );
}

export function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-lg bg-accent px-2 py-0.5 text-label-md text-accent-foreground">
      {children}
    </span>
  );
}
