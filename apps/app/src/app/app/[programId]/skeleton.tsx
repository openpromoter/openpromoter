import { Card, Skeleton } from "@openpromoter/ui";

/** Shown inside the shell while a dashboard page streams in: the same rhythm as a real page. */
export default function Loading() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading">
      <div className="mb-7 flex items-end justify-between gap-4">
        <div className="flex flex-col gap-2.5">
          <Skeleton className="h-7 w-44" />
          <Skeleton className="h-4 w-80 max-w-[70vw]" />
        </div>
        <Skeleton className="hidden h-8 w-48 sm:block" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Card key={i} className="flex flex-col">
            <div className="flex h-11 items-center border-b border-border px-4">
              <Skeleton className="h-3.5 w-24" />
            </div>
            <div className="flex flex-col gap-2.5 px-4 pt-4 pb-4">
              <Skeleton className="h-8 w-32" />
              <Skeleton className="h-3.5 w-40" />
              <Skeleton className="mt-3 hidden h-8 w-full sm:block" />
            </div>
          </Card>
        ))}
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="mt-2 h-3.5 w-28" />
          <div className="mt-6 flex h-52 items-end gap-1.5">
            {[40, 62, 48, 70, 55, 80, 66, 90, 58, 74, 84, 64, 96, 72, 88, 60, 78, 92, 68, 86].map((h, i) => (
              <Skeleton key={i} className="flex-1 rounded-[3px]" style={{ height: `${h}%` }} />
            ))}
          </div>
        </Card>
        <Card className="flex flex-col gap-3 p-5">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-9 w-44" />
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-3.5 w-full" />
          ))}
        </Card>
      </div>
      <Card className="mt-4">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="flex items-center gap-3 border-b border-border px-5 py-3.5 last:border-0">
            <Skeleton className="size-7 rounded-full" />
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="ml-auto h-3.5 w-20" />
          </div>
        ))}
      </Card>
    </div>
  );
}
