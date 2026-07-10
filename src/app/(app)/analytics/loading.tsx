import { PageHeaderSkeleton, StatRowSkeleton } from "@/components/layout/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton />
      <StatRowSkeleton count={4} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_300px]">
        <Skeleton className="h-64 rounded-md" />
        <div className="space-y-4">
          <Skeleton className="h-32 rounded-md" />
          <Skeleton className="h-28 rounded-md" />
        </div>
      </div>
      <Skeleton className="h-40 rounded-md" />
    </div>
  );
}
