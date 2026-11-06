"use client";

import { Badge, Button, Card, CardHeader, EmptyState, StatusBadge } from "@openpromoter/ui";
import { Check, RefreshCw, ShieldCheck, X } from "@openpromoter/ui/icons";
import Link from "next/link";
import { useAction } from "@/components/use-action";
import { rescoreAction, resolveFlagAction } from "../growth-actions";

type F = {
  id: string;
  partnerId: string;
  name: string;
  email: string;
  signal: string;
  score: number;
  detail: string;
  resolution: string;
  createdAt: string;
};

export function FraudView({
  programId,
  canWrite,
  flags,
}: {
  programId: string;
  canWrite: boolean;
  flags: F[];
}) {
  const { pending, run } = useAction();
  return (
    <Card>
      <CardHeader
        title="Flags"
        description="Newest first"
        action={
          canWrite ? (
            <Button size="sm" loading={pending} onClick={() => run(() => rescoreAction(programId))}>
              <RefreshCw /> Re-run checks
            </Button>
          ) : null
        }
      />
      {flags.length ? (
        <ul className="divide-y divide-border border-t border-border">
          {flags.map((f) => (
            <li key={f.id} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-[13px]">
                  <Badge tone={f.score >= 70 ? "danger" : "warning"}>{f.score}</Badge>
                  <span className="font-medium text-fg">{f.signal}</span>
                  <Link
                    href={`/app/${programId}/partners/${f.partnerId}`}
                    className="text-muted hover:underline"
                  >
                    {f.name}
                  </Link>
                  {f.resolution !== "open" ? <StatusBadge status={f.resolution} /> : null}
                </div>
                <p className="mt-0.5 text-[13px] text-muted">{f.detail}</p>
              </div>
              {f.resolution === "open" && canWrite ? (
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => run(() => resolveFlagAction(programId, f.id, "dismissed"))}
                  >
                    <Check /> Looks fine
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-danger"
                    onClick={() =>
                      window.confirm("Ban this partner and keep their commissions held?") &&
                      run(() => resolveFlagAction(programId, f.id, "confirmed"))
                    }
                  >
                    <X /> Confirm fraud and ban
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          icon={ShieldCheck}
          mascot="guard"
          title="No fraud signals"
          description="Checks run on every sale and daily for every partner."
        />
      )}
    </Card>
  );
}
