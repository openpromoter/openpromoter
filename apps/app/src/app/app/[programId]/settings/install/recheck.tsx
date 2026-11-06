"use client";

import { Button } from "@openpromoter/ui";
import { RotateCcw } from "@openpromoter/ui/icons";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

/** The checklist is read fresh on every render, so checking again is a refresh. */
export function Recheck() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button size="sm" variant="secondary" loading={pending} onClick={() => start(() => router.refresh())}>
      <RotateCcw /> Check again
    </Button>
  );
}
