import fs from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import postgres from "postgres";
import Stripe from "stripe";
import { newFounder } from "./full-settings.helpers";

/**
 * OpenPromoter's own plans against real Stripe test mode. The app must run in Cloud mode with a known
 * platform webhook secret, so this runs only when started like:
 *   HOSTED_MODE=true PLATFORM_STRIPE_WEBHOOK_SECRET=whsec_e2e_plan_secret pnpm e2e plan-billing
 * (PLATFORM_STRIPE_SECRET_KEY must be an sk_test_ key in .env.local).
 */
const SECRET = process.env.PLATFORM_STRIPE_WEBHOOK_SECRET;
const env = fs.readFileSync(".env.local", "utf8");
const key = env.match(/^PLATFORM_STRIPE_SECRET_KEY=(sk_test_\S+)$/m)?.[1];
test.skip(process.env.HOSTED_MODE !== "true" || !SECRET || !key, "needs Cloud mode and a Stripe test key");
test.describe.configure({ mode: "serial" });

const stripe = new Stripe(key ?? "sk_test_x");
const db = postgres(process.env.DATABASE_URL ?? env.match(/^DATABASE_URL=(.*)$/m)![1]!, { max: 1 });
test.afterAll(() => db.end());

const id = Date.now().toString(36);
let base = "";
let wsId = "";
let customer = "";
let subId = "";
const price = async (plan: string) =>
  (await stripe.prices.list({ lookup_keys: [`openpromoter_${plan}_monthly`] })).data[0]!.id;

/** Sends a signed platform event the way Stripe does; the app then reads the subscription from Stripe. */
async function send(page: Page, type: string, sub: Stripe.Subscription) {
  const payload = JSON.stringify({
    id: `evt_${Date.now()}`,
    object: "event",
    type,
    livemode: false,
    created: Math.floor(Date.now() / 1000),
    data: { object: sub },
  });
  const res = await page.request.post("/api/webhooks/platform", {
    data: payload,
    headers: {
      "content-type": "application/json",
      "stripe-signature": stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET! }),
    },
  });
  expect(res.status()).toBe(200);
}
const plan = async () =>
  (await db`select plan, billing_status from workspace where id = ${wsId}`)[0] as {
    plan: string;
    billing_status: string;
  };
const status = (page: Page) => page.getByRole("status").filter({ hasText: /trial|ends on|payment/i });

test("free founder: Choose opens Stripe Checkout", async ({ page }) => {
  base = await newFounder(page, "Plan Founder", `plan-${id}@example.test`, `Plan ${id}`);
  wsId = (await db`select workspace_id from program where id = ${base.split("/")[2]!}`)[0]!.workspace_id;
  await page.goto(`${base}/settings/billing`);
  await expect(page.getByText("Free plan", { exact: true })).toBeVisible();
  const go = page.waitForURL(/checkout\.stripe\.com/, { timeout: 30_000 });
  await page.getByRole("button", { name: "Choose" }).first().click();
  await go;
});

test("trial, scheduled cancel, upgrade, cancel and subscribe again", async ({ page }) => {
  await page.goto("/login");
  // sign in as the founder made above
  await page.getByLabel("Email").fill(`plan-${id}@example.test`);
  await page.getByLabel("Password", { exact: true }).fill("e2e-password-123");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/app\/prg_/);

  customer = (await stripe.customers.create({ email: `plan-${id}@example.test`, metadata: { e2e: "plan" } }))
    .id;
  let sub = await stripe.subscriptions.create({
    customer,
    items: [{ price: await price("starter") }],
    trial_period_days: 14,
    metadata: { workspace_id: wsId, plan: "starter" },
  });
  subId = sub.id;
  await send(page, "customer.subscription.created", sub);
  expect(await plan()).toEqual({ plan: "starter", billing_status: "trialing" });
  await page.goto(`${base}/settings/billing`);
  await expect(page.getByText("Starter plan", { exact: true })).toBeVisible();
  await expect(status(page)).toContainText("Free trial until");

  // Manage billing opens the Stripe customer portal
  const portal = page.waitForURL(/billing\.stripe\.com/, { timeout: 30_000 });
  await page.getByRole("button", { name: "Manage billing" }).click();
  await portal;

  // cancel at period end: plan stays, end date shows
  sub = await stripe.subscriptions.update(subId, { cancel_at_period_end: true });
  await send(page, "customer.subscription.updated", sub);
  await page.goto(`${base}/settings/billing`);
  await expect(status(page)).toContainText("ends on");
  expect((await plan()).plan).toBe("starter");

  // change of mind plus upgrade to Growth in one portal visit
  sub = await stripe.subscriptions.retrieve(subId);
  sub = await stripe.subscriptions.update(subId, {
    cancel_at_period_end: false,
    items: [{ id: sub.items.data[0]!.id, price: await price("growth") }],
    proration_behavior: "none",
  });
  await send(page, "customer.subscription.updated", sub);
  await page.goto(`${base}/settings/billing`);
  await expect(page.getByText("Growth plan", { exact: true })).toBeVisible();
  await expect(page.getByText(/ends on/)).toHaveCount(0);

  // canceled now: Free
  sub = await stripe.subscriptions.cancel(subId);
  await send(page, "customer.subscription.deleted", sub);
  expect((await plan()).plan).toBe("free");
  await page.goto(`${base}/settings/billing`);
  await expect(page.getByText("Free plan", { exact: true })).toBeVisible();

  // subscribe again: a new subscription id must still upgrade the workspace
  const again = await stripe.subscriptions.create({
    customer,
    items: [{ price: await price("scale") }],
    trial_period_days: 1,
    metadata: { workspace_id: wsId, plan: "scale" },
  });
  await send(page, "customer.subscription.created", again);
  expect((await plan()).plan).toBe("scale");
  // the old subscription's late event changes nothing
  await send(page, "customer.subscription.deleted", sub);
  expect((await plan()).plan).toBe("scale");
  await stripe.subscriptions.cancel(again.id);
});

test("an unsigned or forged plan event is refused", async ({ page }) => {
  const res = await page.request.post("/api/webhooks/platform", {
    data: JSON.stringify({ type: "customer.subscription.created", data: { object: { id: "sub_x" } } }),
    headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=bad" },
  });
  expect(res.status()).toBe(400);
});
