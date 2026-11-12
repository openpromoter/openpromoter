"use client";

import { Badge, Button, Card, CardBody, CardHeader, Field, Input, Switch } from "@openpromoter/ui";
import { CheckCircle2, Link2 } from "@openpromoter/ui/icons";
import Link from "next/link";
import { BrandTitle } from "@/components/brand";
import { CodeBlock, CopyField } from "@/components/copy";
import { useAction } from "@/components/use-action";
import {
  connectPayoutProviderAction,
  connectProviderAction,
  connectStripeSettingsAction,
  deleteTestDataAction,
  disconnectAction,
  importStripeAction,
} from "../../settings-actions";

type S = {
  connected: boolean;
  webhook: boolean;
  livemode: boolean;
  importedAt: string | null;
  lastEventAt: string | null;
} | null;

function Status({ s }: { s: S }) {
  if (!s) return <Badge tone="neutral">Not connected</Badge>;
  return (
    <Badge tone={s.webhook ? "success" : "warning"} icon={CheckCircle2}>
      {s.webhook ? `Connected${s.livemode ? " · live" : " · test"}` : "Webhook secret missing"}
    </Badge>
  );
}

export function IntegrationsView({
  programId,
  canWrite,
  canBilling,
  local,
  oauthUrl,
  urls,
  status,
}: {
  programId: string;
  canWrite: boolean;
  /** Payout providers and disconnecting move money settings: owners only, like the server. */
  canBilling: boolean;
  local: boolean;
  oauthUrl: string | null;
  urls: Record<"stripe" | "paddle" | "lemonsqueezy" | "polar" | "chargebee", string>;
  status: Record<string, S>;
}) {
  const { pending, run } = useAction();
  const disconnect = (p: "stripe" | "paddle" | "lemonsqueezy" | "polar" | "chargebee" | "paypal" | "wise") =>
    status[p] && canBilling ? (
      <Button
        type="button"
        variant="ghost"
        className="text-danger hover:text-danger"
        onClick={() => window.confirm(`Disconnect ${p}?`) && run(() => disconnectAction(programId, p))}
      >
        Disconnect
      </Button>
    ) : null;
  return (
    <>
      <Card>
        <CardHeader
          title={<BrandTitle brand="stripe">Stripe</BrandTitle>}
          description="Attribution, commissions, refunds and partner payouts through Stripe Connect."
          action={<Status s={status.stripe ?? null} />}
        />
        <CardBody className="flex flex-col gap-4">
          {oauthUrl ? (
            <Button asChild variant="primary" className="self-start">
              <a href={oauthUrl}>
                <Link2 /> Connect with Stripe
              </a>
            </Button>
          ) : null}
          <form
            className="flex flex-col gap-3"
            action={(f) =>
              run(() =>
                connectStripeSettingsAction(programId, {
                  key: String(f.get("key") || ""),
                  webhookSecret: String(f.get("whsec") || "") || undefined,
                }),
              )
            }
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label="Restricted key"
                htmlFor="st-key"
                hint="Leave empty to only update the webhook secret."
              >
                <Input
                  id="st-key"
                  name="key"
                  placeholder="rk_live_... or rk_test_..."
                  autoComplete="off"
                  className="font-mono placeholder:font-sans"
                  disabled={!canWrite}
                />
              </Field>
              <Field
                label="Webhook signing secret"
                htmlFor="st-wh"
                hint={
                  local
                    ? "Printed by the stripe listen command below"
                    : "Only needed if automatic registration failed"
                }
              >
                <Input
                  id="st-wh"
                  name="whsec"
                  placeholder="whsec_..."
                  autoComplete="off"
                  className="font-mono placeholder:font-sans"
                  disabled={!canWrite}
                />
              </Field>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="primary" loading={pending} disabled={!canWrite}>
                {status.stripe ? "Update" : "Connect"}
              </Button>
              {status.stripe ? (
                <Button
                  type="button"
                  variant="ghost"
                  loading={pending}
                  onClick={() => run(() => importStripeAction(programId), "Import finished")}
                >
                  Re-import from Stripe
                </Button>
              ) : null}
              {canWrite ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() =>
                    window.confirm(
                      "Delete all referrals and unpaid commissions created by Stripe test-mode events?",
                    ) && run(() => deleteTestDataAction(programId))
                  }
                >
                  Delete test data
                </Button>
              ) : null}
              {disconnect("stripe")}
            </div>
          </form>
          <Field label="Webhook endpoint" htmlFor="st-url">
            <CopyField value={urls.stripe} />
          </Field>
          {local ? (
            <CodeBlock
              label="Local development"
              code={`stripe listen --forward-to ${urls.stripe.replace(/^https?:\/\/[^/]+/, "localhost:3000")}`}
            />
          ) : null}
          {status.stripe?.importedAt ? (
            <p className="text-xs text-muted">
              Last import{" "}
              {new Date(status.stripe.importedAt).toLocaleString("en-US", {
                dateStyle: "medium",
                timeStyle: "short",
              })}
              . Last event{" "}
              {status.stripe.lastEventAt
                ? new Date(status.stripe.lastEventAt).toLocaleString("en-US", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })
                : "not received yet"}
              .
            </p>
          ) : null}
        </CardBody>
      </Card>

      {(["paddle", "lemonsqueezy", "polar", "chargebee"] as const).map((p) => (
        <Card key={p}>
          <CardHeader
            title={
              <BrandTitle brand={p}>
                {
                  {
                    paddle: "Paddle Billing",
                    lemonsqueezy: "Lemon Squeezy",
                    polar: "Polar",
                    chargebee: "Chargebee",
                  }[p]
                }
              </BrandTitle>
            }
            description={
              {
                paddle: "Add a notification destination in Paddle with this URL and paste its secret key.",
                lemonsqueezy:
                  "Create a webhook in Lemon Squeezy (Settings > Webhooks) with this URL and a signing secret.",
                polar: "Add a webhook endpoint in Polar with this URL and paste its secret.",
                chargebee:
                  "Add a webhook in Chargebee with this URL and basic authentication; paste the same user:password here.",
              }[p]
            }
            action={<Status s={status[p] ?? null} />}
          />
          <CardBody className="flex flex-col gap-3">
            <CopyField value={urls[p]} />
            <form
              // remount after a save: the reset form would otherwise show the Sandbox switch off for a test connection
              key={`${p}:${status[p]?.livemode ?? "none"}`}
              className="flex flex-wrap gap-2 [&>input]:min-w-[180px] [&>input]:flex-1"
              action={(f) =>
                run(() => connectProviderAction(programId, p, String(f.get("secret")), !!f.get("sandbox")))
              }
            >
              <Input
                name="secret"
                placeholder="Webhook secret"
                aria-label={`${p} webhook secret`}
                autoComplete="off"
                className="font-mono placeholder:font-sans"
                disabled={!canWrite}
                required
              />
              {p === "lemonsqueezy" ? null : (
                <label className="flex items-center gap-2 text-xs text-muted">
                  <Switch
                    name="sandbox"
                    value="on"
                    aria-label="Sandbox"
                    defaultChecked={status[p] ? !status[p].livemode : false}
                    disabled={!canWrite}
                  />{" "}
                  Sandbox
                </label>
              )}
              <Button type="submit" variant="primary" loading={pending} disabled={!canWrite}>
                Save
              </Button>
              {disconnect(p)}
            </form>
          </CardBody>
        </Card>
      ))}

      <Card>
        <CardHeader
          title={<BrandTitle brand="paypal">PayPal Payouts</BrandTitle>}
          description="Pay partners by PayPal email. Needs a PayPal business account with Payouts enabled."
          action={<Status s={status.paypal ?? null} />}
        />
        <CardBody>
          <form
            key={`paypal:${status.paypal?.livemode ?? "none"}`}
            className="grid gap-3 sm:grid-cols-[1fr_1fr_auto_auto]"
            action={(f) =>
              run(() =>
                connectPayoutProviderAction(programId, "paypal", {
                  clientId: String(f.get("clientId")),
                  clientSecret: String(f.get("clientSecret")),
                  sandbox: f.get("sandbox") ? "on" : "off",
                }),
              )
            }
          >
            <Input
              name="clientId"
              placeholder="Client ID"
              aria-label="PayPal client ID"
              disabled={!canBilling}
              required
            />
            <Input
              name="clientSecret"
              placeholder="Secret"
              type="password"
              aria-label="PayPal secret"
              disabled={!canBilling}
              required
            />
            <label className="flex items-center gap-2 text-xs text-muted">
              <Switch
                name="sandbox"
                value="on"
                aria-label="Sandbox"
                defaultChecked={status.paypal ? !status.paypal.livemode : false}
              />{" "}
              Sandbox
            </label>
            <Button type="submit" variant="primary" loading={pending} disabled={!canBilling}>
              Save
            </Button>
          </form>
        </CardBody>
      </Card>
      <Card>
        <CardHeader
          title={<BrandTitle brand="wise">Wise</BrandTitle>}
          description="Pay partners in their local currency from your Wise balance. UK and EEA profiles fund each transfer in the Wise app; the payout is marked paid once Wise sends it."
          action={<Status s={status.wise ?? null} />}
        />
        <CardBody>
          <form
            key={`wise:${status.wise?.livemode ?? "none"}`}
            className="grid gap-3 sm:grid-cols-[1fr_140px_160px_auto_auto]"
            action={(f) =>
              run(() =>
                connectPayoutProviderAction(programId, "wise", {
                  token: String(f.get("token")),
                  profileId: String(f.get("profileId")),
                  sourceCurrency: String(f.get("sourceCurrency") ?? ""),
                  sandbox: f.get("sandbox") ? "on" : "off",
                }),
              )
            }
          >
            <Input
              name="token"
              placeholder="API token"
              type="password"
              aria-label="Wise API token"
              disabled={!canBilling}
              required
            />
            <Input
              name="profileId"
              placeholder="Profile ID"
              aria-label="Wise profile ID"
              disabled={!canBilling}
              required
            />
            <Input
              name="sourceCurrency"
              placeholder="Pay from, e.g. USD"
              aria-label="Wise balance currency to pay from"
              maxLength={3}
              disabled={!canBilling}
            />
            <label className="flex items-center gap-2 text-xs text-muted">
              <Switch
                name="sandbox"
                value="on"
                aria-label="Sandbox"
                defaultChecked={status.wise ? !status.wise.livemode : false}
              />{" "}
              Sandbox
            </label>
            <Button type="submit" variant="primary" loading={pending} disabled={!canBilling}>
              Save
            </Button>
          </form>
        </CardBody>
      </Card>
      <Card>
        <CardHeader
          title="Slack, Discord, Zapier and Make"
          description="Alerts and automations use signed webhooks."
          action={
            <Button asChild size="sm">
              <Link href={`/app/${programId}/settings/developers`}>Set up</Link>
            </Button>
          }
        />
      </Card>
    </>
  );
}
