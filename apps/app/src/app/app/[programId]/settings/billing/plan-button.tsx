"use client";

import { Button } from "@openpromoter/ui";
import { useTransition } from "react";
import { toast } from "sonner";
import { billingPortalAction, choosePlanAction } from "./actions";

export function PlanButton({
  programId,
  plan,
  current,
}: {
  programId: string;
  plan: string;
  current: boolean;
}) {
  const [pending, start] = useTransition();
  return (
    <Button
      className="mt-4"
      variant={current ? "secondary" : "primary"}
      loading={pending}
      disabled={plan === "free" && current}
      onClick={() =>
        start(async () => {
          const r = current ? await billingPortalAction(programId) : await choosePlanAction(programId, plan);
          if (!r.ok) return void toast.error(r.error);
          window.location.href = r.data!;
        })
      }
    >
      {current ? (plan === "free" ? "Current plan" : "Manage billing") : "Choose"}
    </Button>
  );
}
