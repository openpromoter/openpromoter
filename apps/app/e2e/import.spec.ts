import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { signUp, stripeEvent, uid, WEBHOOK_SECRET } from "./helpers";

const Q = path.resolve(import.meta.dirname, "sql.mjs");
const sql = <T = Record<string, unknown>>(q: string): T[] =>
  JSON.parse(execFileSync("node", [Q, q], { encoding: "utf8" }));

/**
 * A founder moves from another tool: partners, then the customers they referred, then balances, all through
 * Settings > Import. Old links keep attributing, a renewal pays the old partner, the imported balance is paid
 * out, and running the same files again changes nothing.
 */
test.describe
  .serial("moving from another affiliate tool", () => {
    test.setTimeout(240_000);
    const id = uid();
    const founder = { name: "Mo Mover", email: `mover-${id}@e2e.test` };
    const maya = `maya-${id}@e2e.test`;
    let programUrl = "";
    let webhookUrl = "";
    let slug = "";

    const upload = async (page: Page, kind: string, name: string, csv: string, cents = false) => {
      await page.goto(`${programUrl}/settings/import`);
      await page.getByRole("button", { name: kind, exact: true }).click();
      await page
        .getByLabel("CSV file")
        .setInputFiles({ name, mimeType: "text/csv", buffer: Buffer.from(csv) });
      await expect(page.getByLabel("CSV contents")).not.toHaveValue("");
      if (cents) await page.getByLabel(/Amounts in this file are in cents/).check();
      await page.getByRole("button", { name: "Import", exact: true }).click();
      return page.getByRole("status").filter({ hasText: "Imported" });
    };

    test("founder signs up and connects Stripe webhooks", async ({ page }) => {
      await signUp(page, founder.name, founder.email);
      await page.getByLabel("Website URL").fill("http://127.0.0.1:3000");
      await page.getByLabel("Product name").fill(`Moveco ${id}`);
      await page.getByRole("button", { name: "Continue" }).click();
      await page.getByRole("button", { name: /Skip for now/ }).click();
      await page.getByRole("button", { name: "Accept this program" }).click();
      await page.getByRole("button", { name: /I'll do this later|Continue/ }).click();
      await page.getByRole("link", { name: "Go to dashboard" }).click();
      await page.waitForURL(/\/app\/prg_/);
      programUrl = new URL(page.url()).pathname;
      await page.goto(`${programUrl}/settings/integrations`);
      webhookUrl = (await page.locator("text=/api/webhooks/stripe/").first().textContent())!.trim();
      await page.getByLabel("Webhook signing secret").fill(WEBHOOK_SECRET);
      await page.getByRole("button", { name: "Connect" }).first().click();
      await expect(page.getByText("Webhook secret missing")).toHaveCount(0);
      await page.goto(`${programUrl}/settings/install`);
      slug = (await page.locator("pre", { hasText: "data-program" }).first().textContent())!.match(
        /data-program="([^"]+)"/,
      )![1]!;

      // partners, shaped like a Rewardful affiliates export saved by Excel (byte order mark included)
      const status = await upload(
        page,
        "Partners",
        "affiliates.csv",
        "\uFEFFid,first_name,last_name,email,paypal_email,state,links.token,coupon\n" +
          `aff_1,Maya,Chen,${maya},pp-${maya},active,maya-c.1,MAYA${id.toUpperCase()}\n` +
          `aff_2,Bad,Actor,bad-${id}@e2e.test,,suspended,bad-${id},\n` +
          `aff_3,Dup,Code,dup-${id}@e2e.test,,active,MAYA-C.1,\n` +
          ",No,Email,,,active,nomail,\n",
      );
      await expect(status).toContainText("Imported 2 and skipped 2");
      await expect(status).toContainText(`code MAYA-C.1 belongs to ${maya}`);
      await expect(status).toContainText("Row 5: no email");
      const [p] = sql<{ code: string; external_id: string; status: string; paypal_email: string }>(
        `select code, external_id, status, paypal_email from partner where email = '${maya}'`,
      );
      expect(p).toMatchObject({
        code: "maya-c.1",
        external_id: "aff_1",
        status: "approved",
        paypal_email: `pp-${maya}`,
      });
      const [bad] = sql<{ status: string }>(`select status from partner where email = 'bad-${id}@e2e.test'`);
      expect(bad?.status).toBe("banned");
    });

    test("referred customers come over by the old tool's partner ID", async ({ page }) => {
      await signIn(page);
      // shaped like a Tolt customers export: the partner is named only by Tolt's partner ID
      const status = await upload(
        page,
        "Referred customers",
        "customers.csv",
        "id,customer_id,email,partner_id,status\n" +
          `c1,cus_a${id},a-${id}@buyer.test,aff_1,active\n` +
          `c2,cus_b${id},b-${id}@buyer.test,aff_1,trialing\n` +
          `c3,cus_c${id},c-${id}@buyer.test,aff_404,active\n`,
      );
      await expect(status).toContainText("Imported 2 and skipped 1");
      await expect(status).toContainText("no partner with ID aff_404 in this program");
      const refs = sql<{ status: string; paid_invoices: number }>(
        `select status, paid_invoices from referral where external_customer_id in ('cus_a${id}','cus_b${id}') order by external_customer_id`,
      );
      expect(refs).toEqual([
        { status: "active", paid_invoices: 1 },
        { status: "trialing", paid_invoices: 0 },
      ]);
    });

    test("balances come over from a list of single commissions in cents", async ({ page }) => {
      await signIn(page);
      const csv =
        "affiliate_id,amount,status,currency\naff_1,9900,due,usd\naff_1,1000,paid,usd\naff_1,500,voided,usd\n";
      const status = await upload(page, "Balances", "commissions.csv", csv, true);
      await expect(status).toContainText("Imported 1");
      await page.goto(`${programUrl}/commissions`);
      await expect(
        page.getByText("Unpaid commission carried over from the previous affiliate tool").first(),
      ).toBeVisible();
      await expect(page.getByText("$99.00").first()).toBeVisible();

      // the same file again adds nothing
      const again = await upload(page, "Balances", "commissions.csv", csv, true);
      await expect(again).toContainText("Imported 0");
      await expect(again).toContainText("this commission was already imported");
      const [sum] = sql<{ n: string }>(
        `select coalesce(sum(amount),0)::text as n from commission c join partner p on p.id = c.partner_id where p.email = '${maya}'`,
      );
      expect(sum?.n).toBe("10900");
    });

    test("an old link with a dotted code still attributes and a renewal pays the old partner", async ({
      request,
      page,
    }) => {
      const res = await request.get(`/r/${slug}/maya-c.1`, { maxRedirects: 0 });
      expect(res.status()).toBe(302);
      expect(new URL(res.headers().location!).searchParams.get("op_click")).toMatch(/^clk_/);

      await stripeEvent(request, webhookUrl, "invoice.paid", {
        id: `in_${id}`,
        object: "invoice",
        customer: `cus_a${id}`,
        customer_email: `a-${id}@buyer.test`,
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
      await signIn(page);
      await page.goto(`${programUrl}/commissions`);
      const row = page.getByRole("row", { name: /Maya Chen/ }).filter({ hasText: "$60.00" });
      await expect(row.first()).toBeVisible();
    });

    test("the imported balance is paid out and the old paid total is not paid again", async ({ page }) => {
      await signIn(page);
      page.on("dialog", (d) => d.accept(d.type() === "prompt" ? "bank-ref-e2e" : undefined));
      await page.goto(`${programUrl}/payouts`);
      await page.getByRole("button", { name: "Prepare payouts" }).first().click();
      await expect(page.getByText(/payouts? ready for approval/)).toBeVisible();
      const [po] = sql<{ amount: number }>(
        `select po.amount from payout po join partner p on p.id = po.partner_id where p.email = '${maya}'`,
      );
      // $99.00 brought over; the $10.00 paid in the old tool and the pending $60.00 renewal are not in it
      expect(po?.amount).toBe(9900);
    });

    async function signIn(page: Page) {
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
