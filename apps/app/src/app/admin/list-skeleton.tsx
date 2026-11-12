import { Card, Skeleton } from "@openpromoter/ui";

/** An admin list while it loads: the page title, the search and tabs row and the table's rows. */
export default function ListSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading">
      <div className="mb-7 flex flex-col gap-2.5">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-96 max-w-[70vw]" />
      </div>
      <Card>
        <div className="flex items-center gap-3 border-b border-border px-5 py-3">
          <Skeleton className="h-8 w-64 max-w-[50vw]" />
          <Skeleton className="ml-auto hidden h-8 w-44 sm:block" />
        </div>
        {Array.from({ length: 10 }, (_, i) => (
          <div key={i} className="flex items-center gap-4 border-b border-border px-5 py-3.5 last:border-0">
            <Skeleton className="h-3.5 w-24" />
            <div className="flex flex-col gap-1.5">
              <Skeleton className="h-3.5 w-44" />
              <Skeleton className="h-3 w-60 max-w-[40vw]" />
            </div>
            <Skeleton className="ml-auto hidden h-3.5 w-24 sm:block" />
            <Skeleton className="hidden h-5 w-16 md:block" />
          </div>
        ))}
      </Card>
    </div>
  );
}
