import { Card, Skeleton } from "@openpromoter/ui";

/** A settings tab while it loads. The title and tabs come from the layout, so this is only the cards. */
export function FormSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading" className="flex flex-col gap-4">
      {[3, 2, 2].map((fields, i) => (
        <Card key={i}>
          <div className="flex flex-col gap-2 border-b border-border px-5 py-4">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3.5 w-80 max-w-[70vw]" />
          </div>
          <div className="grid gap-4 px-5 py-5 sm:grid-cols-2">
            {Array.from({ length: fields }, (_, j) => (
              <div key={j} className="flex flex-col gap-2">
                <Skeleton className="h-3.5 w-28" />
                <Skeleton className="h-8 w-full" />
              </div>
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}

/** A settings tab that is a list (team, audit log, programs): one card of rows. */
export function RowsSkeleton() {
  return (
    <Card role="status" aria-busy="true" aria-label="Loading">
      <div className="flex flex-col gap-2 border-b border-border px-5 py-4">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3.5 w-72 max-w-[70vw]" />
      </div>
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="flex items-center gap-4 border-b border-border px-5 py-3 last:border-0">
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="h-3.5 w-48 max-w-[40vw]" />
          <Skeleton className="ml-auto h-3.5 w-20" />
        </div>
      ))}
    </Card>
  );
}
