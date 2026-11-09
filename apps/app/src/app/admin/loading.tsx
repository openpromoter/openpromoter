import { Card, Skeleton } from "@openpromoter/ui";

/** Every admin page streams in behind this inside the sidebar shell: a title, four figures and a table. */
export default function Loading() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading">
      <div className="mb-7 flex flex-col gap-2.5">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-96 max-w-[70vw]" />
      </div>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Card key={i} className="flex flex-col gap-2.5 p-4">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-8 w-28" />
            <Skeleton className="h-3.5 w-36" />
          </Card>
        ))}
      </div>
      <Card className="mt-4">
        <div className="flex items-center gap-3 border-b border-border px-5 py-3">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="ml-auto h-8 w-28" />
        </div>
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="flex items-center gap-4 border-b border-border px-5 py-3.5 last:border-0">
            <Skeleton className="size-7 rounded-full" />
            <div className="flex flex-col gap-1.5">
              <Skeleton className="h-3.5 w-40" />
              <Skeleton className="h-3 w-56" />
            </div>
            <Skeleton className="ml-auto hidden h-3.5 w-20 sm:block" />
            <Skeleton className="hidden h-3.5 w-16 md:block" />
          </div>
        ))}
      </Card>
    </div>
  );
}
