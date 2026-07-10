import { Skeleton } from "@/components/ui/skeleton";

/** Page title + subtitle placeholder used at the top of every route skeleton. */
export function PageHeaderSkeleton({ withAction = false }: { withAction?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="space-y-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-72" />
      </div>
      {withAction && <Skeleton className="h-8 w-40 rounded-lg" />}
    </div>
  );
}

/** Card-bordered placeholder that stands in for a list/table while it loads. */
export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card shadow-card">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex items-center justify-between gap-4 border-b border-border px-4 py-3.5 last:border-0"
        >
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
      ))}
    </div>
  );
}

/** Row of KPI/stat card placeholders. */
export function StatRowSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="space-y-2 rounded-lg border border-border bg-card shadow-card px-4 py-3">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-7 w-12" />
        </div>
      ))}
    </div>
  );
}
