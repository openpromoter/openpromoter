import fs from "node:fs";
import { expect, test } from "@playwright/test";
import postgres from "postgres";
import Stripe from "stripe";
import { newFounder, PASSWORD, signIn } from "./full-settings.helpers";

// Accounts made with Google or GitHub have no password. Setting one, two-factor and deleting the
// account must still work for them, and deleting one program must leave the account alone.
const url =
  process.env.DATABASE_URL ?? fs.readFileSync(".env.local", "utf8").match(/^DATABASE_URL=(.*)$/m)![1]!;
const db = postgres(url, { max: 1, onnotice: () => {} });
test.afterAll(() => db.end());

const SHOTS = process.env.SHOT_DIR;
const id = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

/** Makes a fresh founder look like a Google sign-up: no password row, a google login instead. */
async function asGoogleOnly(email: string) {
  await db`update account set password = null, provider_id = 'google', account_id = ${`g-${id()}`}
           where user_id = (select id from "user" where email = ${email})`;
}
const userCount = async (email: string) =>
  Number((await db`select count(*)::int as n from "user" where email = ${email}`)[0]!.n);

test("Google-only founder sets a password, then signs in with it", async ({ page, browser }) => {
  const email = `g-pw-${id()}@example.test`;
  const base = await newFounder(page, "Google Founder", email, `Gpw ${id()}`);
  await asGoogleOnly(email);
  await page.goto(`${base}/settings/account`);
  await expect(page.getByText("You sign in with Google.")).toBeVisible();
  await expect(page.getByText("Set a password above first.")).toBeVisible();
  await expect(page.getByLabel("Current password")).toHaveCount(0);
  await page.getByLabel("New password").fill("short");
  await page.getByRole("button", { name: "Set password" }).click();
  // the browser refuses short passwords before anything is sent
  expect(await page.getByLabel("New password").evaluate((el: HTMLInputElement) => el.validity.tooShort)).toBe(
    true,
  );
  await page.getByLabel("New password").fill("google-then-pw-123");
  await page.getByRole("button", { name: "Set password" }).click();
  await expect(page.getByText(/Password set/)).toBeVisible();
  await expect(page.getByLabel("Current password")).toBeVisible();
  await expect(page.getByPlaceholder("Confirm your password")).toBeVisible();

  const other = await (await browser.newContext()).newPage();
  await signIn(other, email, "google-then-pw-123");
  await expect(other).toHaveURL(/\/app\/prg_/);
});

test("setting a password needs a session from the last day", async ({ page }) => {
  const email = `g-old-${id()}@example.test`;
  const base = await newFounder(page, "Old Session", email, `Gold ${id()}`);
  await asGoogleOnly(email);
  await db`update session set created_at = now() - interval '2 days'
           where user_id = (select id from "user" where email = ${email})`;
  await page.goto(`${base}/settings/account`);
  await page.getByLabel("New password").fill("google-then-pw-123");
  await page.getByRole("button", { name: "Set password" }).click();
  await expect(page.getByText(/sign out and sign in again/)).toBeVisible();
  const rows =
    await db`select password from account where user_id = (select id from "user" where email = ${email})`;
  expect(rows.every((r) => r.password === null)).toBe(true);
});

test("Google-only founder deletes the account by typing DELETE", async ({ page }) => {
  const email = `g-del-${id()}@example.test`;
  const base = await newFounder(page, "Google Delete", email, `Gdel ${id()}`);
  await asGoogleOnly(email);
  // a paid plan in Stripe test mode: deleting the account must cancel it so the card stops being charged
  const key = fs.readFileSync(".env.local", "utf8").match(/^PLATFORM_STRIPE_SECRET_KEY=(sk_test_\S+)$/m)?.[1];
  const stripe = key ? new Stripe(key) : null;
  let subId: string | null = null;
  if (stripe) {
    const [price] = (await stripe.prices.list({ lookup_keys: ["openpromoter_starter_monthly"] })).data;
    const cus = await stripe.customers.create({ email, metadata: { e2e: "account-delete" } });
    const sub = await stripe.subscriptions.create({
      customer: cus.id,
      items: [{ price: price!.id }],
      trial_period_days: 14,
    });
    subId = sub.id;
    await db`update workspace set plan = 'starter', billing_subscription_id = ${sub.id}, billing_customer_id = ${cus.id}
             where id = (select workspace_id from program where id = ${base.split("/")[2]!})`;
  }
  await page.goto(`${base}/settings/account`);
  await page.getByRole("button", { name: "Delete my account" }).click();
  await expect(page.getByRole("link", { name: "Settings > Programs" })).toHaveAttribute(
    "href",
    `${base}/settings/programs`,
  );
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/account-delete-after.png`, fullPage: true });
  const del = page.getByRole("button", { name: "Delete my account for good" });
  await page.getByLabel('Type "DELETE" to confirm').fill("delete");
  await del.click();
  expect(await userCount(email)).toBe(1); // the pattern blocks the wrong case
  await page.getByLabel('Type "DELETE" to confirm').fill("DELETE");
  await del.click();
  await page.waitForURL(/\/login\?deleted=1/);
  await expect(page.getByRole("status")).toContainText("Signing in again starts a new account");
  expect(await userCount(email)).toBe(0);
  if (stripe && subId) expect((await stripe.subscriptions.retrieve(subId)).status).toBe("canceled");
  const progs = await db`select count(*)::int as n from program where id = ${base.split("/")[2]!}`;
  expect(progs[0]!.n).toBe(0);
});

test("password founder needs the right password to delete the account", async ({ page }) => {
  const email = `pw-del-${id()}@example.test`;
  const base = await newFounder(page, "Password Delete", email, `Pdel ${id()}`);
  await page.goto(`${base}/settings/account`);
  await page.getByRole("button", { name: "Delete my account" }).click();
  await page.getByLabel("Your password").fill("wrong-password-1");
  await page.getByRole("button", { name: "Delete my account for good" }).click();
  await expect(page.getByText(/invalid password/i)).toBeVisible();
  expect(await userCount(email)).toBe(1);
  await page.getByLabel("Your password").fill(PASSWORD);
  await page.getByRole("button", { name: "Delete my account for good" }).click();
  await page.waitForURL(/\/login/);
  expect(await userCount(email)).toBe(0);
});

test("two programs with one name: the list marks the current one and deleting it keeps the account", async ({
  page,
}) => {
  const email = `two-${id()}@example.test`;
  const name = `Twin ${id()}`;
  const first = await newFounder(page, "Twin Founder", email, name);
  // a second program with the same name, as the old double sign-in made
  const p = (await db`select * from program where id = ${first.split("/")[2]!}`)[0]!;
  const secondId = `prg_${id()}x`;
  const copy: Record<string, unknown> = {
    ...p,
    id: secondId,
    slug: `${p.slug}-2`,
    created_at: new Date(Date.now() + 60_000),
    custom_domain: null,
  };
  const cols = Object.keys(copy);
  await db.unsafe(
    `insert into program (${cols.map((k) => `"${k}"`).join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")})`,
    Object.values(copy) as never[],
  );

  await page.goto(`/app/${secondId}/settings/programs`);
  const rows = page.locator("li", { hasText: name });
  await expect(rows).toHaveCount(2);
  await expect(page.locator("li", { hasText: "Current" })).toHaveCount(1);
  await expect(page.getByText(/Deletes .* \(created /)).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/programs-after.png`, fullPage: true });

  await page.getByRole("button", { name: "Account menu" }).first().click();
  await expect(page.getByRole("menuitem", { name: "Account settings" })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByLabel(`Type "${name}" to confirm`).fill(name);
  await page.getByRole("button", { name: "Delete program" }).click();
  await page.waitForURL(new RegExp(`${first}$`));
  expect(await userCount(email)).toBe(1);
  expect((await db`select count(*)::int as n from program where id = ${secondId}`)[0]!.n).toBe(0);
  expect((await db`select count(*)::int as n from program where id = ${first.split("/")[2]!}`)[0]!.n).toBe(1);
});
