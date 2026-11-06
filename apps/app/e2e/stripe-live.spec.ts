import { expect, test } from "@playwright/test";
import Stripe from "stripe";
import { uid } from "./helpers";

/**
 * Real Stripe test mode. Needs a test-mode restricted key and `stripe listen` running:
 *   stripe listen --forward-to localhost:3000/api/webhooks/stripe/<workspaceId>
 *   STRIPE_TEST_KEY=rk_test_... E2E_PROGRAM_URL=/app/prg_... E2E_FOUNDER_EMAIL=... E2E_FOUNDER_PASSWORD=... E2E_PARTNER_CODE=... pnpm e2e stripe-live
 * The program must already be connected to that Stripe account with the listen secret.
 */
const key = process.env.STRIPE_TEST_KEY;
test.skip(!key?.includes("_test_"), "set STRIPE_TEST_KEY (test mode) to run against real Stripe");

test("real Stripe test subscription is attributed and commissioned", async ({ page, request }) => {
  const stripe = new Stripe(key!);
  const slug = process.env.E2E_PROGRAM_SLUG!;
  const res = await request.get(`/r/${slug}/${process.env.E2E_PARTNER_CODE}`, { maxRedirects: 0 });
  const clickId = new URL(res.headers().location!).searchParams.get("op_click")!;
  const price = await stripe.prices.create({
    currency: "usd",
    unit_amount: 4900,
    recurring: { interval: "month" },
    product_data: { name: `E2E ${uid()}` },
  });
  const customer = await stripe.customers.create({
    email: `buyer-${uid()}@e2e.test`,
    metadata: { op_click: clickId },
    payment_method: "pm_card_visa",
    invoice_settings: { default_payment_method: "pm_card_visa" },
  });
  await stripe.subscriptions.create({ customer: customer.id, items: [{ price: price.id }] });

  await page.goto("/login");
  await page.getByLabel("Email").fill(process.env.E2E_FOUNDER_EMAIL!);
  await page.getByLabel("Password", { exact: true }).fill(process.env.E2E_FOUNDER_PASSWORD!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(async () => {
    await page.goto(`${process.env.E2E_PROGRAM_URL}/customers`);
    await expect(page.getByText(customer.email!)).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 60_000 });
});
