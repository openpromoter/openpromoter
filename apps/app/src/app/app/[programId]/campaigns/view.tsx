"use client";

import type { CampaignRule } from "@openpromoter/db";
import { Badge, Button, Card, CardHeader, EmptyState, StatusBadge } from "@openpromoter/ui";
import { Check, Megaphone, Rocket, Sparkles, X } from "@openpromoter/ui/icons";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useAction } from "@/components/use-action";
import { describeRule } from "@/lib/campaign-labels";
import { formatMoney } from "@/lib/money";
import {
  createCampaignAction,
  draftCampaignAction,
  endCampaignAction,
  reviewSubmissionAction,
} from "../growth-actions";

type C = {
  id: string;
  name: string;
  description: string | null;
  rule: CampaignRule;
  status: string;
  startsAt: string;
  endsAt: string | null;
};
type Draft = Omit<C, "id" | "status"> & { description: string };

const EXAMPLES = [
  "Double commissions for annual plans this month",
  "$5 per signup for 14 days",
  "Pay $50 per YouTube review",
  "Contest this month: top 3 by revenue win $500, $250 and $100",
];

export function CampaignsView({
  programId,
  currency,
  canWrite,
  autoFocus,
  campaigns,
  standings,
  submissions,
}: {
  programId: string;
  currency: string;
  canWrite: boolean;
  autoFocus: boolean;
  campaigns: C[];
  standings: Record<string, { partnerId: string; name: string; value: number }[]>;
  submissions: {
    id: string;
    url: string;
    note: string | null;
    status: string;
    partnerName: string;
    campaignName: string;
    reward: number;
  }[];
}) {
  const [text, setText] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [drafting, start] = useTransition();
  const { pending, run } = useAction();
  const d = (s: string | null) =>
    s ? new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "no end date";
  const live = campaigns.filter((c) => c.status === "active" || c.status === "draft");
  // an active campaign with a future start (Black Friday booked in November) isn't live yet
  const scheduled = (c: C) => c.status === "active" && new Date(c.startsAt).getTime() > Date.now();
  const upcoming = live.filter(scheduled).length;
  const ended = campaigns.filter((c) => !(c.status === "active" || c.status === "draft"));
  const row = (c: C) => (
    <li key={c.id} className="px-5 py-3.5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[13px] font-medium text-fg">{c.name}</span>
            {scheduled(c) ? <Badge tone="info">Scheduled</Badge> : <StatusBadge status={c.status} />}
          </div>
          <p className="mt-0.5 truncate text-[13px] text-muted">{describeRule(c.rule, currency)}</p>
        </div>
        <span className="num text-xs text-subtle">
          {d(c.startsAt)} → {d(c.endsAt)}
        </span>
        {c.status === "active" && canWrite ? (
          <Button size="sm" variant="ghost" onClick={() => run(() => endCampaignAction(programId, c.id))}>
            End now
          </Button>
        ) : null}
      </div>
      {standings[c.id]?.length ? (
        <ol className="mt-3 flex max-w-md flex-col gap-1.5 rounded-md bg-surface-2 px-3 py-2.5 dark:bg-surface-3">
          {standings[c.id]!.map((s, i) => (
            <li key={s.partnerId} className="flex items-center text-[13px]">
              <span className="num w-5 text-xs text-subtle">{i + 1}</span>
              <span className="truncate text-fg">{s.name}</span>
              <span className="leader" aria-hidden />
              <span className="num text-fg">
                {c.rule.metric === "revenue" ? formatMoney(s.value, currency) : s.value}
              </span>
            </li>
          ))}
        </ol>
      ) : null}
    </li>
  );
  return (
    <div className="flex flex-col gap-4">
      {canWrite ? (
        <form
          className="rounded-lg border border-border-strong bg-surface focus-within:border-fg/40 dark:bg-surface-2"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const r = await draftCampaignAction(programId, text);
              if (!r.ok) return void toast.error(r.error);
              setDraft(r.data as Draft);
            });
          }}
        >
          <div className="flex items-center gap-2.5 pr-2.5 pl-3.5">
            <Sparkles className="size-4 shrink-0 text-subtle" aria-hidden />
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              // biome-ignore lint/a11y/noAutofocus: only when the user came here to start a campaign
              autoFocus={autoFocus}
              placeholder="Describe a campaign in one sentence"
              aria-label="Describe a campaign"
              className="h-12 min-w-0 flex-1 bg-transparent text-[14px] text-fg placeholder:text-subtle"
              required
            />
            <Button type="submit" variant="primary" size="sm" loading={drafting}>
              Draft it
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t border-border px-3.5 py-2.5">
            <span className="text-xs text-subtle">Try</span>
            {EXAMPLES.map((x) => (
              <button
                key={x}
                type="button"
                onClick={() => setText(x)}
                className="h-6 rounded-[4px] bg-surface-2 px-2 text-xs text-muted hover:bg-surface-3 hover:text-fg dark:bg-surface-3"
              >
                {x}
              </button>
            ))}
          </div>
          {draft ? (
            <div className="border-t border-border p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[14px] font-medium text-fg">{draft.name}</span>
                <Badge tone="primary">{draft.rule.kind}</Badge>
              </div>
              <p className="mt-1 text-[13px] text-fg">{describeRule(draft.rule, currency)}</p>
              <p className="num mt-0.5 text-xs text-subtle">
                {d(draft.startsAt)} → {d(draft.endsAt)}
              </p>
              <div className="mt-3 flex gap-2">
                <Button
                  type="button"
                  variant="primary"
                  loading={pending}
                  onClick={() =>
                    run(
                      () => createCampaignAction(programId, draft),
                      undefined,
                      () => {
                        setDraft(null);
                        setText("");
                      },
                    )
                  }
                >
                  <Rocket /> Launch and notify partners
                </Button>
                <Button type="button" variant="ghost" onClick={() => setDraft(null)}>
                  Discard
                </Button>
              </div>
            </div>
          ) : null}
        </form>
      ) : null}

      {campaigns.length ? (
        <>
          {live.length ? (
            <Card>
              <CardHeader
                title="Running"
                description={`${live.length - upcoming} live now${upcoming ? `, ${upcoming} scheduled` : ""}`}
              />
              <ul className="divide-y divide-border border-t border-border">{live.map(row)}</ul>
            </Card>
          ) : null}
          {ended.length ? (
            <Card>
              <CardHeader title="Ended" />
              <ul className="divide-y divide-border border-t border-border">{ended.map(row)}</ul>
            </Card>
          ) : null}
        </>
      ) : (
        <Card>
          <EmptyState
            icon={Megaphone}
            mascot="thinking"
            title="No campaigns yet"
            description="Campaigns are the fastest way to wake partners up. Try one of the examples above."
          />
        </Card>
      )}

      {submissions.length ? (
        <Card>
          <CardHeader
            title="Bounty submissions"
            description="Posts and videos partners submitted for content bounties"
          />
          <ul className="divide-y divide-border border-t border-border">
            {submissions.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 px-5 py-2.5 text-[13px]">
                <StatusBadge status={s.status} />
                <span className="text-fg">{s.partnerName}</span>
                <a
                  // older submissions predate the https-only check; never link anything else
                  href={/^https?:\/\//i.test(s.url) ? s.url : undefined}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="min-w-0 flex-1 truncate text-accent-text hover:underline"
                >
                  {s.url}
                </a>
                <span className="num text-muted">{formatMoney(s.reward, currency)}</span>
                {s.status === "pending" && canWrite ? (
                  <span className="flex gap-1">
                    <Button
                      size="sm"
                      onClick={() => run(() => reviewSubmissionAction(programId, s.id, true))}
                    >
                      <Check /> Approve
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Reject"
                      onClick={() => run(() => reviewSubmissionAction(programId, s.id, false))}
                    >
                      <X />
                    </Button>
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
