import fs from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import postgres from "postgres";
import Stripe from "stripe";
import { newFounder } from "./full-settings.helpers";

/**
 * Real payments for OpenPromoter's own plans, through the real Stripe Checkout and customer portal pages
 * in Stripe test mode. Needs the app in Cloud mode and `stripe listen` forwarding plan events:
 *   stripe listen --api-key sk_test_... --forward-to localhost:3000/api/webhooks/platform
 *   (HOSTED_MODE=true and that whsec as PLATFORM_STRIPE_WEBHOOK_SECRET in .env.local)
 *   LOCAL_STRIPE=1 pnpm e2e payments-local
 */
const env = fs.readFileSync(".env.local", "utf8");
const key = env.match(/^PLATFORM_STRIPE_SECRET_KEY=(sk_test_\S+)$/m)?.[1];
test.skip(!process.env.LOCAL_STRIPE || !key, "set LOCAL_STRIPE=1 with Cloud mode and stripe listen running");
test.setTimeout(480_000);

const stripe = new Stripe(key ?? "sk_test_x");
const db = postgres(env.match(/^DATABASE_URL=(.*)$/m)![1]!, { max: 1 });
test.afterAll(() => db.end());
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

type Ws = { plan: string; billing_status: string | null; billing_subscription_id: string | null };
const wsOf = async (base: string) =>
  (
    await db`select w.id, w.plan, w.billing_status, w.billing_subscription_id, w.billing_customer_id
             from workspace w join program p on p.workspace_id = w.id where p.id = ${base.split("/")[2]!}`
  )[0] as Ws & { id: string; billing_customer_id: string | null };
/** Waits until the webhook from Stripe has updated the workspace. */
async function until(base: string, ok: (w: Ws) => boolean, what: string) {
  for (let i = 0; i < 60; i++) {
    const w = await wsOf(base);
    if (ok(w)) return w;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`timed out waiting for: ${what} (now ${JSON.stringify(await wsOf(base))})`);
}

/** Fills the hosted Stripe Checkout page with a test card, the way a founder would. */
type Addr = { country: string; line1: string; city: string; zip: string; state: string };
const US: Addr = { country: "US", line1: "1 Test Street", city: "San Francisco", zip: "94103", state: "CA" };
const IN_MH: Addr = {
  country: "IN",
  line1: "1 Marine Drive",
  city: "Mumbai",
  zip: "400001",
  state: "Maharashtra",
};
const IN_UP: Addr = {
  country: "IN",
  line1: "548 Sector 12D",
  city: "Agra",
  zip: "282007",
  state: "Uttar Pradesh",
};

async function pay(page: Page, card: string, a: Addr = US) {
  await page.waitForURL(/checkout\.stripe\.com/, { timeout: 60_000 });
  await page.getByRole("textbox", { name: "Card number" }).fill(card);
  await page.getByRole("textbox", { name: "Expiration" }).fill("12 / 34");
  await page.getByRole("textbox", { name: /CVC/ }).fill("123");
  await page.getByRole("textbox", { name: "Cardholder name" }).fill("Test Founder");
  // a returning customer already has an address on file, and Checkout then asks for none
  const country = page.getByRole("combobox", { name: "Country or region" });
  if (await country.isVisible().catch(() => false)) {
    await country.selectOption(a.country);
    const manual = page.getByRole("button", { name: "Enter address manually" });
    if (await manual.isVisible().catch(() => false)) await manual.click();
    for (const [name, v] of [
      [/Address line 1/, a.line1],
      [/City/, a.city],
      [/ZIP|PIN|Postal/i, a.zip],
    ] as const) {
      const f = page.getByRole("textbox", { name });
      if ((await f.isVisible().catch(() => false)) && !(await f.inputValue())) await f.fill(v);
    }
  }
  const state = page.getByRole("combobox", { name: /State/ });
  // US states are picked by code (CA), Indian states by name
  if (await state.isVisible().catch(() => false))
    await state
      .selectOption(a.state, { timeout: 3000 })
      .catch(() => state.selectOption({ label: a.state }, { timeout: 3000 }));
  await page.getByRole("button", { name: "Subscribe" }).click();
}

async function region(page: Page, label: string) {
  const sel = page.getByRole("combobox", { name: "Billing location" });
  if (!(await sel.isVisible().catch(() => false))) return;
  await sel.click();
  await page.getByRole("option", { name: label }).click();
  await expect(sel).toContainText(label);
}

async function choose(page: Page, base: string, planName: string, where = "Outside India") {
  await page.goto(`${base}/settings/billing`);
  await region(page, where);
  const card = page.locator("div", { has: page.getByText(planName, { exact: true }) }).filter({
    has: page.getByRole("button"),
  });
  await card.last().getByRole("button", { name: "Choose" }).click();
}

test("declined card: Checkout shows the error and the plan stays Free", async ({ page }) => {
  const base = await newFounder(page, "Decline", `pay-dec-${uid()}@example.test`, `Dec ${uid()}`);
  await choose(page, base, "Starter");
  await pay(page, "4000 0000 0000 0002");
  await expect(page.getByText(/declined/i).first()).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(3000);
  expect((await wsOf(base)).plan).toBe("free");
});

test("3D Secure card: after the bank check the plan starts", async ({ page }) => {
  const base = await newFounder(page, "Secure", `pay-3ds-${uid()}@example.test`, `Sec ${uid()}`);
  await choose(page, base, "Starter");
  await pay(page, "4000 0025 0000 3155");
  // the test bank page sits in nested Stripe frames: find the one with the Complete button
  await expect
    .poll(
      async () => {
        for (const f of page.frames()) {
          const b = f.getByRole("button", { name: /^complete$/i });
          if (await b.isVisible().catch(() => false)) {
            await page.waitForTimeout(1500);
            await b.click();
            return true;
          }
        }
        return false;
      },
      { timeout: 45_000 },
    )
    .toBe(true);
  await page.waitForURL(/billing=success/, { timeout: 60_000 });
  await until(base, (w) => w.plan === "starter" && w.billing_status === "active", "3DS plan active");
});

test("full life of a plan: pay, upgrade, schedule cancel, undo, cancel, pay again, delete account", async ({
  page,
}) => {
  const email = `pay-life-${uid()}@example.test`;
  const base = await newFounder(page, "Lifecycle", email, `Life ${uid()}`);

  // 1. pay for Starter with 4242: charged now, no trial
  await choose(page, base, "Starter");
  await pay(page, "4242 4242 4242 4242");
  await page.waitForURL(/billing=success/, { timeout: 60_000 });
  await expect(page.getByText("Thanks for subscribing")).toBeVisible();
  let w = await until(base, (x) => x.plan === "starter" && x.billing_status === "active", "starter active");
  const sub = await stripe.subscriptions.retrieve(w.billing_subscription_id!, { expand: ["latest_invoice"] });
  expect(sub.trial_end).toBeNull();
  const inv = sub.latest_invoice as Stripe.Invoice;
  expect(inv.status).toBe("paid");
  expect(inv.amount_paid).toBe(2900);
  await page.reload();
  await expect(page.getByText("Starter plan", { exact: true })).toBeVisible();
  await expect(page.getByText(/Free trial/)).toHaveCount(0);

  // 2. Starter again goes to the portal, never a second checkout
  await page.getByRole("button", { name: "Manage billing" }).click();
  await page.waitForURL(/billing\.stripe\.com/, { timeout: 60_000 });
  // 3. upgrade to Growth in the portal
  await page.getByRole("link", { name: /update subscription/i }).click();
  // Growth is the first "Select" (Starter is the current plan and has none)
  await page.getByRole("button", { name: "Select" }).first().click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: /confirm/i }).click();
  w = await until(base, (x) => x.plan === "growth", "growth after portal upgrade");
  // the upgrade is charged the same day: an invoice for the difference ($79 - $29, less a few minutes) is paid
  await expect
    .poll(
      async () =>
        (await stripe.invoices.list({ subscription: w.billing_subscription_id!, limit: 5 })).data.find(
          (i) => i.billing_reason === "subscription_update" && i.status === "paid",
        )?.amount_paid ?? 0,
      { timeout: 60_000 },
    )
    .toBeGreaterThan(4900);

  // 4. schedule a cancel in the portal
  await page.goto(`${base}/settings/billing`);
  await page.getByRole("button", { name: "Manage billing" }).click();
  await page.waitForURL(/billing\.stripe\.com/, { timeout: 60_000 });
  await page.getByRole("link", { name: /cancel subscription/i }).click();
  // review screen, then the optional "why are you leaving" dialog, then the review again: click through
  // until Stripe has the cancellation scheduled
  const subId = w.billing_subscription_id!;
  await expect
    .poll(
      async () => {
        const cont = page.getByRole("button", { name: "Continue to cancellation" });
        if (await cont.isVisible().catch(() => false)) await cont.click();
        else {
          const btn = page.getByRole("button", { name: "Cancel subscription" });
          if (await btn.isVisible().catch(() => false)) await btn.click();
        }
        await page.waitForTimeout(2000);
        return (await stripe.subscriptions.retrieve(subId)).cancel_at !== null;
      },
      { timeout: 60_000, intervals: [500] },
    )
    .toBe(true);
  await page.waitForTimeout(3000);
  await page.goto(`${base}/settings/billing`);
  await expect(page.getByRole("status").filter({ hasText: "ends on" })).toBeVisible({ timeout: 30_000 });
  expect((await wsOf(base)).plan).toBe("growth");

  // 5. undo in the portal
  await page.getByRole("button", { name: "Manage billing" }).click();
  await page.waitForURL(/billing\.stripe\.com/, { timeout: 60_000 });
  await expect
    .poll(
      async () => {
        for (const name of ["Don't cancel subscription", "Renew subscription"]) {
          for (const role of ["link", "button"] as const) {
            const el = page.getByRole(role, { name });
            if (await el.isVisible().catch(() => false)) {
              await el.click();
              break;
            }
          }
        }
        await page.waitForTimeout(2000);
        return (await stripe.subscriptions.retrieve(subId)).cancel_at;
      },
      { timeout: 60_000, intervals: [500] },
    )
    .toBeNull();
  await page.waitForTimeout(3000);
  await page.goto(`${base}/settings/billing`);
  await expect(page.getByText(/ends on/)).toHaveCount(0);

  // 6. canceled at once (as support would): back to Free
  await stripe.subscriptions.cancel(w.billing_subscription_id!);
  await until(base, (x) => x.plan === "free", "free after cancel");

  // 7. pay again through Checkout: new subscription, charged now, plan back
  const old = w.billing_subscription_id;
  await choose(page, base, "Starter");
  await pay(page, "4242 4242 4242 4242");
  await page.waitForURL(/billing=success/, { timeout: 60_000 });
  w = await until(
    base,
    (x) => x.plan === "starter" && x.billing_subscription_id !== old,
    "starter again on a new subscription",
  );

  // 8. deleting the account cancels the live plan
  await page.goto(`${base}/settings/account`);
  await page.getByRole("button", { name: "Delete my account" }).click();
  await page.getByLabel("Your password").fill("e2e-password-123");
  await page.getByRole("button", { name: "Delete my account for good" }).click();
  await page.waitForURL(/\/login\?deleted=1/);
  expect((await stripe.subscriptions.retrieve(w.billing_subscription_id!)).status).toBe("canceled");
});

test("renewal fails, the plan is kept with a warning, a new card recovers it", async ({ page }) => {
  const email = `pay-renew-${uid()}@example.test`;
  const base = await newFounder(page, "Renewal", email, `Ren ${uid()}`);
  const ws = await wsOf(base);
  // the founder's Stripe customer runs on a test clock so a month can pass in seconds
  const clock = await stripe.testHelpers.testClocks.create({ frozen_time: Math.floor(Date.now() / 1000) });
  const customer = await stripe.customers.create({
    email,
    test_clock: clock.id,
    metadata: { e2e: "renewal" },
  });
  await db`update workspace set billing_customer_id = ${customer.id} where id = ${ws.id}`;

  // first payment through Checkout, on-session like a real founder (this also sets up the card mandate)
  await choose(page, base, "Starter");
  await pay(page, "4242 4242 4242 4242");
  await page.waitForURL(/billing=success/, { timeout: 60_000 });
  const w = await until(base, (x) => x.plan === "starter" && x.billing_status === "active", "starter active");
  const subId = w.billing_subscription_id!;
  const good = (await stripe.subscriptions.retrieve(subId)).default_payment_method as string;

  // the card on file starts failing, then a month passes
  const bad = await stripe.paymentMethods.attach("pm_card_chargeCustomerFail", { customer: customer.id });
  await stripe.subscriptions.update(subId, { default_payment_method: bad.id });
  await stripe.testHelpers.testClocks.advance(clock.id, {
    frozen_time: Math.floor(Date.now() / 1000) + 32 * 86_400,
  });
  await until(base, (x) => x.billing_status === "past_due", "past_due after failed renewal");
  expect((await wsOf(base)).plan).toBe("starter");
  await page.goto(`${base}/settings/billing`);
  await expect(page.getByRole("status").filter({ hasText: "Your last payment failed" })).toBeVisible();

  // the founder switches back to a working card and the open invoice is paid
  await expect
    .poll(async () => (await stripe.testHelpers.testClocks.retrieve(clock.id)).status, { timeout: 120_000 })
    .toBe("ready");
  await stripe.subscriptions.update(subId, { default_payment_method: good });
  const open = (await stripe.invoices.list({ subscription: subId, status: "open" })).data[0]!;
  await stripe.invoices.pay(open.id, { payment_method: good });
  await until(base, (x) => x.billing_status === "active", "active after recovery");
  await page.reload();
  await expect(page.getByText(/last payment failed/)).toHaveCount(0);
  await stripe.subscriptions.cancel(subId);
});

/* ------------------------------------------------------------------ India GST */

async function firstInvoice(base: string) {
  const w = await until(base, (x) => x.plan === "starter" && x.billing_status === "active", "starter active");
  const sub = await stripe.subscriptions.retrieve(w.billing_subscription_id!, { expand: ["latest_invoice"] });
  const inv = sub.latest_invoice as Stripe.Invoice;
  const taxes = (inv.total_taxes ?? []).map((t) => t.amount);
  return { sub, inv, taxes };
}

test("GST: India, another state pays 18% IGST from the first payment", async ({ page }) => {
  const base = await newFounder(page, "GST Other", `gst-mh-${uid()}@example.test`, `Gmh ${uid()}`);
  await choose(page, base, "Starter", "India: another state");
  await pay(page, "4242 4242 4242 4242", IN_MH);
  await page.waitForURL(/billing=success/, { timeout: 60_000 });
  const { inv, taxes } = await firstInvoice(base);
  expect(inv.subtotal).toBe(2900);
  expect(taxes).toEqual([522]);
  expect(inv.total).toBe(3422);
  expect(inv.amount_paid).toBe(3422);
});

test("GST: Uttar Pradesh pays CGST 9% + SGST 9%", async ({ page }) => {
  const base = await newFounder(page, "GST Home", `gst-up-${uid()}@example.test`, `Gup ${uid()}`);
  await choose(page, base, "Starter", "India: Uttar Pradesh");
  await pay(page, "4242 4242 4242 4242", IN_UP);
  await page.waitForURL(/billing=success/, { timeout: 60_000 });
  const { inv, taxes } = await firstInvoice(base);
  expect(taxes.sort()).toEqual([261, 261]);
  expect(inv.total).toBe(3422);
});

test("GST: outside India pays no GST", async ({ page }) => {
  const base = await newFounder(page, "GST Abroad", `gst-us-${uid()}@example.test`, `Gus ${uid()}`);
  await choose(page, base, "Starter", "Outside India");
  await pay(page, "4242 4242 4242 4242", US);
  await page.waitForURL(/billing=success/, { timeout: 60_000 });
  const { inv, taxes } = await firstInvoice(base);
  expect(taxes).toEqual([]);
  expect(inv.total).toBe(2900);
});

test("GST: picked Outside India but typed an Indian address, renewals get IGST", async ({ page }) => {
  const base = await newFounder(page, "GST Mismatch", `gst-mix-${uid()}@example.test`, `Gmix ${uid()}`);
  await choose(page, base, "Starter", "Outside India");
  await pay(page, "4242 4242 4242 4242", IN_MH);
  await page.waitForURL(/billing=success/, { timeout: 60_000 });
  const { sub } = await firstInvoice(base);
  await expect
    .poll(
      async () =>
        (await stripe.subscriptions.retrieve(sub.id)).default_tax_rates?.map((r) =>
          typeof r === "string" ? r : r.display_name,
        ),
      { timeout: 60_000 },
    )
    .toEqual(["IGST"]);
  const [w] = await db`select w.billing_region from workspace w join program p on p.workspace_id = w.id
                       where p.id = ${base.split("/")[2]!}`;
  expect(w!.billing_region).toBe("in_other");
  await page.goto(`${base}/settings/billing`);
  await expect(page.getByRole("combobox", { name: "Billing location" })).toContainText(
    "India: another state",
  );
  await stripe.subscriptions.cancel(sub.id);
});
