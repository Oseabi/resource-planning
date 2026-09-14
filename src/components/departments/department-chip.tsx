import type { DepartmentBrand } from "@/lib/departments";
import { cn } from "@/lib/utils";

/**
 * A department's colour as a dot: the exact accent from the corporate site,
 * which is fine at this size because nothing has to be read off it. Data
 * driven, so an admin's change on the settings screen shows without a
 * deploy; the app's own primary stands in for a department with no colour.
 */
export function DepartmentDot({ colour, className }: { colour: string | null; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block size-2 shrink-0 rounded-full", className)}
      style={{ backgroundColor: colour ?? "var(--primary)" }}
    />
  );
}

/**
 * The departments a record is filed under, as chips with their dots. The
 * same chip as the candidate's other tags, so a profile reads as one row.
 */
export function DepartmentChips({
  ids,
  departments,
  emptyLabel,
  title,
  className,
}: {
  ids: string[];
  departments: DepartmentBrand[];
  /** Shown, muted, when the record is filed nowhere. Nothing when omitted. */
  emptyLabel?: string;
  /** A tooltip on every chip, for a list that needs to say why they are there. */
  title?: string;
  className?: string;
}) {
  const filed = departments.filter((d) => ids.includes(d.id));
  if (filed.length === 0) {
    return emptyLabel ? (
      <span className={cn("inline-flex items-center rounded-lg bg-muted px-2 py-0.5 text-label-md text-muted-foreground", className)} title={title}>
        {emptyLabel}
      </span>
    ) : null;
  }
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1", className)}>
      {filed.map((d) => (
        <span
          key={d.id}
          title={title}
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-2 py-0.5 text-label-md text-accent-foreground"
        >
          <DepartmentDot colour={d.colour} />
          {d.name}
        </span>
      ))}
    </span>
  );
}
