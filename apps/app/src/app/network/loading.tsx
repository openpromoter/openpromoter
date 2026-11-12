import { Card, Skeleton } from "@openpromoter/ui";

/** The marketplace while it loads or a filter changes: the same frame, heading and three program cards. */
export default function Loading() {
  return (
    <div className="min-h-dvh bg-canvas md:p-2" role="status" aria-busy="true" aria-label="Loading">
      <main className="flex min-h-dvh flex-col bg-surface md:min-h-[calc(100dvh-16px)] md:rounded-[14px] md:border md:border-border">
        <div className="flex h-16 items-center border-b border-border px-4 sm:px-8">
          <Skeleton className="h-6 w-36" />
        </div>
        <div className="mx-auto w-full max-w-[1100px] px-4 py-12 sm:px-8 sm:py-16">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="mt-4 h-9 w-[420px] max-w-[80vw]" />
          <Skeleton className="mt-3 h-4 w-[520px] max-w-[85vw]" />
          <div className="mt-8 flex gap-3">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-8 w-52" />
          </div>
          <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Card key={i} className="flex flex-col gap-4 p-5">
                <div className="flex items-center gap-3">
                  <Skeleton className="size-8 rounded-md" />
                  <Skeleton className="h-4 w-32" />
                </div>
                <Skeleton className="h-3.5 w-full" />
                <Skeleton className="h-3.5 w-3/4" />
                {[0, 1, 2, 3].map((j) => (
                  <div key={j} className="flex items-center justify-between">
                    <Skeleton className="h-3.5 w-24" />
                    <Skeleton className="h-3.5 w-20" />
                  </div>
                ))}
              </Card>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
