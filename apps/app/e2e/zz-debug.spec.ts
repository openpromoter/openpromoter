import { test } from "@playwright/test";
import { newFounder } from "./full-settings.helpers";

test("debug checkout", async ({ page }) => {
  test.setTimeout(120_000);
  const id = Date.now().toString(36);
  const base = await newFounder(page, "Dbg", `dbg-${id}@example.test`, `Dbg ${id}`);
  await page.goto(`${base}/settings/billing`);
  await page.getByRole("button", { name: "Choose" }).first().click();
  await page.waitForURL(/checkout\.stripe\.com/, { timeout: 60_000 });
  await page.waitForTimeout(6000);
  await page.screenshot({ path: `${process.env.SHOT_DIR}/checkout.png`, fullPage: true });
  console.log(await page.locator("body").ariaSnapshot());
});
