import { letterKindLabel } from "@/lib/reference-letters";
import type { ReferenceLetterKind } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";

/**
 * What the letter is. A reference reads quietly; an award or confirmation
 * letter stands out, because it is the one a bid writer must not count.
 */
export function KindChip({ kind, className }: { kind: ReferenceLetterKind; className?: string }) {
  return (
    <span
      className={cn(
        "rounded-lg px-2 py-0.5 text-label-md font-medium",
        kind === "reference" ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary",
        className,
      )}
    >
      {letterKindLabel(kind)}
    </span>
  );
}
