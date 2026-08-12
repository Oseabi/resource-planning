import Link from "next/link";
import { Briefcase, CalendarRange, FileText, UserSquare2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDate, durationLabel } from "@/lib/availability";
import type { Deployment } from "@/lib/deployments-repo";

const PHASE_LABEL = {
  current: "On now",
  upcoming: "Upcoming",
  finished: "Completed",
} as const;

const PHASE_CLASS = {
  current: "bg-success/10 text-success",
  upcoming: "bg-primary/10 text-primary",
  finished: "bg-muted text-muted-foreground",
} as const;

/** "1 Sep 2026 to 15 Dec 2026", or an open-ended or not-yet-dated equivalent. */
function dateRange(startDate: string | null, endDate: string | null): string {
  if (!startDate) return "Dates set when the bid is won";
  if (!endDate) return `From ${formatDate(startDate)}, open ended`;
  return `${formatDate(startDate)} to ${formatDate(endDate)}`;
}

/**
 * Where this person is committed: which project, which seat, and for how long.
 *
 * Distinct from the Experience tab, which is the work history from their CV.
 * This is the record of what *we* have put them on, which is the thing a
 * resourcing conversation actually turns on.
 */
export function DeploymentsPanel({ deployments }: { deployments: Deployment[] }) {
  return (
    <div className="rounded-lg border border-border bg-card shadow-card">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-4 py-3">
        <h2 className="text-headline-sm font-semibold text-foreground">Placements and proposals</h2>
        <span className="text-body-sm text-muted-foreground">
          {deployments.length === 0
            ? "Not on anything yet"
            : `${deployments.length} record${deployments.length === 1 ? "" : "s"}`}
        </span>
      </div>

      {deployments.length === 0 ? (
        <p className="px-4 py-8 text-center text-body-sm text-muted-foreground">
          Nothing yet. Assign this person to a role on a bid or a job requirement and it will show
          here, with the project and how long they are committed for.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {deployments.map((d) => (
            <li key={d.positionId} className="flex flex-wrap items-start gap-x-3 gap-y-2 px-4 py-3">
              <div
                className={cn(
                  "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md",
                  d.phase === "finished"
                    ? "bg-muted text-muted-foreground"
                    : "bg-accent text-primary",
                )}
              >
                {d.parentType === "tender" ? (
                  <FileText className="size-4" />
                ) : (
                  <UserSquare2 className="size-4" />
                )}
              </div>

              <div className="min-w-0 flex-[1_1_16rem]">
                <Link
                  href={d.href}
                  className="block truncate font-medium text-foreground hover:text-primary"
                >
                  {d.project}
                </Link>
                <div className="truncate text-body-sm text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <Briefcase className="size-3.5 shrink-0" />
                    {d.role}
                  </span>
                  {d.client && <span> · {d.client}</span>}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-body-sm text-muted-foreground">
                  <CalendarRange className="size-3.5 shrink-0" />
                  <span>{dateRange(d.startDate, d.endDate)}</span>
                  {d.startDate && (
                    <span className="text-foreground">
                      · {durationLabel(d.startDate, d.endDate)}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {/* Proposed is the meaningful state on a bid: the seat is held
                    but the person is still in the available pool. */}
                <span
                  className={cn(
                    "rounded-lg px-2 py-0.5 text-label-md font-medium",
                    d.status === "placed"
                      ? "bg-success/10 text-success"
                      : "bg-primary/10 text-primary",
                  )}
                >
                  {d.status === "placed" ? "Placed" : "Proposed"}
                </span>
                <span
                  className={cn(
                    "rounded-lg px-2 py-0.5 text-label-md font-medium",
                    PHASE_CLASS[d.phase],
                  )}
                >
                  {PHASE_LABEL[d.phase]}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
