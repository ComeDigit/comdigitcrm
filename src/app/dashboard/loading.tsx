import { Skeleton } from "@/components/ui/primitives";

/** Shared skeleton for every dashboard route while Server Components stream. */
export default function DashboardLoading() {
  return (
    <div className="space-y-6 px-6 py-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-72" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
    </div>
  );
}
