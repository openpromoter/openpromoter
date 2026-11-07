import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import postgres from "postgres";
import Stripe from "stripe";
import { newFounder } from "./full-settings.helpers";

/**
 * A founder's own customers paying through real Stripe test mode: partner click, Checkout payment,
 * renewal, refund and dispute, each checked against the commission the partner earns.
 * Uses the Stripe CLI (`stripe listen`) to forward the founder's events to this Mac:
 *   LOCAL_STRIPE=1 pnpm e2e founder-sales-local
 * The connection is made with the CLI's signing secret, so no webhook endpoint is created in Stripe.
 */
const env = fs.readFileSync(".env.local", "utf8");
const key = env.match(/^PLATFORM_STRIPE_SECRET_KEY=(sk_test_\S+)$/m)?.[1];
test.skip(!process.env.LOCAL_STRIPE || !key, "set LOCAL_STRIPE=1 with a Stripe test key in .env.local");
test.describe.configure({ mode: "serial" });
test.setTimeout(480_000);

const stripe = new Stripe(key ?? "sk_test_x");
const db = postgres(env.match(/^DATABASE_URL=(.*)$/m)![1]!, { max: 1 });
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const EVENTS = [
  "customer.created",
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "invoice.paid",
  "invoice_payment.paid",
  "charge.refunded",
  "charge.dispute.created",
  "charge.dispute.closed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
].join(",");

let listen: ChildProcess | null = null;
let base = "";
let wsId = "";
let progId = "";
let slug = "";
let partnerId = "";
const email = `sales-${uid()}@example.test`;

test.afterAll(async () => {
  listen?.kill();
  await db.end();
});

async function pay(page: Page, card: string) {
  await page.waitForURL(/checkout\.stripe\.com/, { timeout: 60_000 });
  await page.getByRole("textbox", { name: "Card number" }).fill(card);
  await page.getByRole("textbox", { name: "Expiration" }).fill("12 / 34");
  await page.getByRole("textbox", { name: /CVC/ }).fill("123");
  await page.getByRole("textbox", { name: "Cardholder name" }).fill("Buyer Person");
  const country = page.getByRole("combobox", { name: "Country or region" });
  if (await country.isVisible().catch(() => false)) {
    await country.selectOption("US");
    const manual = page.getByRole("button", { name: "Enter address manually" });
    if (await manual.isVisible().catch(() => false)) await manual.click();
    for (const [name, v] of [
      [/Address line 1/, "1 Buyer Street"],
      [/City/, "San Francisco"],
      [/ZIP/, "94103"],
    ] as const) {
      const f = page.getByRole("textbox", { name });
      if ((await f.isVisible().catch(() => false)) && !(await f.inputValue())) await f.fill(v);
    }
    const state = page.getByRole("combobox", { name: /State/ });
    if (await state.isVisible().catch(() => false)) await state.selectOption("CA");
  }
  await page.getByRole("button", { name: /^(Subscribe|Pay)/ }).click();
}

type Com = { id: string; status: string; amount: number; sale_amount: number; kind: string };
const commissions = async () =>
  (await db`select id, status, amount, sale_amount, kind from commission
            where partner_id = ${partnerId} order by created_at`) as unknown as Com[];
async function waitFor<T>(fn: () => Promise<T>, ok: (v: T) => boolean, what: string) {
  for (let i = 0; i < 90; i++) {
    const v = await fn();
    if (ok(v)) return v;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`timed out: ${what} (now ${JSON.stringify(await fn())})`);
}

/** A buyer clicks the partner's link and pays the founder in Stripe Checkout. */
async function buy(page: Page, mode: "subscription" | "payment", card: string, customer?: string) {
  const res = await page.request.get(`/r/${slug}/${"sales"}`, { maxRedirects: 0 });
  expect(res.status()).toBe(302);
  const clickId = new URL(res.headers().location!).searchParams.get("op_click")!;
  expect(clickId).toBeTruthy();
  const price = await stripe.prices.create({
    currency: "usd",
    unit_amount: 4900,
    ...(mode === "subscription" ? { recurring: { interval: "month" as const } } : {}),
    product_data: { name: `Founder product ${uid()}` },
  });
  const session = await stripe.checkout.sessions.create({
    mode,
    line_items: [{ price: price.id, quantity: 1 }],
    client_reference_id: clickId,
    ...(customer ? { customer } : { customer_email: `buyer-${uid()}@example.test` }),
    ...(mode === "subscription" ? { subscription_data: { metadata: { op_click: clickId } } } : {}),
    success_url: "http://localhost:3000/api/health",
    cancel_url: "http://localhost:3000/api/health",
  });
  await page.goto(session.url!);
  await pay(page, card);
  await page.waitForURL(/api\/health/, { timeout: 90_000 });
  return session.id;
}

test("setup: founder connects Stripe, an approved partner exists", async ({ page }) => {
  base = await newFounder(page, "Sales Founder", email, `Sales ${uid()}`);
  progId = base.split("/")[2]!;
  const [p] = await db`select workspace_id, slug from program where id = ${progId}`;
  wsId = p!.workspace_id;
  slug = p!.slug;
  // fixed terms so the expected commission is exact: 30% for 12 months, approved after 30 days
  await db`update program set commission_type = 'percent', commission_value = 3000,
           commission_duration = 'months', commission_months = 12 where id = ${progId}`;
  partnerId = `prt_sales${uid()}`;
  await db`insert into partner (id, program_id, workspace_id, email, name, code, status, approved_at)
           values (${partnerId}, ${progId}, ${wsId}, ${`partner-${uid()}@example.test`}, 'Sally Partner', 'sales', 'approved', now())`;

  // forward this founder's Stripe test events to their webhook URL
  const secret = await new Promise<string>((resolve, reject) => {
    const s = spawn("stripe", ["listen", "--api-key", key!, "--print-secret"]);
    let out = "";
    s.stdout.on("data", (d) => (out += d));
    s.on("close", () => (out.trim() ? resolve(out.trim()) : reject(new Error("no secret"))));
  });
  listen = spawn("stripe", [
    "listen",
    "--api-key",
    key!,
    "--events",
    EVENTS,
    "--forward-to",
    `localhost:3000/api/webhooks/stripe/${wsId}`,
  ]);
  await new Promise((r) => setTimeout(r, 6000));

  await page.goto(`${base}/settings/integrations`);
  await page.getByLabel("Restricted key").fill(key!);
  await page.getByLabel("Webhook signing secret").fill(secret);
  await page.getByRole("button", { name: /^(Connect|Update)$/ }).click();
  await waitFor(
    async () => (await db`select count(*)::int n from billing_connection where workspace_id = ${wsId}`)[0]!.n,
    (n) => n === 1,
    "stripe connected",
  );
  // connecting with a pasted secret must not create a webhook endpoint in Stripe
  const [conn] = await db`select webhook_endpoint_id from billing_connection where workspace_id = ${wsId}`;
  expect(conn!.webhook_endpoint_id).toBeNull();
});

test("subscription sale: referral, 30% commission, renewal earns again, refund reverses", async ({
  page,
}) => {
  const clock = await stripe.testHelpers.testClocks.create({ frozen_time: Math.floor(Date.now() / 1000) });
  const buyer = await stripe.customers.create({ email: `buyer-${uid()}@example.test`, test_clock: clock.id });
  await buy(page, "subscription", "4242 4242 4242 4242", buyer.id);

  const first = await waitFor(commissions, (c) => c.length >= 1, "first commission");
  expect(first[0]!.sale_amount).toBe(4900);
  expect(first[0]!.amount).toBe(1470);
  expect(first[0]!.status).toBe("pending");
  const [ref] = await db`select status, partner_id from referral where program_id = ${progId}
                        and external_customer_id = ${buyer.id}`;
  expect(ref!.partner_id).toBe(partnerId);

  // a month later Stripe renews: the partner earns again
  await stripe.testHelpers.testClocks.advance(clock.id, {
    frozen_time: Math.floor(Date.now() / 1000) + 32 * 86_400,
  });
  const two = await waitFor(commissions, (c) => c.filter((x) => x.kind === "sale").length >= 2, "renewal");
  expect(two[1]!.amount).toBe(1470);

  // the founder refunds the first payment in full: that commission is reversed
  await expect
    .poll(async () => (await stripe.testHelpers.testClocks.retrieve(clock.id)).status, { timeout: 120_000 })
    .toBe("ready");
  const invoices = await stripe.invoices.list({ customer: buyer.id, status: "paid" });
  const oldest = invoices.data[invoices.data.length - 1]!;
  const payments = await stripe.invoicePayments.list({ invoice: oldest.id });
  const pi = payments.data[0]!.payment.payment_intent as string;
  await stripe.refunds.create({ payment_intent: pi });
  await waitFor(commissions, (c) => c.some((x) => x.status === "reversed"), "refund reverses a commission");
});

test("one-time payment, then a dispute holds the commission", async ({ page }) => {
  const before = (await commissions()).length;
  await buy(page, "payment", "4000 0000 0000 0259");
  const after = await waitFor(commissions, (c) => c.length > before, "one-time sale commission");
  const sale = after[after.length - 1]!;
  expect(sale.sale_amount).toBe(4900);
  await waitFor(
    async () => (await db`select status from commission where id = ${sale.id}`)[0]!.status as string,
    (s) => s === "held",
    "dispute holds the commission",
  );
});

test("the founder sees it all on the dashboard", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("e2e-password-123");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/app\/prg_/);
  await page.goto(`${base}/commissions`);
  await expect(page.getByText("Sally Partner").first()).toBeVisible();
  await expect(page.getByText("$14.70").first()).toBeVisible();
});
