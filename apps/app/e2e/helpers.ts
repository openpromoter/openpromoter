import type { APIRequestContext, Page } from "@playwright/test";
import Stripe from "stripe";

export const WEBHOOK_SECRET = "whsec_e2e_local_test_secret";
export const uid = () => Math.random().toString(36).slice(2, 8);

/** Sends a Stripe-signed webhook exactly like Stripe (or `stripe listen`) would. */
export async function stripeEvent(
  request: APIRequestContext,
  url: string,
  type: string,
  object: Record<string, unknown>,
) {
  const payload = JSON.stringify({
    id: `evt_${uid()}${uid()}`,
    object: "event",
    type,
    livemode: false,
    created: Math.floor(Date.now() / 1000),
    data: { object },
  });
  const res = await request.post(url, {
    data: payload,
    headers: {
      "content-type": "application/json",
      "stripe-signature": Stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET }),
    },
  });
  if (!res.ok()) throw new Error(`webhook ${type} failed: ${res.status()} ${await res.text()}`);
  return res.json();
}

export async function signUp(page: Page, name: string, email: string, password = "e2e-password-123") {
  await page.goto("/signup");
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/onboarding/);
}
