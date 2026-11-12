import { Card, Skeleton } from "@openpromoter/ui";

/** One workspace while it loads: the header, then its cards of facts in two columns. */
export default function Loading() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-4 w-28" />
      <div className="mt-4 mb-7 flex flex-col gap-2.5">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-80 max-w-[70vw]" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <Card key={i} className="flex flex-col gap-3.5 p-5">
            <Skeleton className="h-4 w-36" />
            {[0, 1, 2, 3].map((j) => (
              <div key={j} className="flex items-center justify-between gap-6">
                <Skeleton className="h-3.5 w-28" />
                <Skeleton className="h-3.5 w-20" />
              </div>
            ))}
          </Card>
        ))}
      </div>
    </div>
  );
}
