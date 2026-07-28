import { cn } from "@/lib/utils";
import {
  expiryStatus,
  daysUntilExpiry,
  EXPIRY_LABELS,
  type ExpiryStatus,
} from "@/lib/oem-letters";

const STYLES: Record<ExpiryStatus, string> = {
  valid: "bg-success/10 text-success",
  expiring_soon: "bg-strong-match/10 text-strong-match",
  expired: "bg-destructive/10 text-destructive",
  unknown: "bg-muted text-muted-foreground",
};

/**
 * Validity badge for an OEM letter. Shows the countdown for letters inside the
 * warning window so the urgency is obvious at a glance.
 */
export function ExpiryBadge({ expiryDate }: { expiryDate: string | null }) {
  const status = expiryStatus(expiryDate);
  const days = daysUntilExpiry(expiryDate);

  let label: string = EXPIRY_LABELS[status];
  if (status === "expiring_soon" && days !== null) {
    label = days === 0 ? "Expires today" : `Expires in ${days} day${days === 1 ? "" : "s"}`;
  } else if (status === "expired" && days !== null) {
    const ago = Math.abs(days);
    label = `Expired ${ago} day${ago === 1 ? "" : "s"} ago`;
  }

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-0.5 text-label-md font-medium",
        STYLES[status],
      )}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}
