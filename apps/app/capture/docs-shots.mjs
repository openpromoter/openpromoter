/**
 * Docs screenshots for openpromoter.com/docs, taken by doing each workflow for real on the local app with
 * the seeded Acme Analytics demo (scripts/seed.ts). Run with the dev server on :3000 in Cloud mode
 * (HOSTED_MODE=true), then: node capture/docs-shots.mjs [only-name-prefix]
 *
 * House style (like wpreturns.com docs, in OpenPromoter blue):
 *  - one action: a #2442F5 ring with a 3px white gap around the control, no arrows
 *  - a numbered list on one screen: ring plus a square chip with the doc's step number
 *  - results and reference screens stay clean
 * Local hosts are swapped for the real ones in the DOM before each shot. Output: PNG at 2x in OUT.
 */
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";

const { chromium } = createRequire(import.meta.url)("@playwright/test");
const B = "http://localhost:3000";
const OUT = process.env.OUT ?? "/tmp/op-docs";
const ONLY = process.argv[2] ?? "";
mkdirSync(OUT, { recursive: true });

const SWAP = [
  ["http://acme-analytics.openpromoter.com:3000", "https://acme-analytics.openpromoter.com"],
  [".openpromoter.com:3000", ".openpromoter.com"],
  ["acme-analytics.localhost:3000", "acme-analytics.openpromoter.com"],
  ["http://localhost:3000", "https://app.openpromoter.com"],
  ["localhost:3000", "app.openpromoter.com"],
];

async function swapHosts(page) {
  await page.evaluate((swap) => {
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode())
      for (const [a, b] of swap) if (n.nodeValue.includes(a)) n.nodeValue = n.nodeValue.split(a).join(b);
    for (const el of document.querySelectorAll("input, textarea"))
      for (const [a, b] of swap) if (el.value?.includes(a)) el.value = el.value.split(a).join(b);
  }, SWAP);
}

/** Draw rings (and numbered chips) around elements. marks: [{ sel | locator, n? }] */
async function mark(page, marks = []) {
  await page.evaluate(() => document.querySelectorAll("[data-op-mark]").forEach((e) => e.remove()));
  for (const [i, m] of marks.entries()) {
    const loc = typeof m.sel === "string" ? page.locator(m.sel).first() : m.sel;
    if (i === 0) await loc.scrollIntoViewIfNeeded().catch(() => {});
    const box = await loc.boundingBox().catch(() => null);
    if (!box) {
      console.warn("  ! mark not found:", m.label ?? m.sel);
      continue;
    }
    await page.evaluate(
      ({ box, n }) => {
        const pad = 5;
        const r = document.createElement("div");
        r.dataset.opMark = "1";
        Object.assign(r.style, {
          position: "absolute",
          left: `${box.x + window.scrollX - pad}px`,
          top: `${box.y + window.scrollY - pad}px`,
          width: `${box.width + pad * 2}px`,
          height: `${box.height + pad * 2}px`,
          border: "2.5px solid #2442F5",
          borderRadius: "9px",
          boxShadow: "0 0 0 3px #fff",
          zIndex: 2147483646,
          pointerEvents: "none",
        });
        document.body.appendChild(r);
        if (n) {
          const c = document.createElement("div");
          c.dataset.opMark = "1";
          c.textContent = String(n);
          Object.assign(c.style, {
            position: "absolute",
            left: `${box.x + window.scrollX + box.width + pad - 4}px`,
            top: `${box.y + window.scrollY - pad - 14}px`,
            width: "22px",
            height: "22px",
            background: "#2442F5",
            color: "#fff",
            font: "600 12px/22px Inter, system-ui, sans-serif",
            textAlign: "center",
            borderRadius: "5px",
            boxShadow: "0 0 0 2px #fff",
            zIndex: 2147483647,
            pointerEvents: "none",
          });
          document.body.appendChild(c);
        }
      },
      { box, n: m.n },
    );
  }
}

const shots = [];
async function shoot(page, name, { marks, el, full, scrollTo } = {}) {
  if (ONLY && !name.startsWith(ONLY)) return;
  await page.waitForLoadState("load").catch(() => {});
  await page.waitForTimeout(900);
  if (scrollTo) await page.locator(scrollTo).first().scrollIntoViewIfNeeded().catch(() => {});
  await swapHosts(page);
  await page.evaluate(() => document.querySelectorAll("[data-sonner-toaster], nextjs-portal").forEach((e) => e.remove()));
  await mark(page, marks);
  const path = `${OUT}/${name}.png`;
  if (el) {
    const loc = typeof el === "string" ? page.locator(el).first() : el;
    // a panel taller than the window would come out shrunk: give the page room, then put it back
    const vp = page.viewportSize();
    await page.setViewportSize({ width: vp.width, height: 2400 });
    await page.waitForTimeout(400);
    await loc.screenshot({ path }).catch((e) => console.warn("  ! el shot failed", name, e.message));
    await page.setViewportSize(vp);
  } else await page.screenshot({ path, fullPage: !!full });
  await mark(page, []);
  shots.push(name);
  console.log("shot", name);
}
const heading = (page, name) => page.getByRole("heading", { name, exact: true });
const sectionOf = (page, name) => heading(page, name).locator("xpath=ancestor::section[1]");
const cardOf = (page, name) =>
  page.getByText(name, { exact: true }).first().locator("xpath=ancestor::*[contains(@class,'rounded')][1]");

async function signIn(ctx, email, password) {
  const page = await ctx.newPage();
  await page.goto(`${B}/login`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 });
  return page;
}

const b = await chromium.launch();
const opts = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: "light" };

// ---------------------------------------------------------------- founder (Acme Analytics demo)
{
  const ctx = await b.newContext(opts);
  const page = await signIn(ctx, "demo@openpromoter.test", "openpromoter-demo");
  await page.waitForURL(/\/app\/prg_/, { timeout: 60_000 });
  const pid = page.url().match(/prg_[\w-]+/)[0];
  const A = `${B}/app/${pid}`;
  await page.goto(A);
  await shoot(page, "dashboard");
  await shoot(page, "dashboard-checklist", { el: page.getByText("Finish setup").first().locator("xpath=ancestor::*[contains(@class,'rounded')][1]") });
  await page.goto(`${A}/partners`);
  await shoot(page, "partners-list");
  await shoot(page, "partners-pending", { marks: [{ sel: page.getByText(/^Needs approval/).first(), label: "needs approval tab" }] });
  // invite a partner by email
  await page.getByRole("button", { name: "Invite partner" }).first().click().catch(() => {});
  await page.waitForTimeout(700);
  await shoot(page, "invite-partners");
  await page.keyboard.press("Escape");
  const leo = await page.locator('a[href*="/partners/prt_"]').filter({ hasText: "Leo Martins" }).first().getAttribute("href");
  await page.goto(`${B}${leo}`);
  await shoot(page, "partner-detail");
  await shoot(page, "partner-rate-override", { marks: [{ sel: page.getByText(/Custom rate|Commission override|override/i).first(), label: "override" }] });
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await shoot(page, "partner-traffic", { el: sectionOf(page, "Traffic") });

  for (const [path, name] of [
    ["/customers", "customers"],
    ["/commissions", "commissions"],
    ["/campaigns", "campaigns"],
    ["/content", "content-kit"],
    ["/messages", "messages"],
    ["/recruiter", "recruiter"],
    ["/autopilot", "autopilot"],
    ["/assistant", "ask-ai"],
    ["/fraud", "fraud"],
    ["/analytics", "analytics"],
  ]) {
    await page.goto(`${A}${path}`);
    await shoot(page, name);
  }
  await page.goto(`${A}/analytics`);
  await shoot(page, "analytics-visitors", { el: sectionOf(page, "Visitors") });

  await page.goto(`${A}/payouts`);
  await shoot(page, "payouts");
  await shoot(page, "payouts-approve", { marks: [{ sel: page.getByRole("button", { name: /^Approve \d+ payout/ }).first(), label: "approve" }] });
  const inv = await page.locator('a[href*="/invoice"]').first().getAttribute("href").catch(() => null);
  if (inv) {
    await page.goto(`${B}${inv}`);
    await shoot(page, "payout-invoice");
  }

  // settings
  await page.goto(`${A}/settings`);
  await shoot(page, "settings-program");
  await shoot(page, "settings-commission", { el: cardOf(page, "Commission") });
  for (const t of ["Tiers", "Product rates", "Reward for the customer", "Tracking", "Payouts", "Terms"]) {
    const c = cardOf(page, t);
    if (await c.count()) await shoot(page, `settings-${t.toLowerCase().replaceAll(" ", "-")}`, { el: c });
  }
  for (const [path, name] of [
    ["/settings/application", "settings-application"],
    ["/settings/branding", "settings-branding"],
    ["/settings/install", "settings-install"],
    ["/settings/integrations", "settings-integrations"],
    ["/settings/developers", "settings-developers"],
    ["/settings/team", "settings-team"],
    ["/settings/billing", "settings-billing"],
    ["/settings/import", "settings-import"],
    ["/settings/audit", "settings-audit"],
    ["/settings/account", "settings-account"],
    ["/settings/programs", "settings-programs"],
  ]) {
    await page.goto(`${A}${path}`);
    await shoot(page, name, { full: name === "settings-application" || name === "settings-integrations" || name === "settings-developers" });
  }
  await page.goto(`${A}/settings/branding`);
  await shoot(page, "settings-custom-domain", { el: cardOf(page, "Custom domain") });
  await page.goto(`${A}/settings/application`);
  await shoot(page, "settings-questions", { el: cardOf(page, "Questions") });
  // command palette
  await page.goto(A);
  await page.keyboard.press("Meta+k");
  await page.waitForTimeout(500);
  await shoot(page, "command-palette");
  await ctx.close();
}

// ---------------------------------------------------------------- public program pages (signed out)
{
  const ctx = await b.newContext(opts);
  const page = await ctx.newPage();
  await page.goto(`${B}/p/acme-analytics`);
  await shoot(page, "program-page", { full: true });
  await page.goto(`${B}/p/acme-analytics/apply`);
  await shoot(page, "apply-form", { full: true });
  await page.goto(`${B}/login?next=${encodeURIComponent("/p/acme-analytics/portal")}`);
  await shoot(page, "partner-sign-in");
  await ctx.close();
}

// ---------------------------------------------------------------- partner portal (Leo Martins)
{
  const ctx = await b.newContext(opts);
  const page = await signIn(ctx, "leo@partners.example", "openpromoter-demo");
  const P = `${B}/p/acme-analytics/portal`;
  for (const [path, name] of [
    ["", "portal-home"],
    ["/links", "portal-links"],
    ["/traffic", "portal-traffic"],
    ["/earnings", "portal-earnings"],
    ["/payouts", "portal-payouts"],
    ["/content", "portal-content"],
    ["/recruits", "portal-recruits"],
    ["/messages", "portal-messages"],
    ["/settings", "portal-settings"],
  ]) {
    await page.goto(`${P}${path}`);
    await shoot(page, name, { full: name === "portal-settings" });
  }
  await page.goto(P);
  await shoot(page, "portal-copy-link", { marks: [{ sel: page.getByRole("button", { name: "Copy link" }).first(), label: "copy" }] });
  await ctx.close();
}

// ---------------------------------------------------------------- a new founder: sign-up and onboarding
{
  const ctx = await b.newContext(opts);
  const page = await ctx.newPage();
  const id = Date.now().toString(36);
  await page.goto(`${B}/signup`);
  await shoot(page, "signup");
  await page.getByLabel("Name").fill("Maya Patel").catch(() => {});
  await page.getByLabel(/email/i).first().fill(`maya.${id}@docs.example`).catch(() => {});
  await page.getByLabel("Email").fill(`maya.${id}@docs.example`);
  await page.getByLabel("Password", { exact: true }).fill("docs-password-123");
  await page.getByRole("button", { name: /Create account|Sign up/ }).click();
  await page.waitForURL(/onboarding/, { timeout: 30_000 }).catch(() => {});
  await shoot(page, "onboarding-1-product");
  // a made-up company: docs never show a real brand as our customer
  await page.getByLabel("Website URL").fill("https://northwind.example");
  await page.getByLabel(/Product name/).fill("Northwind CRM").catch(() => {});
  await shoot(page, "onboarding-1-product-filled", { marks: [{ sel: page.getByRole("button", { name: /Continue/ }).first(), label: "continue" }] });
  await page.getByRole("button", { name: /Continue/ }).first().click();
  await page.waitForURL(/step=2/, { timeout: 60_000 }).catch(() => {});
  // the "Running on localhost" help only appears on a local install
  await page.evaluate(() => {
    for (const el of document.querySelectorAll("div, section"))
      if (el.childElementCount < 12 && el.textContent?.startsWith("Running on localhost")) el.remove();
  });
  await page.evaluate(() => {
    const h = [...document.querySelectorAll("*")].find((e) => e.children.length < 6 && e.textContent?.trim().startsWith("Running on localhost"));
    h?.closest("div[class*='rounded']")?.remove();
  });
  await shoot(page, "onboarding-2-billing");
  for (const n of [3, 4, 5]) {
    await page.goto(page.url().replace(/step=\d/, `step=${n}`));
    await page.waitForTimeout(n === 3 ? 6000 : 1500);
    await shoot(page, `onboarding-${n}-${["", "", "", "design", "install", "done"][n]}`);
  }
  await ctx.close();
}

await b.close();
console.log(`${shots.length} shots in ${OUT}`);
