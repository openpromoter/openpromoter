"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/server/context";

/** Runs a server action, toasts the result and refreshes server data. */
export function useAction() {
  const [pending, start] = useTransition();
  const router = useRouter();
  const run = <T>(
    fn: () => Promise<ActionResult<T>>,
    ok?: string | ((d: T | undefined) => string),
    after?: (d: T | undefined) => void,
  ) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return void toast.error(r.error);
      toast.success(typeof ok === "function" ? ok(r.data) : (r.message ?? ok ?? "Done"));
      after?.(r.data);
      router.refresh();
    });
  return { pending, run };
}
