"use client";

import { Badge, Button, cn, Field, Input, Textarea } from "@openpromoter/ui";
import { ArrowRight, Check, CheckCircle2, Sparkles, Terminal } from "@openpromoter/ui/icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { CopyButton, CopyField } from "@/components/copy";
import { Logo } from "@/components/logo";
import { mascotToast } from "@/components/mascot-toast";
import type { ProgramDesign } from "@/server/ai/designer";
import {
  acceptDesignAction,
  connectStripeAction,
  createProgramAction,
  installStatusAction,
  proposeDesignAction,
} from "./actions";

type Initial = {
  programId: string;
  name: string;
  color: string;
  logoUrl: string | null;
  stripeConnected: boolean;
  webhookUrl: string;
  oauthUrl: string | null;
  installed: boolean;
  snippets: { script: string; checkout: string; npm: string; prompt: string };
  step: number;
} | null;

const STEPS = [
  ["Your product", "Website, name and brand"],
  ["Connect Stripe", "Payments for attribution"],
  ["Design program", "Commission and terms"],
  ["Install", "One line of tracking"],
  ["Done", "Invite your partners"],
] as const;
const nn = (n: number) => String(n).padStart(2, "0");

/** Code in Plex Mono with line numbers and a copy action. */
function Code({ code, label }: { code: string; label?: string }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface-2/60 dark:bg-surface-2">
      <div className="flex h-9 items-center justify-between border-b border-border pr-1 pl-3.5">
        <span className="eyebrow truncate">{label ?? "Code"}</span>
        <CopyButton value={code} label="Copy code" />
      </div>
      <pre className="overflow-x-auto py-3 font-mono text-[12.5px] leading-5 text-fg">
        {code.split("\n").map((line, i) => (
          <div key={i} className="flex">
            <span className="w-10 shrink-0 pr-3 text-right text-subtle select-none">{i + 1}</span>
            <span className="pr-4 whitespace-pre">{line || " "}</span>
          </div>
        ))}
      </pre>
    </div>
  );
}

export function Wizard({
  initial,
  userName,
  appUrl,
}: {
  initial: Initial;
  userName: string;
  appUrl: string;
}) {
  const step = initial ? Math.min(5, Math.max(2, initial.step)) : 1;
  const router = useRouter();
  const go = (n: number) => router.push(`/onboarding?program=${initial?.programId}&step=${n}`);
  return (
    <div className="min-h-dvh bg-canvas md:grid md:grid-cols-[288px_1fr]">
      <aside className="sticky top-0 hidden h-dvh flex-col px-7 py-6 md:flex" aria-label="Setup steps">
        <Logo />
        <div className="mt-14">
          <span className="eyebrow">Set up your program</span>
          <ol className="mt-5 flex flex-col" aria-label="Setup progress">
            {STEPS.map(([label, hint], i) => {
              const n = i + 1;
              const state = n < step ? "done" : n === step ? "current" : "next";
              return (
                <li
                  key={label}
                  className="relative flex gap-3.5 pb-7 last:pb-0"
                  aria-current={state === "current" ? "step" : undefined}
                >
                  {n < STEPS.length ? (
                    <span
                      aria-hidden
                      className={cn(
                        "absolute top-8 bottom-1 left-[13px] w-px",
                        state === "done" ? "bg-primary" : "bg-border-strong",
                      )}
                    />
                  ) : null}
                  <span
                    className={cn(
                      "relative flex size-7 shrink-0 items-center justify-center rounded-full font-mono text-[11px]",
                      state === "done" && "bg-primary text-primary-fg",
                      state === "current" && "bg-surface text-fg ring-1 ring-accent",
                      state === "next" && "border border-border-strong text-subtle",
                    )}
                  >
                    {state === "done" ? <Check className="size-3.5" strokeWidth={2} /> : nn(n)}
                  </span>
                  <span className="pt-0.5">
                    <span
                      className={cn(
                        "block text-[13px] leading-5",
                        state === "current"
                          ? "font-medium text-fg"
                          : state === "done"
                            ? "text-muted"
                            : "text-subtle",
                      )}
                    >
                      {label}
                    </span>
                    <span className="block text-xs leading-4 text-subtle">{hint}</span>
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
        <p className="mt-auto text-xs leading-4 text-subtle">
          Signed in as <span className="text-muted">{userName}</span>. Everything here can be changed later in
          Settings.
        </p>
      </aside>
      <div className="flex min-w-0 flex-col md:py-2 md:pr-2">
        <main className="flex min-h-dvh flex-1 flex-col bg-surface md:min-h-[calc(100dvh-16px)] md:rounded-[14px] md:border md:border-border">
          <header className="flex h-14 items-center justify-between gap-3 border-b border-border px-4 md:px-8">
            <span className="md:hidden">
              <Logo />
            </span>
            <nav aria-label="Breadcrumb" className="hidden items-center gap-2 text-[13px] md:flex">
              <span className="text-subtle">Setup</span>
              <span aria-hidden className="size-1 rounded-full bg-border-strong" />
              <span className="font-medium text-fg">{STEPS[step - 1]![0]}</span>
            </nav>
            <span className="font-mono text-[12px] text-subtle">Step {nn(step)} of 05</span>
          </header>
          <div className="flex gap-1 px-4 pt-4 md:hidden" aria-hidden>
            {STEPS.map(([l], i) => (
              <span
                key={l}
                className={cn("h-1 flex-1 rounded-full", i < step ? "bg-primary" : "bg-surface-3")}
              />
            ))}
          </div>
          <div className="mx-auto w-full max-w-[660px] flex-1 px-5 py-10 md:px-8 md:py-16">
            {step === 1 ? <StepProduct userName={userName} /> : null}
            {step === 2 && initial ? (
              <StepStripe initial={initial} appUrl={appUrl} onDone={() => go(3)} />
            ) : null}
            {step === 3 && initial ? <StepDesign programId={initial.programId} onDone={() => go(4)} /> : null}
            {step === 4 && initial ? <StepInstall initial={initial} onDone={() => go(5)} /> : null}
            {step === 5 && initial ? <StepDone initial={initial} /> : null}
          </div>
        </main>
      </div>
    </div>
  );
}

function StepHeader({ n, title, text }: { n: number; title: string; text: string }) {
  return (
    <div className="mb-10">
      <span className="eyebrow">Step {nn(n)}</span>
      <h1 className="mt-3 text-[28px] leading-9 font-medium tracking-[-0.03em] text-balance text-fg">
        {title}
      </h1>
      <p className="mt-3 max-w-[58ch] text-[15px] leading-6 text-muted">{text}</p>
    </div>
  );
}

function StepProduct({ userName }: { userName: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <section>
      <StepHeader
        n={1}
        title={`What are you selling, ${userName.split(" ")[0]}?`}
        text="Paste your website. We read your logo, colors and copy to brand your partner portal, and draft your content kit."
      />
      <form
        className="flex flex-col gap-6"
        action={(f) =>
          start(async () => {
            const res = await createProgramAction({
              websiteUrl: String(f.get("url")),
              name: String(f.get("name") || "") || undefined,
            });
            if (!res.ok) return void toast.error(res.error);
            router.push(`/onboarding?program=${res.data!.programId}&step=2`);
          })
        }
      >
        <Field label="Website URL" htmlFor="url">
          <Input
            id="url"
            name="url"
            placeholder="yourapp.com"
            required
            autoFocus
            className="h-11 text-[15px]"
          />
        </Field>
        <Field
          label="Product name"
          htmlFor="name"
          hint="Optional. We use the name on your site if you leave this empty."
        >
          <Input id="name" name="name" className="h-10" />
        </Field>
        <Button type="submit" variant="primary" size="lg" loading={pending} className="mt-2 self-start">
          Continue <ArrowRight />
        </Button>
      </form>
    </section>
  );
}

function StepStripe({
  initial,
  appUrl,
  onDone,
}: {
  initial: NonNullable<Initial>;
  appUrl: string;
  onDone: () => void;
}) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<string | null>(null);
  const local = /localhost|127\.0\.0\.1/.test(appUrl);
  return (
    <section>
      <StepHeader
        n={2}
        title="Connect Stripe"
        text="OpenPromoter reads payments from Stripe to attribute sales and calculate commissions even when cookies are blocked. Create a restricted key so it can only do what it needs."
      />
      {initial.stripeConnected ? (
        <div className="mb-8 flex items-center gap-3 rounded-lg border border-border bg-success-soft px-4 py-3">
          <CheckCircle2 className="size-5 text-success" />
          <span className="text-[13px] text-fg">
            Stripe is connected. Products, customers and subscriptions were imported.
          </span>
        </div>
      ) : initial.oauthUrl ? (
        <div className="mb-8 flex flex-col gap-3">
          <Button asChild variant="primary" className="self-start">
            <a href={initial.oauthUrl}>Connect with Stripe</a>
          </Button>
          <p className="text-[13px] text-muted">Or paste a restricted key instead.</p>
        </div>
      ) : null}
      <ol className="mb-8 flex flex-col overflow-hidden rounded-lg border border-border text-[13px] leading-5 text-muted">
        {[
          <>
            In Stripe, open{" "}
            <a
              className="font-medium text-accent-text underline-offset-2 hover:underline"
              href="https://dashboard.stripe.com/apikeys/create"
              target="_blank"
              rel="noreferrer"
            >
              Developers &gt; API keys &gt; Create restricted key
            </a>
            .
          </>,
          <>
            Allow read access to Customers, Subscriptions, Invoices, Charges, Disputes, Checkout Sessions,
            Products and Prices. Allow write access to Webhook endpoints, Promotion codes and Coupons. For
            partner payouts, also allow write access to Accounts, Account Links and Transfers.
          </>,
          <>Paste the key below. Use a test-mode key first if you want to try things out.</>,
        ].map((t, i) => (
          <li key={i} className="flex gap-4 border-b border-border px-4 py-3 last:border-b-0">
            <span className="font-mono text-[12px] text-subtle">{nn(i + 1)}</span>
            <span>{t}</span>
          </li>
        ))}
      </ol>
      <form
        className="flex flex-col gap-6"
        action={(f) =>
          start(async () => {
            const res = await connectStripeAction(initial.programId, {
              key: String(f.get("key")),
              webhookSecret: String(f.get("whsec") || "") || undefined,
            });
            if (!res.ok) return void toast.error(res.error);
            const d = res.data!;
            const imp = d.imported as { customers?: number; prices?: number; error?: string };
            setResult(
              imp.error
                ? `Connected. Import failed: ${imp.error}`
                : `Connected. Imported ${imp.prices ?? 0} prices and ${imp.customers ?? 0} customers.${d.webhookConfigured ? " Webhook registered." : ""}`,
            );
            mascotToast("Stripe connected", "celebrates");
            if (d.webhookConfigured) onDone();
          })
        }
      >
        <Field label="Restricted key" htmlFor="key">
          <Input
            id="key"
            name="key"
            placeholder="rk_live_... or rk_test_..."
            required={!initial.stripeConnected}
            autoComplete="off"
            className="h-10 font-mono"
          />
        </Field>
        {local ? (
          <div className="rounded-lg border border-dashed border-border-strong p-4">
            <p className="mb-1 flex items-center gap-2 text-[13px] font-medium text-fg">
              <Terminal className="size-4 text-subtle" /> Running on localhost
            </p>
            <p className="mb-3 text-[13px] leading-5 text-muted">
              Stripe can't reach localhost. Forward events with the Stripe CLI and paste the signing secret it
              prints.
            </p>
            <Code
              label="Terminal"
              code={`stripe listen --forward-to ${initial.webhookUrl.replace(appUrl, "localhost:3000")}`}
            />
            <Field label="Webhook signing secret" htmlFor="whsec" className="mt-3">
              <Input
                id="whsec"
                name="whsec"
                placeholder="whsec_..."
                autoComplete="off"
                className="h-10 font-mono"
              />
            </Field>
          </div>
        ) : (
          <p className="text-xs leading-4 text-subtle">
            We register the webhook endpoint for you at{" "}
            <span className="font-mono">{initial.webhookUrl}</span>.
          </p>
        )}
        {result ? (
          <p className="rounded-md bg-success-soft px-3 py-2 text-[13px] leading-5 text-success">{result}</p>
        ) : null}
        <div className="flex flex-wrap items-center gap-3 border-t border-border pt-6">
          <Button type="submit" variant="primary" size="lg" loading={pending}>
            {initial.stripeConnected ? "Update connection" : "Connect Stripe"}
          </Button>
          <Button type="button" variant="ghost" size="lg" onClick={onDone}>
            {initial.stripeConnected || result ? "Continue" : "Skip for now"} <ArrowRight />
          </Button>
        </div>
        {initial.stripeConnected || result ? null : (
          <p className="-mt-2 text-[13px] leading-5 text-muted">
            You can connect Stripe later in Settings &gt; Integrations. Paddle, Lemon Squeezy and Polar are
            there too.
          </p>
        )}
      </form>
    </section>
  );
}

const LABELS: Record<keyof ProgramDesign["rationale"], string> = {
  commission: "Commission",
  duration: "How long partners earn",
  cookie: "Cookie window",
  doubleSided: "Reward for the customer",
  tiers: "Tiers",
  payouts: "Payouts",
};

function StepDesign({ programId, onDone }: { programId: string; onDone: () => void }) {
  const [design, setDesign] = useState<(ProgramDesign & { source: string }) | null>(null);
  const [pending, start] = useTransition();
  useEffect(() => {
    proposeDesignAction(programId).then((r) => (r.ok ? setDesign(r.data!) : toast.error(r.error)));
  }, [programId]);
  const headline = (k: keyof ProgramDesign["rationale"], d: ProgramDesign) =>
    ({
      commission:
        d.commissionType === "percent" ? `${d.commissionValue / 100}%` : `${d.commissionValue / 100}`,
      duration:
        d.commissionDuration === "lifetime"
          ? "Lifetime"
          : d.commissionDuration === "months"
            ? `${d.commissionMonths} months`
            : "First payment",
      cookie: `${d.cookieDays} days`,
      doubleSided: d.doubleSided.enabled
        ? `${d.doubleSided.percentOff}% off for ${d.doubleSided.durationMonths} months`
        : "Off",
      tiers: d.tiers.map((t) => t.name).join(" → "),
      payouts: `Monthly with a $${d.minPayout / 100} minimum`,
    })[k];
  return (
    <section>
      <StepHeader
        n={3}
        title="Your program designed for your pricing"
        text="We looked at your prices and picked the terms that the best SaaS programs use for a business like yours. Accept with one click and change anything later."
      />
      {!design ? (
        <div className="overflow-hidden rounded-xl border border-border" aria-busy="true">
          <div className="flex items-center justify-between border-b border-border px-5 py-3">
            <span className="eyebrow">Program terms</span>
            <span className="text-[13px] text-muted">Reading your pricing…</span>
          </div>
          {Object.keys(LABELS).map((k) => (
            <div key={k} className="flex items-center gap-4 border-b border-border px-5 py-4 last:border-b-0">
              <span className="h-2.5 w-28 rounded-full bg-surface-3" />
              <span className="leader" />
              <span className="h-2.5 w-14 rounded-full bg-surface-3" />
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className="overflow-hidden rounded-xl border border-border bg-surface ">
            <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
              <span className="eyebrow">Program terms</span>
              <Badge tone={design.source === "ai" ? "primary" : "neutral"} dot>
                {design.source === "ai" ? "Designed by AI" : "Designed from your pricing"}
              </Badge>
            </div>
            <ol>
              {(Object.keys(LABELS) as (keyof typeof LABELS)[]).map((k, i) => (
                <li key={k} className="border-b border-border px-5 py-4 last:border-b-0">
                  <div className="flex items-baseline text-[13px]">
                    <span className="mr-3 w-4 shrink-0 font-mono text-[11px] text-subtle">{nn(i + 1)}</span>
                    <span className="shrink-0 text-muted">{LABELS[k]}</span>
                    <span className="leader" aria-hidden />
                    <span className="num text-right text-[14px] font-medium text-fg">
                      {headline(k, design)}
                    </span>
                  </div>
                  <p className="mt-2 ml-7 max-w-[60ch] border-l border-border-strong pl-3 text-[13px] leading-5 text-muted">
                    {design.rationale[k]}
                  </p>
                </li>
              ))}
            </ol>
          </div>
          <div className="mt-8 flex flex-wrap items-center gap-3 border-t border-border pt-6">
            <Button
              variant="primary"
              size="lg"
              loading={pending}
              onClick={() =>
                start(async () => {
                  const r = await acceptDesignAction(programId, design);
                  if (!r.ok) return void toast.error(r.error);
                  toast.success("Program terms saved");
                  onDone();
                })
              }
            >
              <Check /> Accept this program
            </Button>
            <Button variant="ghost" size="lg" onClick={onDone}>
              Keep the defaults and edit later
            </Button>
          </div>
        </>
      )}
    </section>
  );
}

function StepInstall({ initial, onDone }: { initial: NonNullable<Initial>; onDone: () => void }) {
  const [tab, setTab] = useState<"script" | "ai" | "npm">("script");
  const [verified, setVerified] = useState(initial.installed);
  useEffect(() => {
    if (verified) return;
    const t = setInterval(async () => {
      const r = await installStatusAction(initial.programId);
      if (r.ok && r.data?.verified) {
        setVerified(true);
        mascotToast("Tracking script detected", "celebrates");
      }
    }, 4000);
    return () => clearInterval(t);
  }, [verified, initial.programId]);
  const tabs = [
    { id: "script", label: "Script tag" },
    { id: "ai", label: "Paste into your AI agent" },
    { id: "npm", label: "npm SDK" },
  ] as const;
  return (
    <section>
      <StepHeader
        n={4}
        title="Install tracking"
        text="One line on your site. Stripe Payment Links and Pricing Tables are picked up automatically; for custom checkouts, pass the click id to Stripe."
      />
      <div
        role="tablist"
        className="mb-5 flex gap-1 overflow-x-auto rounded-lg bg-surface-2 p-1 dark:bg-surface-3/50"
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "h-8 flex-1 shrink-0 rounded-md px-3 text-[13px] whitespace-nowrap transition-colors",
              tab === t.id ? "bg-surface font-medium text-fg dark:bg-surface-3" : "text-muted hover:text-fg",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "script" ? (
        <div className="flex flex-col gap-4">
          <Code label="Add to the <head> of your site" code={initial.snippets.script} />
          <Code label="Custom Stripe Checkout (server)" code={initial.snippets.checkout} />
        </div>
      ) : tab === "ai" ? (
        <div>
          <p className="mb-3 text-[13px] leading-5 text-muted">
            Works in Claude Code, Codex, Cursor, Copilot or any other coding agent. It wires tracking and
            server-side conversion into your codebase and leaves your prices alone.
          </p>
          <Textarea
            readOnly
            value={initial.snippets.prompt}
            className="h-64 font-mono text-[12px]"
            aria-label="Prompt for your coding agent"
          />
          <div className="mt-2">
            <CopyField value={initial.snippets.prompt} mono={false} />
          </div>
        </div>
      ) : (
        <Code label="Terminal" code={initial.snippets.npm} />
      )}
      <div
        className={cn(
          "mt-6 flex items-start gap-3 rounded-lg border px-4 py-3",
          verified ? "border-transparent bg-success-soft" : "border-dashed border-border-strong",
        )}
        aria-live="polite"
      >
        {verified ? (
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
        ) : (
          <span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-full bg-warning" />
        )}
        <div className="text-[13px] leading-5">
          <p className="font-medium text-fg">
            {verified ? "Installation verified" : "Waiting for your site to load the script…"}
          </p>
          <p className="text-muted">
            {verified
              ? "We saw op.js load on your site."
              : "Open your site in another tab after adding the tag. We check every few seconds."}
          </p>
        </div>
      </div>
      <div className="mt-8 flex gap-3 border-t border-border pt-6">
        <Button variant="primary" size="lg" onClick={onDone}>
          {verified ? "Continue" : "I'll do this later"} <ArrowRight />
        </Button>
      </div>
    </section>
  );
}

function StepDone({ initial }: { initial: NonNullable<Initial> }) {
  const rows: [string, string, boolean][] = [
    ["Program", initial.name, true],
    [
      "Billing",
      initial.stripeConnected ? "Stripe connected" : "Connect later in Settings",
      initial.stripeConnected,
    ],
    [
      "Tracking",
      initial.installed ? "Verified on your site" : "Install later in Settings",
      initial.installed,
    ],
    ["Autopilot", "Weekly review on", true],
  ];
  return (
    <section>
      <StepHeader
        n={5}
        title={`${initial.name}'s partner program is live`}
        text="Autopilot now watches the program every week. Invite your first partners: the recruiter has already lined up your happiest paying customers."
      />
      <div className="mb-8 overflow-hidden rounded-xl border border-border ">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <span className="eyebrow">Summary</span>
          <span className="eyebrow">{new Date().toLocaleDateString("en-US", { dateStyle: "medium" })}</span>
        </div>
        <div className="flex flex-col gap-3 px-5 py-4">
          {rows.map(([k, v, ok]) => (
            <div key={k} className="flex items-baseline text-[13px]">
              <span className="text-muted">{k}</span>
              <span className="leader" aria-hidden />
              <span className="flex items-center gap-2 text-fg">
                <span aria-hidden className={cn("size-1.5 rounded-full", ok ? "bg-success" : "bg-warning")} />
                {v}
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-3">
        <Button asChild variant="primary" size="lg">
          <Link href={`/app/${initial.programId}/recruiter`}>
            <Sparkles /> Invite partners
          </Link>
        </Button>
        <Button asChild variant="secondary" size="lg">
          <Link href={`/app/${initial.programId}`}>Go to dashboard</Link>
        </Button>
      </div>
    </section>
  );
}
