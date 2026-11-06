import { expect, test } from "@playwright/test";
import { signUp, stripeEvent, uid, WEBHOOK_SECRET } from "./helpers";

/**
 * The whole founder journey with no external services:
 * signup → onboarding → partner applies → click → Stripe checkout + invoice (signed webhooks)
 * → commission → payout approved and paid → refund claws it back.
 */
test.describe
  .serial("founder to paid partner", () => {
    const id = uid();
    const founder = { name: "Erin Founder", email: `erin-${id}@e2e.test` };
    const partner = { name: "Pia Partner", email: `pia-${id}@e2e.test` };
    let programUrl = "";
    let webhookUrl = "";
    let slug = "";
    let code = "";
    let clickId = "";

    test("onboarding in under five steps", async ({ page }) => {
      const started = Date.now();
      await signUp(page, founder.name, founder.email);
      await page.getByLabel("Website URL").fill("http://127.0.0.1:3000");
      await page.getByLabel("Product name").fill(`Testco ${id}`);
      await page.getByRole("button", { name: "Continue" }).click();
      await expect(page.getByRole("heading", { name: "Connect Stripe" })).toBeVisible();
      await page.getByRole("button", { name: /Use Paddle, Lemon Squeezy or Polar instead/ }).click();
      await expect(page.getByRole("button", { name: "Accept this program" })).toBeVisible();
      await expect(page.getByText("Commission", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Accept this program" }).click();
      await expect(page.getByRole("heading", { name: "Install tracking" })).toBeVisible();
      await page.getByRole("button", { name: /I'll do this later|Continue/ }).click();
      await expect(page.getByRole("heading", { name: /partner program is live/ })).toBeVisible();
      await page.getByRole("link", { name: "Go to dashboard" }).click();
      await page.waitForURL(/\/app\/prg_/);
      programUrl = new URL(page.url()).pathname;
      expect(Date.now() - started).toBeLessThan(5 * 60_000);

      await page.goto(`${programUrl}/settings/integrations`);
      webhookUrl = (await page.locator("text=/api/webhooks/stripe/").first().textContent())!.trim();
      await page.getByLabel("Webhook signing secret").fill(WEBHOOK_SECRET);
      await page.getByRole("button", { name: "Connect" }).first().click();
      await expect(page.getByText("Webhook secret missing")).toHaveCount(0);

      await page.goto(`${programUrl}/settings/install`);
      slug = (await page.locator("pre", { hasText: "data-program" }).first().textContent())!.match(
        /data-program="([^"]+)"/,
      )![1]!;
    });

    test("partner applies and is auto-approved", async ({ browser }) => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await page.goto(`/p/${slug}`);
      await page.getByRole("link", { name: "Become a partner" }).click();
      await page.getByLabel("Full name").fill(partner.name);
      await page.getByLabel("Email").fill(partner.email);
      await page.getByLabel("Password", { exact: true }).fill("e2e-password-123");
      await page.getByLabel("Website or main channel").fill("https://pia.example");
      await page.getByRole("checkbox").check();
      await page.getByRole("button", { name: /^(Join and get my link|Send application)$/ }).click();
      await page.waitForURL(/\/portal$/);
      const link = (await page.locator("span.font-mono", { hasText: "/r/" }).first().textContent())!;
      expect(link).toContain(`/r/${slug}/`);
      await page.goto(`/p/${slug}/portal/payouts`);
      await page.getByText("Bank transfer (arranged with the team)").click();
      await page.getByRole("button", { name: "Use bank transfer" }).click();
      await expect(page.getByText("Payout method saved")).toBeVisible();
      code = link.split("/").pop()!.trim();
      await ctx.close();
    });

    test("click → Stripe checkout → invoice creates a commission", async ({ request, page }) => {
      const res = await request.get(`/r/${slug}/l/${code}`, { maxRedirects: 0 });
      expect(res.status()).toBe(302);
      clickId = new URL(res.headers().location!).searchParams.get("op_click")!;
      expect(clickId).toMatch(/^clk_/);

      await stripeEvent(request, webhookUrl, "checkout.session.completed", {
        id: `cs_${id}`,
        object: "checkout.session",
        customer: `cus_${id}`,
        client_reference_id: clickId,
        customer_details: { email: `buyer-${id}@e2e.test`, name: "Buyer" },
        subscription: `sub_${id}`,
        metadata: {},
      });
      await stripeEvent(request, webhookUrl, "invoice.paid", {
        id: `in_${id}`,
        object: "invoice",
        customer: `cus_${id}`,
        customer_email: `buyer-${id}@e2e.test`,
        amount_paid: 20000,
        tax: 0,
        currency: "usd",
        charge: `ch_${id}`,
        subscription: `sub_${id}`,
        status_transitions: { paid_at: Math.floor(Date.now() / 1000) },
        lines: {
          data: [{ description: "Pro plan", price: { recurring: { interval: "month", interval_count: 1 } } }],
        },
      });

      await signInFounder(page);
      await page.goto(`${programUrl}/commissions`);
      const row = page.getByRole("row", { name: new RegExp(partner.name) });
      await expect(row).toContainText("Pending");
      await expect(row).toContainText("$200.00");
    });

    test("founder approves and pays; refund claws back", async ({ page, request }) => {
      await signInFounder(page);
      page.on("dialog", (d) => d.accept(d.type() === "prompt" ? "bank-ref-e2e" : undefined));
      await page.goto(`${programUrl}/commissions?status=pending`);
      await page
        .getByRole("row", { name: new RegExp(partner.name) })
        .getByRole("checkbox")
        .check();
      await page
        .getByRole("toolbar", { name: "Bulk actions" })
        .getByRole("button", { name: "Approve now" })
        .click();
      await expect(page.getByText(/Approve now: done|Done/).first()).toBeVisible();

      await page.goto(`${programUrl}/payouts`);
      await page.getByRole("button", { name: "Prepare payouts" }).first().click();
      await expect(page.getByText(/payouts ready for approval/)).toBeVisible();
      await page.getByRole("button", { name: /Approve 1 payout/ }).click();
      await expect(page.getByRole("button", { name: "Mark paid" })).toBeVisible();
      await page.getByRole("button", { name: "Mark paid" }).click();
      await expect(page.getByText("Marked as paid")).toBeVisible();
      await page.reload();
      await expect(
        page.locator("li", { hasText: partner.name }).filter({ hasText: "Paid" }).first(),
      ).toBeVisible();

      await stripeEvent(request, webhookUrl, "charge.refunded", {
        id: `ch_${id}`,
        object: "charge",
        amount: 20000,
        amount_refunded: 20000,
        payment_intent: null,
      });
      await page.goto(`${programUrl}/commissions`);
      await expect(page.getByText("−$70.00").first()).toBeVisible();
    });

    async function signInFounder(page: import("@playwright/test").Page) {
      // Better Auth allows 3 sign-ins per 10s per IP; retry once the window passes
      for (let attempt = 0; attempt < 3; attempt++) {
        await page.goto("/login");
        await page.getByLabel("Email").fill(founder.email);
        await page.getByLabel("Password", { exact: true }).fill("e2e-password-123");
        await page.getByRole("button", { name: "Sign in" }).click();
        const ok = await page.waitForURL(/\/app\//, { timeout: 5000 }).then(
          () => true,
          () => false,
        );
        if (ok) return;
        await page.waitForTimeout(10_000);
      }
      throw new Error("could not sign in");
    }
  });
