import { mkdirSync } from "node:fs";
import path from "node:path";
import { test } from "@playwright/test";

/** Design QA: SCREENSHOTS=1 pnpm e2e screens  → docs/screenshots/app-*.png (demo seed required). */
test.skip(!process.env.SCREENSHOTS, "set SCREENSHOTS=1");
test.setTimeout(600_000);

const OUT = path.resolve(import.meta.dirname, "../../../docs/screenshots");
const PAGES = [
  "",
  "/partners",
  "/partners/__first__",
  "/customers",
  "/commissions",
  "/payouts",
  "/autopilot",
  "/recruiter",
  "/campaigns",
  "/content",
  "/analytics",
  "/fraud",
  "/assistant",
  "/settings",
  "/settings/integrations",
  "/settings/developers",
];
const only = process.env.ONLY?.split(",");
const STATE = path.resolve(import.meta.dirname, "../test-results/demo-state.json");

// one sign-in for all screenshot runs (Better Auth limits sign-in attempts)
test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.getByLabel("Email").fill("demo@openpromoter.test");
  await page.getByLabel("Password", { exact: true }).fill("openpromoter-demo");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/app\/prg_/);
  await ctx.storageState({ path: STATE });
  await ctx.close();
});

for (const [device, viewport] of [
  ["desktop", { width: 1440, height: 900 }],
  ["mobile", { width: 390, height: 844 }],
] as const) {
  for (const scheme of ["light", "dark"] as const) {
    test(`${device} ${scheme}`, async ({ browser }) => {
      mkdirSync(OUT, { recursive: true });
      const ctx = await browser.newContext({
        viewport,
        colorScheme: scheme,
        deviceScaleFactor: device === "mobile" ? 2 : 1,
        isMobile: device === "mobile",
        hasTouch: device === "mobile",
        storageState: STATE,
      });
      const page = await ctx.newPage();
      await page.goto("/app");
      await page.waitForURL(/\/app\/prg_/);
      const base = new URL(page.url()).pathname;
      await page.goto(`${base}/partners`);
      const first = await page.locator('a[href*="/partners/prt_"]').first().getAttribute("href");
      for (const p of PAGES) {
        const name = p === "" ? "dashboard" : p.slice(1).replace(/\//g, "-").replace("__first__", "detail");
        if (only && !only.includes(name)) continue;
        await page.goto(p === "/partners/__first__" ? first! : `${base}${p}`);
        await page.waitForLoadState("load");
        await page.waitForTimeout(800);
        await page.screenshot({
          path: `${OUT}/app-${name}-${device}-${scheme}.png`,
          fullPage: device === "desktop",
        });
      }
      for (const [name, url] of [
        ["program-page", "/p/acme-analytics"],
        ["apply", "/p/acme-analytics/apply"],
        ["login", "/login"],
        ["onboarding", "/onboarding"],
      ] as const) {
        if (only && !only.includes(name)) continue;
        await page.goto(url);
        await page.waitForLoadState("load");
        await page.waitForTimeout(500);
        await page.screenshot({
          path: `${OUT}/app-${name}-${device}-${scheme}.png`,
          fullPage: device === "desktop",
        });
      }
      await ctx.close();
    });
  }
}
