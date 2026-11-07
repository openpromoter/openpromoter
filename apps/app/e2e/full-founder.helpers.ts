import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { type APIRequestContext, type Browser, expect, type Page } from "@playwright/test";
import { stripeEvent, uid } from "./helpers";

/**
 * Shared state for full-founder.spec.ts. A failed test restarts the Playwright worker (and re-runs
 * beforeAll), so the founder, program and created records live in a file keyed by the runner pid:
 * one founder per `playwright test` run, no extra sign-ins after a failure.
 */
// outside test-results/: other testers share that folder and Playwright wipes it on every run
const DIR = path.join(tmpdir(), "openpromoter-e2e-full-founder");
const FILE = path.join(DIR, `run-${process.ppid}.json`);
export const FOUNDER_STATE = path.join(DIR, `founder-${process.ppid}.json`);
export const PARTNER_STATE = path.join(DIR, `partner-${process.ppid}.json`);

export interface State {
  id: string;
  email: string;
  programId: string;
  base: string;
  slug: string;
  webhookUrl: string;
  [k: string]: unknown;
}

export const load = (): State | null => (existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : null);
export function save(patch: Partial<State>) {
  mkdirSync(DIR, { recursive: true });
  const next = { ...(load() ?? {}), ...patch };
  writeFileSync(FILE, JSON.stringify(next, null, 2));
  return next as State;
}
export const need = <T = string>(k: string): T => {
  const v = load()?.[k];
  if (v == null) throw new Error(`missing state "${k}" (an earlier test that creates it failed)`);
  return v as T;
};

/** Console errors, page errors and 5xx responses seen on a page. */
export function watch(page: Page) {
  const problems: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(`console: ${m.text().slice(0, 300)}`);
  });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message.slice(0, 300)}`));
  page.on("response", (r) => {
    if (r.status() >= 500) problems.push(`HTTP ${r.status()} ${r.request().method()} ${r.url()}`);
  });
  page.on("dialog", (d) => void d.accept(d.type() === "prompt" ? "e2e" : undefined));
  return problems;
}

export const toast = (page: Page, text: string | RegExp) =>
  page.locator("[data-sonner-toast]", { hasText: text }).first();

export async function expectToast(page: Page, text: string | RegExp, type: "success" | "error" = "success") {
  const t = toast(page, text);
  await expect(t).toBeVisible();
  await expect(t).toHaveAttribute("data-type", type);
}

/** Signs up a founder and runs onboarding exactly like flow.spec.ts. */
export async function createFounder(browser: Browser, id: string) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const email = `fq-${id}@e2e.test`;
  await page.goto("/signup");
  await page.getByLabel("Name").fill("Quinn Founder");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("e2e-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/onboarding/);
  await page.getByLabel("Website URL").fill("http://127.0.0.1:3000");
  await page.getByLabel("Product name").fill(`QA Co ${id}`);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Connect Stripe" })).toBeVisible();
  await page.getByRole("button", { name: /Skip for now/ }).click();
  await page.getByRole("button", { name: "Accept this program" }).click();
  await expect(page.getByRole("heading", { name: "Install tracking" })).toBeVisible();
  await page.getByRole("button", { name: /I'll do this later|Continue/ }).click();
  await page.getByRole("link", { name: "Go to dashboard" }).click();
  await page.waitForURL(/\/app\/prg_/);
  const base = new URL(page.url()).pathname;
  await ctx.storageState({ path: FOUNDER_STATE });
  await ctx.close();
  return { email, base, programId: base.split("/")[2]! };
}

/** A paid Stripe subscription invoice attributed to a partner link (signed test webhooks). */
export async function referredSale(
  request: APIRequestContext,
  o: { slug: string; key: string; webhookUrl: string; amount: number; description: string; email?: string },
) {
  const id = uid() + uid();
  const res = await request.get(`/r/${o.slug}/l/${o.key}`, { maxRedirects: 0 });
  expect(res.status()).toBe(302);
  const clickId = new URL(res.headers().location!).searchParams.get("op_click")!;
  const email = o.email ?? `buyer-${id}@e2e.test`;
  await stripeEvent(request, o.webhookUrl, "checkout.session.completed", {
    id: `cs_${id}`,
    object: "checkout.session",
    customer: `cus_${id}`,
    client_reference_id: clickId,
    customer_details: { email, name: "Buyer" },
    subscription: `sub_${id}`,
    metadata: {},
  });
  await stripeEvent(request, o.webhookUrl, "invoice.paid", {
    id: `in_${id}`,
    object: "invoice",
    customer: `cus_${id}`,
    customer_email: email,
    amount_paid: o.amount,
    tax: 0,
    currency: "usd",
    charge: `ch_${id}`,
    subscription: `sub_${id}`,
    status_transitions: { paid_at: Math.floor(Date.now() / 1000) },
    lines: {
      data: [{ description: o.description, price: { recurring: { interval: "month", interval_count: 1 } } }],
    },
  });
  save({ revenue: ((load()?.revenue as number) ?? 0) + o.amount });
  return { email, charge: `ch_${id}`, customer: `cus_${id}` };
}

/** Parses a simple CSV (quoted fields allowed) into objects. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (q) {
      if (ch === '"' && text[i + 1] === '"') (cur += '"'), i++;
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") row.push(cur), (cur = "");
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cur), rows.push(row), (row = []), (cur = "");
    } else cur += ch;
  }
  if (cur || row.length) row.push(cur), rows.push(row);
  const [head, ...body] = rows.filter((r) => r.some((c) => c !== ""));
  return body.map((r) => Object.fromEntries(head!.map((h, i) => [h, r[i] ?? ""])));
}
