import { readFileSync } from "node:fs";
import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import {
  createFounder,
  expectToast,
  FOUNDER_STATE,
  load,
  need,
  PARTNER_STATE,
  parseCsv,
  referredSale,
  type State,
  save,
  toast,
  watch,
} from "./full-founder.helpers";
import { uid, WEBHOOK_SECRET } from "./helpers";

/**
 * Every founder-side program feature, end to end, on a fresh founder made by this file.
 * Runs in order (workers: 1). Records created by one test are kept in the state file so a failure
 * does not cascade into skips. Failing tests document bugs: do not relax them to make them pass.
 *
 *   cd apps/app && E2E_BASE_URL=http://localhost:3000 npx playwright test e2e/full-founder.spec.ts
 */
test.describe.configure({ mode: "default" });
// other testers share test-results/; traces there get wiped mid-run
test.use({ trace: "off" });
test.setTimeout(120_000);

let ctx: BrowserContext;
let page: Page;
let problems: string[];
let S: State;

test.beforeAll(async ({ browser }) => {
  if (load()?.webhookUrl) return;
  const id = uid();
  const f = await createFounder(browser, id);
  const c = await browser.newContext({ storageState: FOUNDER_STATE });
  const p = await c.newPage();
  await p.goto(`${f.base}/settings/integrations`);
  const webhookUrl = (await p.locator("text=/api/webhooks/stripe/").first().textContent())!.trim();
  await p.getByLabel("Webhook signing secret").fill(WEBHOOK_SECRET);
  await p.getByRole("button", { name: "Connect" }).first().click();
  await expect(p.getByText("Webhook secret missing")).toHaveCount(0);
  await p.goto(`${f.base}/settings/install`);
  const slug = (await p.locator("pre", { hasText: "data-program" }).first().textContent())!.match(
    /data-program="([^"]+)"/,
  )![1]!;
  await c.storageState({ path: FOUNDER_STATE });
  await c.close();
  save({ id, ...f, slug, webhookUrl });
});

test.beforeEach(async ({ browser }) => {
  S = load()!;
  ctx = await browser.newContext({ storageState: FOUNDER_STATE, acceptDownloads: true });
  page = await ctx.newPage();
  problems = watch(page);
});

test.afterEach(async () => {
  await ctx.close();
  expect(problems, "console errors, page errors or 5xx responses").toEqual([]);
});

const go = async (p: string) => {
  await page.goto(`${S.base}${p}`);
  // dev server: wait for hydration so the first click has a handler
  await page.waitForLoadState("networkidle").catch(() => {});
};
const row = (name: string | RegExp) => page.getByRole("row", { name }).first();
const bulk = (label: string) =>
  page.getByRole("toolbar", { name: "Bulk actions" }).getByRole("button", { name: label, exact: true });
/** Radix Select: open the trigger, click the option. */
async function pick(trigger: ReturnType<Page["getByLabel"]>, option: string | RegExp) {
  await trigger.click();
  await page.getByRole("option", { name: option }).click();
  await expect(page.getByRole("listbox")).toHaveCount(0);
}
async function download(trigger: () => Promise<unknown>) {
  const [dl] = await Promise.all([page.waitForEvent("download"), trigger()]);
  return { name: dl.suggestedFilename(), text: readFileSync((await dl.path())!, "utf8") };
}
async function invite(name: string, email: string) {
  await go("/partners");
  await page.getByRole("button", { name: "Invite partner" }).click();
  const d = page.getByRole("dialog", { name: "Invite a partner" });
  await d.getByLabel("Name").fill(name);
  await d.getByLabel("Email").fill(email);
  await d.getByRole("button", { name: "Send invite" }).click();
  await page.waitForURL(/\/partners\/prt_/);
  return page.url().split("/partners/")[1]!.split(/[?#]/)[0]!;
}

/* ================================================================== empty states */

test("empty states on a brand new program", async () => {
  await go("/partners");
  await expect(page.getByText("No partners yet")).toBeVisible();
  await go("/customers");
  await expect(page.getByText("No referred customers yet")).toBeVisible();
  await go("/commissions");
  await expect(page.getByText("Commissions appear after your first referred sale")).toBeVisible();
  await go("/campaigns");
  await expect(page.getByText("No campaigns yet")).toBeVisible();
  await go("/recruiter");
  await expect(page.getByText("No prospects yet")).toBeVisible();
  await go("/fraud");
  await expect(page.getByText("No fraud signals")).toBeVisible();
  await go("/messages");
  await expect(page.getByText("No conversations yet")).toBeVisible();
  await go("");
  await expect(page.getByText("Nothing is waiting on you.")).toBeVisible();
});

/* ================================================================== partners */

test("partners: invite validation, invite, persists after reload", async () => {
  await go("/partners");
  await page.getByRole("button", { name: "Invite partner" }).click();
  const d = page.getByRole("dialog", { name: "Invite a partner" });
  // HTML5 accepts "a@b"; the server must reject it
  await d.getByLabel("Name").fill("Bad Email");
  await d.getByLabel("Email").fill("a@b");
  await d.getByRole("button", { name: "Send invite" }).click();
  await expectToast(page, /invalid/i, "error");
  await expect(d).toBeVisible();
  await d.getByRole("button", { name: "Cancel" }).click();

  const ivy = await invite("Ivy Invited", `ivy-${S.id}@e2e.test`);
  await expectToast(page, "Invite sent");
  save({ ivy });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Ivy Invited" })).toBeVisible();
  await expect(page.getByText("Active").first()).toBeVisible();
  await go("/partners");
  await expect(row(/Ivy Invited/)).toContainText("Active");
  await expect(page.getByRole("tab", { name: /^All/ })).toContainText("1");
});

test("partners: inviting an email that is already a partner says so", async () => {
  await go("/partners");
  await page.getByRole("button", { name: "Invite partner" }).click();
  const d = page.getByRole("dialog", { name: "Invite a partner" });
  await d.getByLabel("Name").fill("Ivy Again");
  await d.getByLabel("Email").fill(`ivy-${S.id}@e2e.test`);
  await d.getByRole("button", { name: "Send invite" }).click();
  // nothing is sent for an existing partner, so "Invite sent" would be wrong
  await expect(toast(page, /already/i)).toBeVisible();
  await expect(toast(page, "Invite sent")).toHaveCount(0);
});

test("partners: turn auto-approve off, an application waits for approval", async ({ browser }) => {
  await go("/settings/application");
  const sw = page.getByRole("switch", { name: "Auto-approve" });
  if ((await sw.getAttribute("aria-checked")) === "true") await sw.click();
  await page.getByRole("button", { name: "Save" }).first().click();
  await expectToast(page, "Saved");
  await page.reload();
  await expect(page.getByRole("switch", { name: "Auto-approve" })).toHaveAttribute("aria-checked", "false");

  // one application only: /apply allows 10 per hour per network and other testers share it
  const pc = await browser.newContext();
  const pp = await pc.newPage();
  await pp.goto(`/p/${S.slug}/apply`);
  await pp.getByLabel("Full name").fill("Ada Applicant");
  await pp.getByLabel("Email").fill(`ada-${S.id}@e2e.test`);
  await pp.getByLabel("Password", { exact: true }).fill("e2e-password-123");
  await pp.getByLabel("Website or main channel").fill("https://applicant.example");
  await pp.getByRole("checkbox").check();
  await pp.getByRole("button", { name: /^(Join and get my link|Send application)$/ }).click();
  const err = pp.locator('[data-sonner-toast][data-type="error"]');
  await Promise.race([
    pp.waitForURL(/\/portal/),
    err.waitFor().then(async () => {
      throw new Error(`apply failed: ${await err.textContent()}`);
    }),
  ]);
  await pc.storageState({ path: PARTNER_STATE });
  await pc.close();

  await go("/partners?status=pending");
  await expect(page.getByRole("tab", { name: /Needs approval/ })).toContainText("1");
  await expect(row(/Ada Applicant/)).toContainText("Pending");
  await go("");
  await page.getByRole("link", { name: /Review 1 application/ }).click();
  await page.waitForURL(/partners\?status=pending/);
  await expect(page.getByRole("tab", { name: /Needs approval/ })).toHaveAttribute("aria-selected", "true");
});

test("partners: approve from detail, reject from bulk toolbar", async () => {
  await go("/partners?status=pending");
  await row(/Ada Applicant/)
    .getByRole("link")
    .first()
    .click();
  await page.waitForURL(/\/partners\/prt_/);
  save({ ada: page.url().split("/partners/")[1] });
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expectToast(page, "Partner approved");
  await page.reload();
  await expect(page.getByText("Active").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve", exact: true })).toHaveCount(0);

  await go("/partners");
  await expect(page.getByRole("tab", { name: /Needs approval/ })).toContainText("0");

  await invite("Rex Rejected", `rex-${S.id}@e2e.test`);
  await go("/partners");
  await row(/Rex Rejected/)
    .getByRole("checkbox")
    .check();
  await bulk("Reject").click();
  await expectToast(page, "Reject: done");
  await page.reload();
  await expect(row(/Rex Rejected/)).toContainText("Rejected");
});

test("partners: pause, reactivate and ban from the detail page", async () => {
  const id = await invite("Paul Paused", `paul-${S.id}@e2e.test`);
  save({ paul: id });
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Pause" }).click();
  await expectToast(page, "Partner paused");
  await page.reload();
  await expect(page.getByText("Paused").first()).toBeVisible();
  await go("/partners?status=paused");
  await expect(page.getByRole("tab", { name: /Paused/ })).toContainText("1");
  await expect(row(/Paul Paused/)).toBeVisible();

  await go(`/partners/${id}`);
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Approve / reactivate" }).click();
  await expectToast(page, "Partner approved");
  await page.reload();
  await expect(page.getByText("Active").first()).toBeVisible();

  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Ban" }).click();
  await expectToast(page, "Partner banned");
  await page.reload();
  await expect(page.getByText("Banned").first()).toBeVisible();
});

test("partners: bulk pause and bulk ban from the list", async () => {
  const a = await invite("Bea Bulk", `bea-${S.id}@e2e.test`);
  await go("/partners");
  await row(/Bea Bulk/)
    .getByRole("checkbox")
    .check();
  await expect(page.getByRole("toolbar", { name: "Bulk actions" })).toContainText("1 selected");
  await bulk("Pause").click();
  await expectToast(page, "Pause: done");
  await page.reload();
  await expect(row(/Bea Bulk/)).toContainText("Paused");
  await row(/Bea Bulk/)
    .getByRole("checkbox")
    .check();
  await bulk("Ban").click(); // confirm() is accepted by watch()
  await expectToast(page, "Ban: done");
  await page.reload();
  await expect(row(/Bea Bulk/)).toContainText("Banned");
  save({ bea: a });
});

test("partners: tier, custom rate, payout, notes persist; bad inputs are rejected", async () => {
  // a second tier to move the partner into
  await go("/settings");
  await page.getByRole("button", { name: "Add tier" }).click();
  await page.locator("#g-n-new").fill("Gold");
  await page.locator("#g-r-new").fill("40");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expectToast(page, "Tier saved");

  await go(`/partners/${need("ivy")}`);
  await page.getByLabel("Custom rate (%)").fill("abc");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expectToast(page, /Some fields are invalid|Use a number/, "error");

  await page.reload();
  await page.getByLabel("PayPal email").fill("not-an-email@x");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expectToast(page, /invalid/i, "error");

  await page.reload();
  await pick(page.getByLabel("Tier"), "Gold (40%)");
  await page.getByLabel("Custom rate (%)").fill("20");
  await pick(page.getByLabel("Payout method"), "PayPal");
  await page.getByLabel("PayPal email").fill(`ivy-pay-${S.id}@e2e.test`);
  await page.getByLabel("Private notes").fill("Met at a conference. Prefers email.");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expectToast(page, "Saved");
  await page.reload();
  await expect(page.getByLabel("Tier")).toContainText("Gold (40%)");
  await expect(page.getByLabel("Custom rate (%)")).toHaveValue("20");
  await expect(page.getByLabel("Payout method")).toContainText("PayPal");
  await expect(page.getByLabel("PayPal email")).toHaveValue(`ivy-pay-${S.id}@e2e.test`);
  await expect(page.getByLabel("Private notes")).toHaveValue("Met at a conference. Prefers email.");
  await go("/partners");
  await expect(row(/Ivy Invited/)).toContainText("Gold");
});

test("partners: promo codes (validation, add, duplicate)", async () => {
  await go(`/partners/${need("ivy")}`);
  await page.getByLabel("Code", { exact: true }).fill("a!");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expectToast(page, /3-32 letters|invalid/i, "error");
  await page.getByLabel("Code", { exact: true }).fill(`ivy${S.id}`);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expectToast(page, "Coupon code added");
  await page.reload();
  await expect(page.getByText(`IVY${S.id.toUpperCase()}`)).toBeVisible();
  await expect(page.getByText("Tracking only")).toBeVisible();
  await page.getByLabel("Code", { exact: true }).fill(`IVY${S.id}`);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expectToast(page, "That code is already used in this program", "error");
  // the Stripe coupon path must fail cleanly without a Stripe key (no external call)
  await page.getByLabel("Code", { exact: true }).fill(`STRIPE${S.id}`);
  await page.getByLabel("Stripe coupon id").fill("coupon_e2e");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expectToast(page, /Connect Stripe/, "error");
});

test("partners: links card (off-domain rejected, sub-ID link created, QR)", async () => {
  await go(`/partners/${need("ivy")}`);
  await page.getByRole("button", { name: "New link" }).click();
  let d = page.getByRole("dialog", { name: "Create a link" });
  await d.getByLabel("Destination").fill("https://evil.example/");
  await d.getByRole("button", { name: "Create link" }).click();
  await expectToast(page, "Links must point to 127.0.0.1", "error");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "New link" }).click();
  d = page.getByRole("dialog", { name: "Create a link" });
  await d.getByLabel("Destination").fill("http://127.0.0.1:3000/pricing");
  await d.getByLabel("Sub-ID").fill("youtube");
  await d.getByLabel("Custom slug").fill(`ivy-yt-${S.id}`);
  await d.getByLabel("Label").fill("YouTube");
  await d.getByRole("button", { name: "Create link" }).click();
  await expectToast(page, "Link created");
  await page.reload();
  await expect(page.getByText(`/r/${S.slug}/l/ivy-yt-${S.id}`)).toBeVisible();
  await expect(page.getByText(/YouTube → http:\/\/127\.0\.0\.1:3000\/pricing · sub youtube/)).toBeVisible();
  const key = (await page
    .locator("div.font-mono", { hasText: `/r/${S.slug}/l/` })
    .first()
    .textContent())!
    .split("/l/")[1]!
    .trim();
  save({ ivyKey: key });
  await page.getByRole("button", { name: "Show QR code" }).nth(1).click();
  const qr = page.getByRole("dialog", { name: "QR code" });
  await expect(qr.getByRole("img", { name: "QR code for the link" })).toBeVisible();
  const res = await page.request.get(
    (await qr.getByRole("img", { name: "QR code for the link" }).getAttribute("src"))!,
  );
  expect(res.status()).toBe(200);
});

test("partners: list search, tabs and CSV export", async () => {
  await go("/partners");
  await page.getByLabel("Search name, email or code").fill("Ivy");
  await page.waitForURL(/q=Ivy/);
  await expect(page.getByRole("row")).toHaveCount(2); // header + Ivy
  await page.getByLabel("Search name, email or code").fill("zzz-nobody");
  await expect(page.getByText("No results for these filters")).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(row(/Ivy Invited/)).toBeVisible();
  await page.getByRole("tab", { name: /^Active/ }).click();
  await page.waitForURL(/status=approved/);
  await expect(row(/Rex Rejected/)).toHaveCount(0);
  const csv = await download(() => page.getByRole("link", { name: "Export" }).click());
  expect(csv.name).toMatch(/^partners-.*\.csv$/);
  const rows = parseCsv(csv.text);
  // exported from the Active tab: only active partners are expected
  expect(rows.length).toBeGreaterThan(0);
  expect(rows.every((r) => r.status === "approved")).toBe(true);
});

/* ================================================================== sales, customers, commissions */

test("sales via signed Stripe webhooks use the partner's custom rate", async ({ request }) => {
  const key = need("ivyKey");
  const a = await referredSale(request, {
    slug: S.slug,
    key,
    webhookUrl: S.webhookUrl,
    amount: 20000,
    description: "Pro plan A",
  });
  await referredSale(request, {
    slug: S.slug,
    key,
    webhookUrl: S.webhookUrl,
    amount: 10000,
    description: "Pro plan B",
  });
  save({ buyerA: a.email });
  await go("/commissions");
  await expect(row(/Pro plan A/)).toContainText("Pending");
  await expect(row(/Pro plan A/)).toContainText("$200.00");
  await expect(row(/Pro plan A/)).toContainText("$40.00"); // 20% override
  await expect(row(/Pro plan B/)).toContainText("$20.00");
  await expect(page.getByRole("tab", { name: /^Pending/ })).toContainText("2");
  await go(`/partners/${need("ivy")}`);
  await expect(page.getByText("$300").first()).toBeVisible(); // revenue stat
});

test("customers: list, tabs, search, empty filter and export", async () => {
  await go("/customers");
  await expect(page.getByRole("tab", { name: /^All/ })).toContainText("2");
  await expect(page.getByRole("tab", { name: /Paying/ })).toContainText("2");
  await page.getByRole("tab", { name: /Trials/ }).click();
  await page.waitForURL(/status=trialing/);
  await expect(page.getByText("No results for these filters")).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await page.getByLabel("Search customer or partner").fill(need("buyerA"));
  await page.waitForURL(/q=/);
  await expect(page.getByRole("row")).toHaveCount(2);
  await expect(row(new RegExp(need("buyerA")))).toContainText("Ivy Invited");
  await expect(row(new RegExp(need("buyerA")))).toContainText("$200.00");
  await page.getByRole("button", { name: /Signed up/ }).click();
  await page.waitForURL(/sort=createdAt/);
  const csv = await download(() => page.getByRole("link", { name: "Export" }).click());
  const rows = parseCsv(csv.text);
  // exported while searching one customer: only that customer is expected
  expect(rows.map((r) => r.email)).toEqual([need("buyerA")]);
});

test("commissions: manual add (validation, bonus, negative adjustment)", async () => {
  await go("/commissions");
  await page.getByRole("button", { name: "Add commission" }).click();
  const d = page.getByRole("dialog", { name: "Add a commission" });
  await pick(d.getByLabel("Partner"), "Ivy Invited");
  await d.getByLabel("Amount").fill("abc");
  await d.getByLabel("Reason").fill("Launch bonus");
  await d.getByRole("button", { name: "Add commission" }).click();
  expect(await d.getByLabel("Amount").evaluate((el: HTMLInputElement) => el.validity.valid)).toBe(false);
  await d.getByLabel("Amount").fill("25");
  await d.getByRole("button", { name: "Add commission" }).click();
  await expectToast(page, "Commission added");
  await expect(d).toBeHidden();

  await page.getByRole("button", { name: "Add commission" }).click();
  const d2 = page.getByRole("dialog", { name: "Add a commission" });
  await pick(d2.getByLabel("Partner"), "Ivy Invited");
  await d2.getByLabel("Amount").fill("-5");
  await d2.getByLabel("Reason").fill("Correction");
  await d2.getByRole("button", { name: "Add commission" }).click();
  await expect(d2).toBeHidden(); // the first toast may still be on screen
  await page.reload();
  await expect(row(/Launch bonus/)).toContainText("Approved");
  await expect(row(/Launch bonus/)).toContainText("$25.00");
  await expect(row(/Correction/)).toContainText("−$5.00");
  await expect(page.getByRole("tab", { name: /^Approved/ })).toContainText("2");
  // banned/paused partners are not offered for manual commissions
  await page.getByRole("button", { name: "Add commission" }).click();
  await page.getByRole("dialog").getByLabel("Partner").click();
  await expect(page.getByRole("option", { name: "Ivy Invited" })).toBeVisible();
  await expect(page.getByRole("option", { name: "Paul Paused" })).toHaveCount(0);
});

test("commissions: hold and release a pending sale", async () => {
  await go("/commissions");
  await row(/Pro plan A/)
    .getByRole("checkbox")
    .check();
  await bulk("Hold").click();
  await expectToast(page, "Hold: done");
  await page.reload();
  await expect(row(/Pro plan A/)).toContainText("Held");
  await expect(page.getByRole("tab", { name: /^Held/ })).toContainText("1");
  await go("");
  await page.getByRole("link", { name: /Held commissions/ }).click();
  await page.waitForURL(/commissions\?status=held/);
  await row(/Pro plan A/)
    .getByRole("checkbox")
    .check();
  await bulk("Release").click();
  await expectToast(page, "Release: done");
  await page.reload();
  await expect(page.getByText("No results for these filters")).toBeVisible();
  await go("/commissions");
  await expect(row(/Pro plan A/)).toContainText("Pending"); // still inside the refund window
});

test("commissions: releasing a held manual bonus returns it to Approved", async () => {
  await go("/commissions");
  await row(/Launch bonus/)
    .getByRole("checkbox")
    .check();
  await bulk("Hold").click();
  await expectToast(page, "Hold: done");
  await page.reload();
  await expect(row(/Launch bonus/)).toContainText("Held");
  await row(/Launch bonus/)
    .getByRole("checkbox")
    .check();
  await bulk("Release").click();
  await expectToast(page, "Release: done");
  await page.reload();
  // it was Approved (no refund window) before the hold
  await expect(row(/Launch bonus/)).toContainText("Approved");
});

test("commissions: approve early and reverse", async () => {
  await go("/commissions");
  await row(/Pro plan A/)
    .getByRole("checkbox")
    .check();
  await bulk("Approve now").click();
  await expectToast(page, "Approve now: done");
  await page.reload();
  await expect(row(/Pro plan A/)).toContainText("Approved");
  await row(/Pro plan B/)
    .getByRole("checkbox")
    .check();
  await bulk("Reverse").click();
  await expectToast(page, "Reverse: done");
  await page.reload();
  await expect(row(/Pro plan B/)).toContainText("Reversed");
  await expect(page.getByRole("tab", { name: /^Reversed/ })).toContainText("1");
  // select-all + clear selection
  await page.getByRole("checkbox", { name: "Select all rows" }).check();
  await expect(page.getByRole("toolbar", { name: "Bulk actions" })).toContainText(/\d+ selected/);
  await page.getByRole("button", { name: "Clear selection" }).click();
  await expect(page.getByRole("toolbar", { name: "Bulk actions" })).toHaveCount(0);
});

test("commissions: tabs, search, sort, board view and numbers", async () => {
  await go("/commissions");
  await page.getByLabel("Search partner or description").fill("Pro plan");
  await page.waitForURL(/q=Pro/);
  await expect(page.getByRole("row")).toHaveCount(3);
  await page.getByLabel("Search partner or description").fill("no-such-thing");
  await expect(page.getByText("No results for these filters")).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await page.getByRole("button", { name: "Commission", exact: true }).click();
  await page.waitForURL(/sort=amount(:|%3A)desc/);
  await expect(page.getByRole("row").nth(1)).toContainText("$40.00");
  await page.getByRole("tab", { name: /^Paid/ }).click();
  await page.waitForURL(/status=paid/);
  await expect(page.getByText("No results for these filters")).toBeVisible();

  await page.getByRole("link", { name: "Board", exact: true }).click();
  await page.waitForURL(/view=board/);
  const col = (l: string) =>
    page.locator("section", { has: page.getByRole("heading", { name: l, exact: true }) });
  // Approved: Pro plan A $40 + Launch bonus $25 − Correction $5 = $60
  await expect(col("Approved").locator("header")).toContainText("3");
  await expect(col("Approved").locator("header")).toContainText("$60.00");
  await expect(col("Held").locator("header")).toContainText("$0.00");
  await expect(col("Held")).toContainText("Waiting for your review");
  await page.getByRole("link", { name: "List", exact: true }).click();
  await page.waitForURL((u) => !u.search.includes("view=board"));
  await go("");
  await expect(page.getByText("Ready to pay", { exact: true }).first().locator("..")).toContainText("$60.00");
});

test("commissions: CSV export respects the current tab", async () => {
  await go("/commissions?status=reversed");
  const csv = await download(() => page.getByRole("link", { name: "Export" }).click());
  expect(csv.name).toMatch(/^commissions-.*\.csv$/);
  const rows = parseCsv(csv.text);
  expect(rows.length).toBe(1);
  expect(rows[0]!.status).toBe("reversed");
  expect(rows[0]!.commission).toBe("20.00");
});

/* ================================================================== campaigns */

test("campaigns: describe box validation and an impossible boost", async () => {
  await go("/campaigns");
  const box = page.getByLabel("Describe a campaign");
  await box.fill("hello there friends");
  await page.getByRole("button", { name: "Draft it" }).click();
  await expectToast(page, /Couldn't turn that into a campaign/, "error");
  await box.fill("100x commissions this week");
  await page.getByRole("button", { name: "Draft it" }).click();
  // the AI path caps boosts at 5x; rules mode refuses a 100x boost with the reason
  await expectToast(page, /Boosts can't go above 5x/, "error");
  await expect(page.getByText("100x commissions")).toHaveCount(0);
});

test("campaigns: boost, bounty and contest via the describe box, end one", async () => {
  await go("/campaigns");
  const box = page.getByLabel("Describe a campaign");
  for (const [example, kind, desc] of [
    ["Double commissions for annual plans this month", "boost", "2x commissions on annual plans"],
    ["Pay $50 per YouTube review", "bounty", "$50.00 per approved post or video"],
    ["Contest this month: top 3 by revenue win $500, $250 and $100", "contest", "Top 3 by revenue"],
  ] as const) {
    await page.getByRole("button", { name: example }).click();
    await expect(box).toHaveValue(example);
    await page.getByRole("button", { name: "Draft it" }).click();
    await expect(page.getByText(kind, { exact: true })).toBeVisible();
    await expect(page.locator("form").getByText(desc).first()).toBeVisible();
    await page.getByRole("button", { name: /Launch and notify partners/ }).click();
    await expectToast(page, "Campaign launched and partners notified");
    await expect(box).toHaveValue("");
  }
  await page.reload();
  await expect(page.getByText("3 live now")).toBeVisible();
  await expect(page.locator("li", { hasText: "2x commissions on annual plans" })).toContainText("Active");
  await expect(page.locator("li", { hasText: "Top 3 by revenue" })).toContainText(
    "$500.00, $250.00, $100.00",
  );
  await expect(page.locator("li", { hasText: "$50.00 per approved post or video" })).toContainText("Active");

  // discard keeps nothing
  await box.fill("$5 per signup for 14 days");
  await page.getByRole("button", { name: "Draft it" }).click();
  await expect(page.getByText("$5.00 per signup")).toBeVisible();
  await page.getByRole("button", { name: "Discard" }).click();
  await expect(page.getByText("$5.00 per signup")).toHaveCount(0);

  const boost = page.locator("li", { hasText: "2x commissions on annual plans" });
  await boost.getByRole("button", { name: "End now" }).click();
  await expectToast(page, "Campaign ended");
  await page.reload();
  await expect(page.getByText("2 live now")).toBeVisible();
  await expect(page.locator("li", { hasText: "2x commissions on annual plans" })).toContainText("Ended");

  // the launch announcement reached partners' messages
  await go("/messages?view=announcements");
  await expect(page.getByText("New: Content bounty")).toBeVisible();
});

test("campaigns: bounty submission from the portal is approved and pays", async ({ browser }) => {
  const pc = await browser.newContext({ storageState: PARTNER_STATE });
  const pp = await pc.newPage();
  await pp.goto(`/p/${S.slug}/portal/content`);
  await pp.getByLabel("Post URL").fill(`https://video.example/review-${S.id}`);
  await pp.getByRole("button", { name: "Submit post" }).click();
  await expect(pp.locator("[data-sonner-toast]", { hasText: "Submitted for review" })).toBeVisible();
  await pc.close();

  await go("/campaigns");
  const sub = page.locator("li", { hasText: `review-${S.id}` });
  await expect(sub).toContainText("Ada Applicant");
  await expect(sub).toContainText("$50.00");
  await sub.getByRole("button", { name: "Approve" }).click();
  await expectToast(page, "Bounty approved");
  await page.reload();
  await expect(page.locator("li", { hasText: `review-${S.id}` })).toContainText("Approved");
  await go("/commissions?q=review");
  await expect(row(/Content bounty/)).toContainText("$50.00");
});

/* ================================================================== content kit */

test("content kit: regenerate from site, add, edit, delete, resources", async () => {
  await go("/content");
  await expect(page.getByText("Templates for now.")).toBeVisible();
  await page.getByRole("button", { name: "Regenerate from my site" }).click();
  await expectToast(page, "Content kit refreshed");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Swipe copy" })).toBeVisible();
  await expect(page.getByText("One-liner")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Banners" })).toBeVisible();

  await page.getByRole("button", { name: "Add your own" }).click();
  let d = page.getByRole("dialog", { name: "Add content" });
  await pick(d.getByLabel("Type"), "Social posts");
  await d.getByLabel("Title").fill(`Reddit post ${S.id}`);
  await d.getByLabel("Text").fill("We switched last month. {{link}}");
  await d.getByRole("button", { name: "Save" }).click();
  await expectToast(page, "Saved");
  await page.reload();
  const card = () =>
    page
      .locator("div", { has: page.getByRole("heading", { name: `Reddit post ${S.id}` }) })
      .filter({ has: page.getByRole("button", { name: "Edit" }) })
      .last();
  await expect(page.getByText("We switched last month. {{link}}")).toBeVisible();

  await card().getByRole("button", { name: "Edit" }).first().click();
  d = page.getByRole("dialog", { name: "Edit content" });
  await d.getByLabel("Text").fill("Edited body {{link}}");
  await d.getByRole("button", { name: "Save" }).click();
  await expectToast(page, "Saved");
  await page.reload();
  await expect(page.getByText("Edited body {{link}}")).toBeVisible();

  // regenerating keeps assets the founder wrote
  await page.getByRole("button", { name: "Regenerate from my site" }).click();
  await expectToast(page, "Content kit refreshed");
  await page.reload();
  await expect(page.getByText("Edited body {{link}}")).toBeVisible();

  await card().getByRole("button", { name: "Delete" }).first().click();
  await expectToast(page, "Deleted");
  await page.reload();
  await expect(page.getByText(`Reddit post ${S.id}`)).toHaveCount(0);

  await page.getByRole("button", { name: "Add resource" }).click();
  const r = page.getByRole("dialog", { name: "Add a resource" });
  await r.getByLabel("Title").fill("Press kit");
  // neither a file nor a link
  await r.getByRole("button", { name: "Add" }).click();
  await expect(r.getByText("Choose a file or paste a link.")).toBeVisible();
  await r.getByLabel("Or paste a link").fill("not a url");
  await r.getByRole("button", { name: "Add" }).click();
  expect(await r.getByLabel("Or paste a link").evaluate((el: HTMLInputElement) => el.validity.valid)).toBe(
    false,
  );
  await r.getByLabel("Or paste a link").fill("https://press.example/kit");
  await r.getByRole("button", { name: "Add" }).click();
  await expectToast(page, /Added|Resource added/);
  await page.reload();
  await expect(page.getByRole("link", { name: "Press kit" })).toBeVisible();
  await page.getByRole("button", { name: "Remove" }).click();
  await expectToast(page, "Removed");
  await page.reload();
  await expect(page.getByRole("link", { name: "Press kit" })).toHaveCount(0);

  // upload a file; partners download it from /api/resources/<id>
  await page.getByRole("button", { name: "Add resource" }).click();
  const u = page.getByRole("dialog", { name: "Add a resource" });
  await u.getByLabel("Title").fill(`Logo ${S.id}`);
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
    "base64",
  );
  await u.getByLabel("Upload a file").setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: png });
  await u.getByRole("button", { name: "Add" }).click();
  await expectToast(page, /Added|Resource added/);
  await page.reload();
  const file = page.getByRole("link", { name: `Logo ${S.id}` });
  const href = await file.getAttribute("href");
  expect(href).toMatch(/\/api\/resources\/res_/);
  const got = await page.request.get(href!);
  expect(got.status()).toBe(200);
  expect(got.headers()["content-type"]).toBe("image/png");
  expect((await got.body()).equals(png)).toBe(true);
  // a type partners can't safely open is refused
  await page.getByRole("button", { name: "Add resource" }).click();
  const bad = page.getByRole("dialog", { name: "Add a resource" });
  await bad.getByLabel("Title").fill("Script");
  await bad.getByLabel("Upload a file").setInputFiles({
    name: "x.html",
    mimeType: "text/html",
    buffer: Buffer.from("<script>alert(1)</script>"),
  });
  await bad.getByRole("button", { name: "Add" }).click();
  await expect(page.getByText(/Upload an image, PDF/)).toBeVisible();
  await page.keyboard.press("Escape");
  await file.locator("xpath=ancestor::li").getByRole("button", { name: "Remove" }).click();
  await expectToast(page, "Removed");
  // banner endpoint renders
  const src = await page.locator('img[src^="/api/banner/"]').first().getAttribute("src");
  expect((await page.request.get(src!)).status()).toBe(200);
});

/* ================================================================== messages */

test("messages: announcement goes out and is listed", async () => {
  await go("/messages?view=announcements");
  await page.getByLabel("Subject").fill(`Launch week ${S.id}`);
  await page.getByRole("textbox", { name: "Message" }).fill("New content kit is live.");
  await page.getByRole("button", { name: "Announce" }).click();
  await expectToast(page, "Announcement sent");
  await page.reload();
  await expect(page.getByText(`Launch week ${S.id}`)).toBeVisible();
});

test("messages: partner writes, founder sees unread, opens and replies", async ({ browser }) => {
  const pc = await browser.newContext({ storageState: PARTNER_STATE });
  const pp = await pc.newPage();
  await pp.goto(`/p/${S.slug}/portal/messages`);
  await pp.getByLabel("Message").fill(`Question from Ada ${S.id}`);
  await pp.getByRole("button", { name: "Send" }).click();
  await expect(pp.locator("[data-sonner-toast]").first()).toBeVisible();
  await pc.close();

  await go("/messages");
  await expect(page.getByText("1 unread")).toBeVisible();
  await page.getByRole("button", { name: /Unread/ }).click();
  const convo = page.getByRole("link", { name: /Ada Applicant/ });
  await expect(convo).toContainText(`Question from Ada ${S.id}`);
  await expect(convo).toContainText("Unread");
  await page.getByRole("button", { name: /Needs reply/ }).click();
  await expect(convo).toBeVisible();
  await convo.click();
  await page.waitForURL(/partner=prt_/);
  await expect(page.getByText(`Question from Ada ${S.id}`).last()).toBeVisible();
  await page.getByRole("textbox", { name: "Message" }).fill("Thanks, here is the answer.");
  await page.getByRole("button", { name: "Send" }).click();
  await expectToast(page, "Message sent");
  await page.reload();
  await expect(page.getByText("Thanks, here is the answer.").last()).toBeVisible();
  await expect(page.getByText("1 unread")).toHaveCount(0);
  await page.getByRole("button", { name: /Needs reply/ }).click();
  await expect(page.getByRole("link", { name: /Ada Applicant/ })).toHaveCount(0);
});

test("messages: the referral link shown next to a conversation works", async () => {
  await go(`/messages?partner=${need("ada")}`);
  const panel = page.getByRole("complementary", { name: "About this partner" });
  const link = (await panel.locator("span[title*='/r/']").first().getAttribute("title"))!;
  expect(link).toMatch(new RegExp(`^https?://.+/r/${S.slug}/`));
  const res = await page.request.get(link.replace(/^.*?\/r\//, "/r/"), { maxRedirects: 0 });
  expect(res.status()).toBe(302);
});

test("messages: partner Message button opens the conversation; new message picker", async () => {
  await go(`/partners/${need("ivy")}`);
  await page.getByRole("main").getByRole("link", { name: "Message" }).click();
  await page.waitForURL(/messages\?partner=/);
  await expect(page.getByRole("textbox", { name: "Message" })).toHaveAttribute(
    "placeholder",
    "Message Ivy Invited",
  );
  await page.getByRole("button", { name: "New message" }).click();
  await page.getByLabel("Find a partner").fill("zzz");
  await expect(page.getByText("No active partner matches")).toBeVisible();
  await page.getByLabel("Find a partner").fill("Ada");
  await page.getByRole("link", { name: "Ada Applicant" }).click();
  await page.waitForURL(new RegExp(`partner=${need("ada")}`));
});

/* ================================================================== recruiter */

test("recruiter: add someone, draft invite, send, dismiss, AI-only actions", async () => {
  await go("/recruiter");
  await page.getByRole("button", { name: "Add someone" }).click();
  let d = page.getByRole("dialog", { name: "Add a prospect" });
  await d.getByLabel("Name").fill("Bad Prospect");
  await d.getByLabel("Email").fill("a@b");
  await d.getByRole("button", { name: "Add" }).click();
  await expectToast(page, /invalid/i, "error");
  await d.getByLabel("Email").fill(`cara-${S.id}@e2e.test`);
  await d.getByLabel("Name").fill("Cara Creator");
  await d.getByLabel("Website or channel").fill("https://youtube.example/cara");
  await d.getByLabel("Why they fit").fill("Reviews analytics tools every week.");
  await d.getByRole("button", { name: "Add" }).click();
  await expectToast(page, /Added|Prospect added/);
  await expect(d).toBeHidden();
  for (const n of ["Dan Dismiss", "Pat Personal"]) {
    await page.getByRole("button", { name: "Add someone" }).click();
    d = page.getByRole("dialog", { name: "Add a prospect" });
    await d.getByLabel("Name").fill(n);
    await d.getByLabel("Email").fill(`${n.split(" ")[0]!.toLowerCase()}-${S.id}@e2e.test`);
    await d.getByRole("button", { name: "Add" }).click();
    await expectToast(page, /Prospect added/);
    // the previous add's toast can still be showing; the dialog closes only when this add has saved
    await expect(d).toBeHidden();
  }
  await page.reload();
  const cara = page.locator("li", { hasText: "Cara Creator" });
  await expect(cara).toContainText("fit 60");
  await expect(cara).toContainText("Reviews analytics tools every week.");
  await expect(page.getByRole("tab", { name: /To invite/ })).toContainText("3");

  await cara.getByRole("button", { name: "Invite" }).click();
  const inv = page.getByRole("dialog", { name: "Invite Cara Creator" });
  await expect(inv.getByLabel("Subject")).not.toHaveValue("");
  await expect(inv.getByLabel("Message")).toHaveValue(/QA Co/);
  await inv.getByLabel("Subject").fill(`Join us ${S.id}`);
  await inv.getByRole("button", { name: "Send invite" }).click();
  await expectToast(page, /Invite sent|invites sent|1/);
  await page.reload();
  await page.getByRole("tab", { name: /Invited/ }).click();
  await expect(page.locator("li", { hasText: "Cara Creator" })).toContainText("Invited");
  await expect(page.getByRole("tab", { name: /Invited/ })).toContainText("1");

  await page.getByRole("tab", { name: /To invite/ }).click();
  await page.locator("li", { hasText: "Dan Dismiss" }).getByRole("button", { name: "Dismiss" }).click();
  await expectToast(page, "Dismissed");
  await page.reload();
  await expect(page.locator("li", { hasText: "Dan Dismiss" })).toHaveCount(0);

  await page.getByRole("checkbox", { name: "Select Pat Personal" }).check();
  await page.getByRole("button", { name: "Personalise" }).click();
  await expectToast(page, /needs an AI provider/, "error");
  await expect(page.getByText(/Searching the web for creators needs an Anthropic API key/)).toBeVisible();

  await page.getByRole("button", { name: "Find customers to invite" }).click();
  await expectToast(page, /customers added/);
  await page.reload();
  // paying referred customers (the two buyers) may be ranked; nothing else must break
  await expect(page.getByRole("tab", { name: /To invite/ })).toBeVisible();
});

/* ================================================================== fraud */

async function defaultKey() {
  return (await page
    .locator("div.font-mono", { hasText: `/r/${S.slug}/l/` })
    .first()
    .textContent())!
    .split("/l/")[1]!
    .trim();
}

test("fraud: self-referrals are flagged; looks fine releases only the fraud hold; confirm bans", async ({
  request,
}) => {
  const sam = await invite("Sam Self", `sam-${S.id}@e2e.test`);
  const samKey = await defaultKey();
  const tess = await invite("Tess Self", `tess-${S.id}@e2e.test`);
  const tessKey = await defaultKey();
  save({ sam, tess });

  // Sam has a commission the founder held by hand, unrelated to fraud
  await go("/commissions");
  await page.getByRole("button", { name: "Add commission" }).click();
  const d = page.getByRole("dialog", { name: "Add a commission" });
  await pick(d.getByLabel("Partner"), "Sam Self");
  await d.getByLabel("Amount").fill("15");
  await d.getByLabel("Reason").fill(`Manual review ${S.id}`);
  await d.getByRole("button", { name: "Add commission" }).click();
  await expectToast(page, "Commission added");
  await page.reload();
  await row(new RegExp(`Manual review ${S.id}`))
    .getByRole("checkbox")
    .check();
  await bulk("Hold").click();
  await expectToast(page, "Hold: done");

  // each partner buys through their own link with their own email
  for (const [key, email, what] of [
    [samKey, `sam-${S.id}@e2e.test`, "Self plan S"],
    [tessKey, `tess-${S.id}@e2e.test`, "Self plan T"],
  ] as const)
    await referredSale(request, {
      slug: S.slug,
      key,
      webhookUrl: S.webhookUrl,
      amount: 10000,
      email,
      description: what,
    });
  await go("/commissions?status=held");
  await expect(row(/Self plan S/)).toContainText("Held");
  await expect(row(/Self plan T/)).toContainText("Held");

  await go("/fraud");
  const flag = (n: string) => page.locator("li", { hasText: "Self-referral" }).filter({ hasText: n });
  await expect(flag("Sam Self")).toContainText("95");
  await expect(flag("Tess Self")).toBeVisible();
  await expect(page.getByRole("button", { name: "Looks fine" })).toHaveCount(2);
  await expect(page.locator("main")).toContainText(/Open flags\s*2/);

  await flag("Sam Self").getByRole("button", { name: "Looks fine" }).click();
  await expectToast(page, "Flag dismissed and commissions released");
  await page.reload();
  await expect(flag("Sam Self")).toContainText(/dismissed/i);
  await expect(flag("Sam Self").getByRole("button", { name: "Looks fine" })).toHaveCount(0);
  await expect(page.locator("main")).toContainText(/Open flags\s*1/);

  await flag("Tess Self").getByRole("button", { name: "Confirm fraud and ban" }).click();
  await expectToast(page, "Partner banned and commissions held");
  await page.reload();
  await expect(flag("Tess Self")).toContainText(/confirmed/i);
  await go(`/partners/${tess}`);
  await expect(page.getByText("Banned").first()).toBeVisible();
  await go("/commissions");
  await expect(row(/Self plan T/)).toContainText("Held");
  await expect(row(/Self plan S/)).toContainText("Pending");
  // the hand-made hold was not a fraud hold: dismissing the flag must not release it
  await expect(row(new RegExp(`Manual review ${S.id}`))).toContainText("Held");
});

test("fraud: re-run checks works when partners have a PayPal email (shared account is flagged)", async () => {
  const shared = `shared-${S.id}@e2e.test`;
  for (const n of ["Dana Dup", "Dave Dup"]) {
    await invite(n, `${n.split(" ")[0]!.toLowerCase()}-${S.id}@e2e.test`);
    await page.getByLabel("PayPal email").fill(shared);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expectToast(page, "Saved");
  }
  await go("/fraud");
  await page.getByRole("button", { name: "Re-run checks" }).click();
  await expect(page.locator("[data-sonner-toast]").first()).toBeVisible();
  // the error toast must never show raw SQL
  await expect(page.locator("[data-sonner-toast]").first()).not.toContainText("Failed query");
  await expectToast(page, "Fraud checks re-run");
  await page.reload();
  const flag = (n: string) => page.locator("li", { hasText: "Payout account shared" }).filter({ hasText: n });
  await expect(flag("Dana Dup")).toBeVisible();
  await expect(flag("Dave Dup")).toBeVisible();
});

/* ================================================================== autopilot */

const autopilotSwitch = () => page.getByRole("switch", { name: "Weekly Autopilot" });
async function autopilotOn() {
  await go("/autopilot");
  if ((await autopilotSwitch().getAttribute("aria-checked")) !== "true") {
    await autopilotSwitch().click();
    await expectToast(page, "Autopilot updated");
    await page.reload();
  }
  await expect(autopilotSwitch()).toHaveAttribute("aria-checked", "true");
}

test("autopilot: settings toggle and mode persist", async () => {
  await autopilotOn();
  await expect(page.getByText("Rules only")).toBeVisible();
  await autopilotSwitch().click();
  await expectToast(page, "Autopilot updated");
  await page.reload();
  await expect(autopilotSwitch()).toHaveAttribute("aria-checked", "false");

  // running while it is switched off must say so, not claim it ran
  await page.getByRole("button", { name: "Run now" }).click();
  await expect(page.locator("[data-sonner-toast]").first()).toBeVisible();
  expect(await page.locator("[data-sonner-toast]").first().textContent()).not.toContain("Autopilot ran");

  await autopilotOn();
  await page.getByRole("radio", { name: /Act and tell me after/ }).click();
  await expectToast(page, "Autopilot updated");
  await page.reload();
  await expect(page.getByRole("radio", { name: /Act and tell me after/ })).toBeChecked();
  await page.getByRole("radio", { name: /Suggest changes for me to approve/ }).click();
  await expectToast(page, "Autopilot updated");
  await page.reload();
  await expect(page.getByRole("radio", { name: /Suggest changes/ })).toBeChecked();
  await expect(autopilotSwitch()).toHaveAttribute("aria-checked", "true");
});

test("autopilot: switching it on then picking a mode keeps it on", async () => {
  await autopilotOn();
  await autopilotSwitch().click(); // off
  await expectToast(page, "Autopilot updated");
  await page.reload();
  await autopilotSwitch().click(); // on again, no reload
  await expectToast(page, "Autopilot updated");
  await page.getByRole("radio", { name: /Act and tell me after/ }).click();
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(2);
  await page.reload();
  await expect(page.getByRole("radio", { name: /Act and tell me after/ })).toBeChecked();
  await expect(autopilotSwitch()).toHaveAttribute("aria-checked", "true");
  // back to suggest mode for the next test
  await autopilotOn();
  await page.getByRole("radio", { name: /Suggest changes for me to approve/ }).click();
  await expectToast(page, "Autopilot updated");
});

test("autopilot: run now, do it, undo, dismiss; dashboard links to suggestions", async () => {
  await autopilotOn();
  await expect(page.getByRole("radio", { name: /Suggest changes/ })).toBeChecked();
  await page.getByRole("button", { name: "Run now" }).click();
  await expectToast(page, /Autopilot ran: [1-9]\d* new suggestions/);
  await page.reload();
  // which suggestions appear depends on the data (idle needs 30-day-old partners); use what is there
  const items = page.locator("li").filter({ has: page.getByRole("button", { name: "Do it" }) });
  await expect(items.first()).toBeVisible();
  const titles = await items.locator("div.font-medium").allTextContents();
  const first = titles[0]!;
  const second = titles[1] ?? null;

  await go("");
  const link = page.getByRole("link", { name: first }).first();
  await expect(link).toBeVisible();
  await link.click();
  await page.waitForURL(/\/autopilot#act_/);

  await go("/autopilot");
  if (second) {
    await page.locator("li", { hasText: second }).getByRole("button", { name: "Dismiss" }).click();
    await expectToast(page, "Dismissed");
  }
  await page.locator("li", { hasText: first }).getByRole("button", { name: "Do it" }).click();
  await expectToast(page, "Done. You can undo it from the log.");
  await page.reload();
  const log = page.locator("li", { hasText: first }).last();
  await expect(log).toContainText(/applied/i);
  if (second) await expect(page.locator("li", { hasText: second }).last()).toContainText(/dismissed/i);
  await log.getByRole("button", { name: "Undo" }).click();
  await expectToast(page, "Undone");
  await page.reload();
  await expect(page.locator("li", { hasText: first }).last()).toContainText(/undone/i);

  // a second run in the same week does not repeat the same suggestions
  await page.getByRole("button", { name: "Run now" }).click();
  await expectToast(page, "Autopilot ran: 0 new suggestions");
});
/* ================================================================== analytics */

test("analytics: range buttons, export and report subscription", async () => {
  await go("/analytics");
  const range = page.getByRole("group", { name: "Date range" });
  await expect(range.getByRole("link", { name: "30d" })).toHaveAttribute("aria-current", "true");
  for (const [l, d] of [
    ["7d", "7"],
    ["90d", "90"],
    ["12m", "365"],
    ["30d", "30"],
  ] as const) {
    await range.getByRole("link", { name: l }).click();
    await page.waitForURL(new RegExp(`days=${d}$`));
    await expect(range.getByRole("link", { name: l })).toHaveAttribute("aria-current", "true");
    await expect(
      page.getByRole("img", { name: new RegExp(`over the last ${d} days`) }).first(),
    ).toBeAttached();
  }
  const csv = await download(() => page.getByRole("link", { name: "Export" }).click());
  expect(csv.name).toMatch(/^analytics-.*\.csv$/);
  const rows = parseCsv(csv.text);
  expect(rows.length).toBeGreaterThanOrEqual(28);
  const revenue = rows.reduce((a, r) => a + Number(r.revenue || 0), 0);
  expect(revenue).toBeCloseTo(need<number>("revenue") / 100, 2); // every referred sale in this file was today
  await page.goto(`${S.base}/analytics?days=-5`);
  await expect(page.getByRole("heading", { name: "Analytics" })).toBeVisible();

  await pick(page.getByLabel("Frequency"), "Monthly");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.locator("[data-sonner-toast]").first()).toHaveAttribute("data-type", "success");
});

/* ================================================================== Ask AI */

test("Ask AI in rules mode answers from the ledger", async () => {
  await go("/assistant");
  await expect(page.getByText("Rules mode: matched to the closest report")).toBeVisible();
  await page.getByLabel("Question").fill("x");
  await page.getByRole("main").getByRole("button", { name: "Ask" }).click();
  await expectToast(page, /invalid/i, "error");
  await page.getByRole("button", { name: "How much do we owe partners right now?" }).click();
  await expect(page.getByText("Reading your ledger…")).toHaveCount(0, { timeout: 20_000 });
  const answer = page.locator("ol > li").last();
  await expect(answer).toContainText("report");
  await expect(answer).toContainText("$");

  await go("");
  await page.getByRole("link", { name: "Who are my top partners this quarter?" }).click();
  await page.waitForURL(/assistant\?q=/);
  await expect(page.locator("ol > li")).toHaveCount(1);
  await expect(page.locator("ol > li").first()).toContainText(/Ivy Invited|Ada Applicant/);
  await go("");
  await page.getByPlaceholder("Ask anything…").fill("Any suspicious activity this week?");
  await page.locator('button[type="submit"][aria-label="Ask"]').click();
  await page.waitForURL(/assistant\?q=Any/);
  await expect(page.locator("ol > li")).toHaveCount(1);
});

/* ================================================================== command palette */

test("command palette: Cmd+K search partner, jump to page, actions", async () => {
  await go("");
  await page.keyboard.press("ControlOrMeta+k");
  const pal = page.getByRole("dialog", { name: "Command palette" });
  await expect(pal).toBeVisible();
  await pal.getByRole("combobox").fill("Ivy");
  await expect(pal.getByRole("option", { name: /Ivy Invited/ })).toBeVisible();
  await pal.getByRole("option", { name: /Ivy Invited/ }).click();
  await page.waitForURL(new RegExp(`/partners/${need("ivy")}`));

  await page.keyboard.press("ControlOrMeta+k");
  await pal.getByRole("combobox").fill("Commissions");
  await pal.getByRole("option", { name: /^Commissions/ }).click();
  await page.waitForURL(/\/commissions$/);

  await page.keyboard.press("ControlOrMeta+k");
  await pal.getByRole("combobox").fill("Invite a partner");
  await pal.getByRole("option", { name: /^Invite a partner/ }).click();
  await page.waitForURL(/partners\?invite=1/);
  await expect(page.getByRole("dialog", { name: "Invite a partner" })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.keyboard.press("ControlOrMeta+k");
  await pal.getByRole("combobox").fill("how much do we owe");
  await pal.getByRole("option", { name: /Ask: “how much do we owe”/ }).click();
  await page.waitForURL(/assistant\?q=how/);

  await go("/partners");
  await page.keyboard.press("g");
  await page.keyboard.press("c");
  await page.waitForURL(/\/commissions$/);
});

test("command palette: typing a page name and pressing Enter opens that page", async () => {
  await go("");
  await page.keyboard.press("ControlOrMeta+k");
  const pal = page.getByRole("dialog", { name: "Command palette" });
  await pal.getByRole("combobox").fill("Commissions");
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/(commissions|assistant)/);
  expect(new URL(page.url()).pathname).toBe(`${S.base}/commissions`);
});

/* ================================================================== dashboard */

test("dashboard: cards, needs-you links and numbers", async () => {
  await go("");
  await expect(
    page.getByRole("region", { name: "Key numbers" }).or(page.getByLabel("Key numbers")),
  ).toContainText(`$${(need<number>("revenue") / 100).toFixed(2)}`);
  await expect(page.getByRole("heading", { name: "Needs you" })).toBeVisible();
  const held = page.getByRole("link", { name: /Held commissions/ });
  await expect(held).toBeVisible();
  await held.click();
  await page.waitForURL(/commissions\?status=held/);
  await expect(page.getByRole("tab", { name: /^Held/ })).toHaveAttribute("aria-selected", "true");
  await go("");
  await page.getByRole("link", { name: /Open payouts|Review \d+ payout/ }).click();
  await page.waitForURL(/\/payouts$/);
  await go("");
  await page.getByRole("link", { name: "Install tracking" }).first().click();
  await page.waitForURL(/settings\/install/);
});

/* ================================================================== program switcher */

test("program switcher: create a second program and switch between them", async () => {
  await go("/settings/programs");
  await page.getByLabel("Website").fill("http://127.0.0.1:3000/second");
  await page.getByLabel("Name").fill(`Second ${S.id}`);
  await page.getByRole("button", { name: "Create program" }).click();
  await expectToast(page, "Program created");
  await page.waitForURL(/\/onboarding\?program=prg_/);
  const second = new URL(page.url()).searchParams.get("program")!;
  await page.goto(`/app/${second}`);
  await expect(page.getByRole("button", { name: "Switch program" })).toContainText(`Second ${S.id}`);
  await page.getByRole("button", { name: "Switch program" }).click();
  await page.getByRole("menuitem", { name: new RegExp(`^QA Co ${S.id}`) }).click();
  await page.waitForURL(new RegExp(`/app/${S.programId}$`));
  await expect(page.getByRole("button", { name: "Switch program" })).toContainText(`QA Co ${S.id}`);
  // the new program has none of the first program's data
  await page.goto(`/app/${second}/partners`);
  await expect(page.getByText("No partners yet")).toBeVisible();
  // and no access to another founder's program
  const res = await page.request.get("/app/prg_doesnotexist000/partners");
  expect(res.status()).toBe(404);
});

/* ================================================================== demo (read only) */

test("demo account, read only: rich screens render without errors", async ({ browser }) => {
  await ctx.close();
  ctx = await browser.newContext();
  page = await ctx.newPage();
  problems = watch(page);
  await page.goto("/login");
  await page.getByLabel("Email").fill("demo@openpromoter.test");
  await page.getByLabel("Password", { exact: true }).fill("openpromoter-demo");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/app\/prg_/, { timeout: 30_000 });
  const base = new URL(page.url()).pathname;
  await page.goto(`${base}/partners`);
  const total = Number((await page.getByText(/^1–\d+ of \d+$/).textContent())!.split(" of ")[1]);
  expect(total).toBeGreaterThan(10);
  if (total > 50) {
    await page.getByRole("button", { name: "Next page" }).click();
    await page.waitForURL(/page=2/);
    await expect(page.getByText(/^51–\d+ of/)).toBeVisible();
  } else await expect(page.getByRole("button", { name: "Next page" })).toBeDisabled();
  await page.getByRole("button", { name: /Revenue/ }).click();
  await page.waitForURL(/sort=revenue/);
  await page.getByRole("tab", { name: "Top earners" }).click();
  await page.getByRole("tab", { name: "High risk" }).click();
  await page.waitForURL(/risk=high/);
  await page.goto(`${base}/commissions?view=board`);
  await expect(page.getByRole("heading", { name: "Approved", exact: true })).toBeVisible();
  for (const p of [
    "/analytics?days=90",
    "/customers",
    "/fraud",
    "/autopilot",
    "/campaigns",
    "/messages",
    "",
  ]) {
    await page.goto(base + p);
    await page.waitForLoadState("load");
  }
  await page.goto(`${base}/partners`);
  await page.locator('a[href*="/partners/prt_"]').first().click();
  await page.waitForURL(/partners\/prt_/);
  await expect(page.getByRole("heading", { name: "Commissions", exact: true })).toBeVisible();
});
