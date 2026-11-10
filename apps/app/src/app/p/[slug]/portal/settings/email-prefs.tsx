"use client";

import { Switch } from "@openpromoter/ui";
import { useState } from "react";
import { SettingsCard } from "@/components/page";
import { useAction } from "@/components/use-action";
import { emailPrefsAction } from "../../portal-actions";

/** Optional emails a partner can turn off. Approvals and payouts always arrive. */
export function EmailPrefs({
  slug,
  commissions,
  messages,
}: {
  slug: string;
  commissions: boolean;
  messages: boolean;
}) {
  const [v, setV] = useState({ commissions, messages });
  const { pending, run } = useAction();
  const save = (next: typeof v) => {
    setV(next);
    run(() => emailPrefsAction(slug, next), "Email settings saved");
  };
  const rows = [
    ["commissions", "Commission earned", "An email each time a referral pays you a commission."],
    [
      "messages",
      "Program messages",
      "Updates the program team sends to its partners. They also show under Messages.",
    ],
  ] as const;
  return (
    <SettingsCard
      title="Emails"
      description="Choose what reaches your inbox. Approvals, payouts and sign-in emails always arrive."
    >
      <div className="flex flex-col divide-y divide-border rounded-lg border border-border">
        {rows.map(([key, label, hint]) => (
          <label key={key} className="flex items-center justify-between gap-4 px-4 py-3">
            <span>
              <span className="block text-[13px] font-medium text-fg">{label}</span>
              <span className="mt-0.5 block text-[13px] text-muted">{hint}</span>
            </span>
            <Switch
              checked={v[key]}
              disabled={pending}
              onCheckedChange={(on) => save({ ...v, [key]: on })}
              aria-label={label}
            />
          </label>
        ))}
      </div>
    </SettingsCard>
  );
}
