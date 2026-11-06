import { Card, Skeleton } from "@openpromoter/ui";

/** Portal page skeleton: ticket stub, three figures and a chart. */
export default function Loading() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-7 w-40" />
      <Skeleton className="mt-2.5 h-4 w-72 max-w-[70vw]" />
      <Skeleton className="mt-7 h-24 w-full rounded-lg" />
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Card key={i} className="flex flex-col gap-2.5 p-4">
            <Skeleton className="h-3.5 w-20" />
            <Skeleton className="h-8 w-28" />
          </Card>
        ))}
      </div>
      <Card className="mt-4 p-5">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="mt-6 h-44 w-full" />
      </Card>
    </div>
  );
}
