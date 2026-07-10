import { PageHeaderSkeleton, TableSkeleton } from "@/components/layout/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton />
      <Skeleton className="h-10 w-full max-w-xl rounded-md" />
      <TableSkeleton rows={6} />
    </div>
  );
}
