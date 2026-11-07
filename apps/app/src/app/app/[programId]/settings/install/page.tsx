import { billingConnection, click, referral } from "@openpromoter/db";
import { Badge, Card, CardBody, CardHeader } from "@openpromoter/ui";
import { CheckCircle2, Circle } from "@openpromoter/ui/icons";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { CodeBlock } from "@/components/copy";
import { snippets } from "@/lib/install";
import { programCtx } from "@/server/context";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { Recheck } from "./recheck";

export default async function InstallSettings({ params }: { params: Promise<{ programId: string }> }) {
  const { programId } = await params;
  const { program: p } = await programCtx(programId);
  const s = snippets(env.APP_URL, p.slug, p.id);
  const [[clicks], [paid], conns] = await Promise.all([
    db().select({ n: sql<number>`count(*)::int` }).from(click).where(eq(click.programId, p.id)),
    db()
      .select({ n: sql<number>`count(*)::int` })
      .from(referral)
      .where(and(eq(referral.programId, p.id), isNotNull(referral.convertedAt))),
    db().select().from(billingConnection).where(eq(billingConnection.workspaceId, p.workspaceId)),
  ]);
  const checks = [
    { ok: !!p.installVerifiedAt, label: "Script seen on your site" },
    { ok: (clicks?.n ?? 0) > 0, label: "First click recorded" },
    { ok: conns.some((c) => !!c.lastEventAt), label: "Billing webhook received" },
    { ok: (paid?.n ?? 0) > 0, label: "First paying customer attributed (a test-mode checkout counts)" },
  ];
  return (
    <>
      <Card>
        <CardHeader
          title="Status"
          action={
            <div className="flex items-center gap-2">
              <Recheck />
              {p.installVerifiedAt ? (
                <Badge tone="success" icon={CheckCircle2}>
                  Script seen {p.installVerifiedAt.toLocaleDateString()}
                </Badge>
              ) : (
                <Badge tone="warning" icon={Circle}>
                  Not seen yet
                </Badge>
              )}
            </div>
          }
        />
        <CardBody className="flex flex-col gap-3 text-[13px] text-muted">
          <ul className="grid gap-2 sm:grid-cols-2">
            {checks.map((c) => (
              <li
                key={c.label}
                className="flex items-center gap-2 rounded-sm border border-border px-3 py-2 text-fg"
              >
                {c.ok ? (
                  <CheckCircle2 className="size-4 text-success" />
                ) : (
                  <Circle className="size-4 text-subtle" />
                )}
                {c.label}
              </li>
            ))}
          </ul>
          <p>
            op.js sets a first-party cookie on your domain for {p.cookieDays} days (
            {p.attributionModel.replace("_", " ")} wins) and records clicks for ?{p.referralParam}= links. It
            adds the click id to Stripe Payment Links, Pricing Tables and Checkout.
          </p>
          <p>
            Add data-consent="required" to wait for cookie consent (call openpromoter("consent", true) once
            the visitor agrees). Add data-storage="none" to never set cookies. Add data-api="/op" with a
            rewrite on your own domain so ad blockers don't drop clicks.
          </p>
        </CardBody>
      </Card>
      <CodeBlock label="1. Script tag (every page)" code={s.script} />
      <CodeBlock
        label="2. Track signups before payment (optional)"
        code={`<script>\n  // after your signup form succeeds\n  window.openpromoter?.signup({ email: user.email });\n</script>`}
      />
      <CodeBlock label="3. Custom Stripe Checkout (server)" code={s.checkout} />
      <CodeBlock label="Server-side SDK" code={s.npm} />
      <CodeBlock
        label="Prompt for your AI coding agent (Claude Code, Codex, Cursor, Copilot or any other)"
        code={s.prompt}
      />
      <CodeBlock
        label="Paddle, Lemon Squeezy and Polar"
        code={`// Pass the click id as custom data at checkout:\n// Paddle.js:      Paddle.Checkout.open({ customData: { op_click: window.openpromoter.clickId } })\n// Lemon Squeezy:  checkout URL ?checkout[custom][op_click]=<clickId>\n// Polar:          checkout metadata: { op_click: <clickId> }`}
      />
    </>
  );
}
