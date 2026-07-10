import { PageHeaderSkeleton, StatRowSkeleton, TableSkeleton } from "@/components/layout/skeletons";

export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton withAction />
      <StatRowSkeleton count={3} />
      <TableSkeleton rows={5} />
    </div>
  );
}
