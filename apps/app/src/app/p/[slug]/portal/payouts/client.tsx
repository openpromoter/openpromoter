"use client";

import { Badge, Button, Card, CardBody, CardHeader, cn, Input } from "@openpromoter/ui";
import { Bank, CheckCircle2 } from "@openpromoter/ui/icons";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { BRANDS, BrandIcon } from "@/components/brand";
import { useAction } from "@/components/use-action";
import { payoutMethodAction, stripeOnboardingAction } from "../../portal-actions";

const LABEL: Record<string, string> = {
  stripe: "Bank account (Stripe)",
  paypal: "PayPal",
  wise: "Wise",
  manual: "Bank transfer (arranged with the team)",
};
const SHORT: Record<string, string> = {
  stripe: "Stripe",
  paypal: "PayPal",
  wise: "Wise",
  manual: "Bank transfer",
};
const HINT: Record<string, string> = {
  stripe: "Straight to your bank with the tax form included",
  paypal: "To your PayPal email",
  wise: "To your Wise account with low FX fees",
  manual: "The team pays you by invoice",
};

export function PayoutMethod({
  slug,
  methods,
  current,
  paypal,
  wise,
  stripeReady,
  stripeStarted,
  min,
}: {
  slug: string;
  methods: string[];
  current: string | null;
  paypal: string | null;
  wise: string | null;
  stripeReady: boolean;
  stripeStarted: boolean;
  min: string;
}) {
  const [m, setM] = useState(current ?? methods[0]!);
  const { pending, run } = useAction();
  const [going, start] = useTransition();
  return (
    <Card>
      <CardHeader
        title="How you get paid"
        description={`Payouts go out once you're owed at least ${min}.`}
        action={
          current ? (
            <Badge tone="success" dot>
              {SHORT[current] ?? current}
            </Badge>
          ) : (
            <Badge tone="warning" dot>
              Not set
            </Badge>
          )
        }
      />
      <CardBody className="flex flex-col gap-5">
        <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Payout method">
          {methods.map((x) => {
            return (
              <label
                key={x}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-lg border p-3.5 transition-colors",
                  m === x
                    ? "border-accent bg-accent-soft shadow-[0_0_0_1px_var(--primary)]"
                    : "border-border hover:border-border-strong",
                )}
              >
                <input
                  type="radio"
                  name="method"
                  checked={m === x}
                  onChange={() => setM(x)}
                  className="sr-only"
                />
                {/* a plain glyph with no tile; the card shows the selection */}
                <span className="flex h-5 shrink-0 items-center text-fg">
                  {BRANDS[x] ? <BrandIcon brand={x} size={16} /> : <Bank className="size-4" />}
                </span>
                <span className="min-w-0">
                  <span className="block text-[13px] leading-5 font-medium text-fg">{LABEL[x]}</span>
                  <span className="block text-xs leading-4 text-subtle">{HINT[x]}</span>
                </span>
              </label>
            );
          })}
        </div>
        {m === "stripe" ? (
          <div className="flex flex-col gap-2">
            <p className="text-[13px] leading-5 text-muted">
              Stripe verifies your identity, collects your tax form (W-9 or W-8BEN) and pays straight to your
              bank.
            </p>
            {stripeReady ? (
              <Badge tone="success" icon={CheckCircle2} className="self-start">
                Ready for payouts
              </Badge>
            ) : (
              <Button
                variant="primary"
                className="self-start"
                loading={going}
                onClick={() =>
                  start(async () => {
                    const r = await stripeOnboardingAction(slug);
                    if (!r.ok) return void toast.error(r.error);
                    window.location.href = r.data!;
                  })
                }
              >
                {stripeStarted ? "Finish Stripe setup" : "Set up with Stripe"}
              </Button>
            )}
          </div>
        ) : m === "manual" ? (
          <Button
            variant="primary"
            className="self-start"
            loading={pending}
            onClick={() => run(() => payoutMethodAction(slug, { method: "manual" }))}
          >
            Use bank transfer
          </Button>
        ) : (
          <form
            className="flex flex-col gap-2 sm:flex-row"
            action={(f) =>
              run(() => payoutMethodAction(slug, { method: m as "paypal", email: String(f.get("email")) }))
            }
          >
            <Input
              name="email"
              type="email"
              defaultValue={m === "paypal" ? (paypal ?? "") : (wise ?? "")}
              placeholder={`${LABEL[m]} email`}
              aria-label={`${LABEL[m]} email`}
              required
            />
            <Button type="submit" variant="primary" loading={pending}>
              Save {SHORT[m]}
            </Button>
          </form>
        )}
      </CardBody>
    </Card>
  );
}
