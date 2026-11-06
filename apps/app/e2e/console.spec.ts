import { expect, test } from "@playwright/test";

/** Quality gate: no console errors on any screen (demo seed). CONSOLE=1 pnpm e2e console */
test.skip(!process.env.CONSOLE, "set CONSOLE=1");
test.setTimeout(300_000);

test("no console errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(`${page.url()}: ${m.text().slice(0, 200)}`));
  page.on("pageerror", (e) => errors.push(`${page.url()}: ${e.message.slice(0, 200)}`));
  await page.goto("/login");
  await page.getByLabel("Email").fill("demo@openpromoter.test");
  await page.getByLabel("Password", { exact: true }).fill("openpromoter-demo");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/app\/prg_/);
  const base = new URL(page.url()).pathname;
  for (const p of [
    "",
    "/partners",
    "/customers",
    "/commissions",
    "/payouts",
    "/autopilot",
    "/recruiter",
    "/campaigns",
    "/content",
    "/messages",
    "/analytics",
    "/fraud",
    "/assistant",
    "/settings",
    "/settings/application",
    "/settings/import",
    "/settings/branding",
    "/settings/install",
    "/settings/integrations",
    "/settings/developers",
    "/settings/team",
    "/settings/audit",
    "/settings/programs",
    "/settings/account",
  ]) {
    await page.goto(base + p);
    await page.waitForLoadState("load");
    await page.waitForTimeout(300);
  }
  for (const u of ["/p/acme-analytics", "/p/acme-analytics/apply", "/network", "/onboarding"]) {
    await page.goto(u);
    await page.waitForLoadState("load");
  }
  expect(errors).toEqual([]);
});
