import { Badge, Card, CardBody, CardHeader, Progress } from "@openpromoter/ui";
import { Check } from "@openpromoter/ui/icons";
import { formatMoney } from "@/lib/money";
import { PLANS } from "@/lib/plans";
import { aiBudget } from "@/server/ai/provider";
import { planStatus } from "@/server/billing-plans";
import { programCtx } from "@/server/context";
import { PlanButton } from "./plan-button";

const day = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

/** One line on where the plan stands in Stripe: trial, failed payment or a scheduled end. */
function statusLine(s: Awaited<ReturnType<typeof planStatus>>) {
  if (s.status === "past_due")
    return {
      warn: true,
      text: `Your last payment failed. Stripe will try the card again. Update it under Manage billing to keep the ${s.plan.name} plan.`,
    };
  if (s.cancelAt)
    return {
      warn: false,
      text: `Your ${s.plan.name} plan ends on ${day(s.cancelAt)}. You move to Free after that. Use Manage billing to keep it.`,
    };
  if (s.status === "trialing" && s.trialEndsAt)
    return { warn: false, text: `Free trial until ${day(s.trialEndsAt)}. Your card is charged after that.` };
  if (s.status === "incomplete")
    return { warn: true, text: "Your first payment didn't go through. Choose a plan again to retry." };
  return null;
}

export default async function BillingPage({
  params,
  searchParams,
}: {
  params: Promise<{ programId: string }>;
  searchParams: Promise<{ billing?: string }>;
}) {
  const { programId } = await params;
  const paid = (await searchParams).billing === "success";
  const { program: p, role } = await programCtx(programId);
  const s = await planStatus(p.workspaceId);
  const ai = s.hosted ? await aiBudget(p.workspaceId) : null;
  const line = statusLine(s);
  return (
    <>
      {paid ? (
        <p className="rounded-lg border border-border bg-success-soft px-4 py-3 text-[13px] text-fg">
          Thanks for subscribing. Your new plan shows here within a minute.
        </p>
      ) : null}
      <Card>
        <CardHeader
          title={`${s.plan.name} plan`}
          description="Flat monthly price. OpenPromoter never takes a cut of your payouts."
          action={s.over ? <Badge tone="warning">Over limit</Badge> : null}
        />
        <CardBody>
          {line ? (
            <p
              role="status"
              className={`mb-4 rounded-md px-3 py-2 text-[13px] ${line.warn ? "bg-warning-soft text-fg" : "bg-surface-2 text-fg"}`}
            >
              {line.text}
            </p>
          ) : null}
          <div className="mb-2 flex justify-between text-[13px]">
            <span className="text-muted">Partner revenue this month</span>
            <span className="num text-fg">
              {formatMoney(s.usage)} of {formatMoney(s.plan.revenueLimit)}
            </span>
          </div>
          <Progress value={(s.usage / s.plan.revenueLimit) * 100} label="Usage" />
          {s.over ? (
            <p className="mt-2 text-xs text-warning">
              Tracking and payouts keep working. Upgrade to stay within your plan.
            </p>
          ) : null}
          {ai ? (
            <>
              <div className="mt-5 mb-2 flex justify-between text-[13px]">
                <span className="text-muted">AI this month</span>
                <span className="num text-fg">
                  {formatMoney(Math.round(ai.spent / 10_000))} of {formatMoney(ai.limit / 10_000)}
                </span>
              </div>
              <Progress value={Math.min(100, (ai.spent / ai.limit) * 100)} label="AI usage" />
              <p className="mt-2 text-xs text-muted">
                {ai.spent >= ai.limit
                  ? "AI is paused until next month. Every feature keeps working with built-in templates."
                  : "When this runs out, features switch to built-in templates until next month."}
              </p>
            </>
          ) : null}
        </CardBody>
      </Card>
      <div className="grid gap-3 md:grid-cols-4">
        {PLANS.map((pl) => (
          <Card key={pl.id} className={`flex flex-col p-5 ${pl.id === s.plan.id ? "border-accent" : ""}`}>
            <div className="text-[13px] font-medium text-fg">{pl.name}</div>
            <div className="num mt-2 text-[28px] font-medium tracking-tight text-fg">
              {formatMoney(pl.price, "usd", { compact: true })}
              <span className="text-[13px] font-normal tracking-normal text-subtle"> /mo</span>
            </div>
            <ul className="mt-3 flex flex-1 flex-col gap-1.5 text-[13px] text-muted">
              {pl.features.map((f) => (
                <li key={f} className="flex gap-1.5">
                  <Check className="mt-0.5 size-3.5 shrink-0 text-success" />
                  {f}
                </li>
              ))}
            </ul>
            {role === "owner" ? (
              <PlanButton programId={programId} plan={pl.id} current={pl.id === s.plan.id} />
            ) : null}
          </Card>
        ))}
      </div>
    </>
  );
}
