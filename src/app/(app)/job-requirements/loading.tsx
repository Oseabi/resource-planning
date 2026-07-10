import { PageHeaderSkeleton, TableSkeleton } from "@/components/layout/skeletons";

export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton withAction />
      <TableSkeleton rows={5} />
    </div>
  );
}
