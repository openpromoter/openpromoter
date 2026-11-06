"use client";

import { Button, Card, Input, Select } from "@openpromoter/ui";
import { Mail } from "@openpromoter/ui/icons";
import { useAction } from "@/components/use-action";
import { subscribeReportAction } from "../settings-actions";

export function ReportSubscribe({ programId, email }: { programId: string; email: string }) {
  const { pending, run } = useAction();
  return (
    <Card className="mt-4 flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
      <Mail className="size-5 text-accent-text" />
      <div className="flex-1">
        <div className="text-[13px] font-medium text-fg">Scheduled email report</div>
        <div className="text-xs text-muted">
          An email with what happened, what earned money and what to do next.
        </div>
      </div>
      <form
        className="flex flex-wrap gap-2"
        action={(f) =>
          run(() =>
            subscribeReportAction(programId, String(f.get("email")), String(f.get("frequency")) as "weekly"),
          )
        }
      >
        <Input
          name="email"
          type="email"
          defaultValue={email}
          aria-label="Email"
          className="w-56 max-sm:min-w-0 max-sm:flex-1 max-sm:basis-full"
        />
        <Select name="frequency" defaultValue="weekly" aria-label="Frequency" className="w-32">
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
          <option value="off">Off</option>
        </Select>
        <Button type="submit" loading={pending}>
          Save
        </Button>
      </form>
    </Card>
  );
}
