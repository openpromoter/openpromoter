import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import {
  BASE,
  captureAction,
  mailLink,
  newFounder,
  newPage,
  PASSWORD,
  problems,
  replayAction,
  signIn,
  signUp,
  toast,
  totp,
  watch,
} from "./full-settings.helpers";

/**
 * Authentication, account, team and every settings screen, end to end against a running dev server.
 * Each run creates its own founders (@e2e.test); mail is read from Mailpit (SMTP_URL=smtp://localhost:1025).
 *   E2E_BASE_URL=http://localhost:3000 npx playwright test e2e/full-settings.spec.ts
 */
test.setTimeout(180_000);

// Not serial on purpose: a failing test (a documented bug) must not skip the rest. The id is set in the
// runner process while it collects tests, so every worker (a new one starts after each failure) shares it,
// and the founder's program is handed on through a small JSON file.
process.env.FULL_SETTINGS_ID ??= Math.random().toString(36).slice(2, 8);
process.env.FULL_SETTINGS_PROBLEMS ??= path.join(
  os.tmpdir(),
  `op-full-settings-${process.env.FULL_SETTINGS_ID}`,
  "problems.log",
);
const id = process.env.FULL_SETTINGS_ID;
const STATE = path.join(os.tmpdir(), `op-full-settings-${id}`);
const STATE_FILE = path.join(STATE, "state.json");
const founder = { name: "Sasha Founder", email: `sasha-${id}@e2e.test` };
let programUrl = "";
let programId = "";
let slug = "";
let acctProgram = "";
const save = (patch: Record<string, string>) => {
  fs.mkdirSync(STATE, { recursive: true });
  const cur = fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) : {};
  fs.writeFileSync(STATE_FILE, JSON.stringify({ ...cur, ...patch }));
};
test.beforeEach(() => {
  if (fs.existsSync(STATE_FILE))
    ({
      programUrl = "",
      programId = "",
      slug = "",
      acctProgram = "",
    } = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")));
});
const saveProgram = (page: Page) =>
  page.getByText("Unsaved changes").locator("xpath=..").getByRole("button", { name: "Save", exact: true });
/** Waits until earlier toasts are gone, so the next toast check sees the new one. */
// close any open toast (a toast under the mouse pauses and never times out), then check none are left
const settle = async (page: Page) => {
  await page.mouse.move(0, 0);
  for (const b of await page.getByRole("button", { name: "Close toast" }).all())
    await b.click().catch(() => {});
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0, { timeout: 15_000 });
};
const alertOf = (page: Page) => page.locator('p[role="alert"]');

/** Read-only SELECT through the shared helper script. */
const Q = path.resolve(import.meta.dirname, "sql.mjs");
function sql<T>(select: string): T[] {
  if (!/^\s*select/i.test(select)) throw new Error("read-only");
  return JSON.parse(execFileSync("node", [Q, select], { encoding: "utf8" }));
}

async function pick(page: Page, trigger: Locator, option: string | RegExp) {
  await trigger.click();
  await page.getByRole("option", { name: option }).click();
}

async function asFounder(browser: import("@playwright/test").Browser, label: string) {
  return newPage(browser, label, `${STATE}/founder.json`);
}

/* ======================================================================== auth */

test.describe("auth", () => {
  test("signup validation: bad email, short password, duplicate email", async ({ browser }) => {
    const { ctx, page } = await newPage(browser, "signup-validation");
    await page.goto("/signup");
    await page.getByLabel("Name").fill("Val Idation");
    await page.getByLabel("Work email").fill("not-an-email");
    await page.getByLabel("Password", { exact: true }).fill("short");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/signup/);
    expect(
      await page.getByLabel("Work email").evaluate((e: HTMLInputElement) => e.validity.typeMismatch),
    ).toBe(true);
    expect(
      await page
        .getByLabel("Password", { exact: true })
        .evaluate((e: HTMLInputElement) => e.validity.tooShort),
    ).toBe(true);

    // the server enforces the same rules when the browser check is bypassed
    const api = (body: object) =>
      page.evaluate(
        async (b) => {
          const r = await fetch("/api/auth/sign-up/email", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(b),
          });
          return { status: r.status, text: await r.text() };
        },
        body as Record<string, string>,
      );
    const bad = await api({ name: "x", email: "not-an-email", password: PASSWORD });
    expect(bad.status).toBeGreaterThanOrEqual(400);
    expect(bad.status).toBeLessThan(500);
    const short = await api({ name: "x", email: `short-${id}@e2e.test`, password: "short" });
    expect(short.status).toBeGreaterThanOrEqual(400);
    expect(short.status).toBeLessThan(500);
    expect(short.text).toMatch(/password/i);

    // duplicate email: create, sign out, try again
    const email = `dup-${id}@e2e.test`;
    await signUp(page, "Dup One", email);
    await ctx.clearCookies();
    let msg = "";
    for (let i = 0; i < 5; i++) {
      await page.goto("/signup");
      await page.getByLabel("Name").fill("Dup Two");
      await page.getByLabel("Work email").fill(email);
      await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
      await page.getByRole("button", { name: "Create account" }).click();
      await expect(alertOf(page)).toBeVisible();
      msg = (await alertOf(page).textContent()) ?? "";
      if (!/too many/i.test(msg)) break;
      await page.waitForTimeout(11_000);
    }
    expect(msg).toMatch(/already exists|already|in use/i);
    await expect(page).toHaveURL(/\/signup/);
    await ctx.close();
  });

  test("founder signs up and finishes onboarding; storage state saved", async ({ browser }) => {
    const { ctx, page } = await newPage(browser, "founder-signup");
    programUrl = await newFounder(page, founder.name, founder.email, `Settingsco ${id}`);
    programId = programUrl.split("/").pop()!;
    await ctx.storageState({ path: `${STATE}/founder.json` });
    await page.goto(`${programUrl}/settings/install`);
    slug = (await page.locator("pre", { hasText: "data-program" }).first().textContent())!.match(
      /data-program="([^"]+)"/,
    )![1]!;
    save({ programUrl, programId, slug });
    await ctx.close();
  });

  test("login: wrong password shows a clear message", async ({ browser }) => {
    const { ctx, page } = await newPage(browser, "login-wrong");
    for (let i = 0; i < 5; i++) {
      await page.goto("/login");
      await page.getByLabel("Email").fill(founder.email);
      await page.getByLabel("Password", { exact: true }).fill("wrong-password-999");
      await page.getByRole("button", { name: "Sign in" }).click();
      const alert = alertOf(page);
      await expect(alert).toBeVisible();
      if (/too many/i.test((await alert.textContent()) ?? "")) {
        await page.waitForTimeout(11_000);
        continue;
      }
      await expect(alert).toHaveText(/invalid email or password/i);
      break;
    }
    await expect(page).toHaveURL(/\/login/);
    await ctx.close();
  });

  test("login success, logout, protected pages redirect to login", async ({ browser }) => {
    const { ctx, page } = await newPage(browser, "login-logout");
    await signIn(page, founder.email);
    await page.waitForURL(/\/app\/prg_/);
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await page.waitForURL(/\/login/);
    await page.goto(`${programUrl}/settings`);
    await expect(page).toHaveURL(/\/login\?next=/);
    await ctx.close();
  });

  for (const next of ["//evil.com/steal", "/\\evil.com/steal", "https://evil.com/steal", "/%2F%2Fevil.com"]) {
    test(`login ?next=${next} stays on this site (open redirect)`, async ({ browser }) => {
      const { ctx, page } = await newPage(browser, `next-${next}`);
      await signIn(page, founder.email, PASSWORD, next);
      await page.waitForLoadState("load");
      await page.waitForTimeout(1500);
      expect(new URL(page.url()).host, `landed on ${page.url()}`).toBe(new URL(BASE).host);
      await expect(page.getByText("OFFSITE")).toHaveCount(0);
      await ctx.close();
    });
  }

  test("signup ?next=//evil.com stays on this site (open redirect)", async ({ browser }) => {
    const { ctx, page } = await newPage(browser, "signup-next");
    await signUp(
      page,
      "Next Probe",
      `next-${id}@e2e.test`,
      PASSWORD,
      `?next=${encodeURIComponent("//evil.com/x")}`,
    );
    await page.waitForLoadState("load");
    await page.waitForTimeout(1500);
    expect(new URL(page.url()).host, `landed on ${page.url()}`).toBe(new URL(BASE).host);
    await ctx.close();
  });

  test("forgot and reset password end to end", async ({ browser }) => {
    const { ctx, page } = await newPage(browser, "reset");
    const email = `reset-${id}@e2e.test`;
    await signUp(page, "Reese Reset", email);
    await ctx.clearCookies();

    // unknown address gets the same answer (no account enumeration)
    await page.goto("/forgot");
    await page.getByLabel("Email").fill(`nobody-${id}@e2e.test`);
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByText(/If an account exists for that email/)).toBeVisible();

    const sent = Date.now() - 2000;
    await page.goto("/forgot");
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByText(/If an account exists for that email/)).toBeVisible();
    const link = await mailLink(email, /Reset your/i, /reset-password|\/reset/, sent);
    await page.goto(link);
    await page.waitForURL(/\/reset\?token=/);
    await page.getByLabel("New password").fill("brand-new-pass-456");
    await page.getByRole("button", { name: "Save password" }).click();
    await page.waitForURL(/\/login/);

    // old password fails, new one works
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(alertOf(page)).toBeVisible();
    await page.waitForTimeout(11_000);
    await signIn(page, email, "brand-new-pass-456");
    await expect(page).not.toHaveURL(/\/login/);

    // the link is single use
    await ctx.clearCookies();
    await page.goto(link);
    await page.waitForLoadState("load");
    if (/\/reset\?token=/.test(page.url())) {
      await page.getByLabel("New password").fill("another-pass-789");
      await page.getByRole("button", { name: "Save password" }).click();
      await expect(page.getByText(/invalid|expired/i)).toBeVisible();
    } else {
      expect(page.url()).toMatch(/error|INVALID_TOKEN|login/i);
    }
    await ctx.close();
  });
});

/* ======================================================================== onboarding */

test.describe("onboarding", () => {
  test("Stripe step rejects a garbage key cleanly, then skips; keep-defaults branch; install step", async ({
    browser,
  }) => {
    const { ctx, page } = await newPage(browser, "onboarding");
    await signUp(page, "Olive Onboard", `onb-${id}@e2e.test`);
    await page.waitForURL(/\/onboarding/);
    await expect(page.getByRole("heading", { name: /What are you selling, Olive/ })).toBeVisible();
    await page.getByLabel("Website URL").fill("http://127.0.0.1:3000");
    await page.getByLabel("Product name").fill(`Onbco ${id}`);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { name: "Connect Stripe" })).toBeVisible();
    await page.getByLabel("Restricted key").fill("this-is-definitely-not-a-stripe-key");
    await page.getByRole("button", { name: "Connect Stripe" }).click();
    await toast(page, /doesn't look like a Stripe/);
    await page.getByRole("button", { name: /Skip for now/ }).click();
    await page.getByRole("button", { name: "Keep the defaults and edit later" }).click();
    await expect(page.getByRole("heading", { name: "Install tracking" })).toBeVisible();
    for (const tab of ["Paste into Claude Code / Cursor", "npm SDK", "Script tag"]) {
      await page.getByRole("tab", { name: tab }).click();
      await expect(page.getByRole("tab", { name: tab })).toHaveAttribute("aria-selected", "true");
    }
    await expect(page.locator("pre", { hasText: "data-program" }).first()).toBeVisible();
    await expect(page.getByText("Waiting for your site to load the script")).toBeVisible();
    await page.getByRole("button", { name: /I'll do this later/ }).click();
    await expect(page.getByRole("heading", { name: /partner program is live/ })).toBeVisible();
    await ctx.close();
  });

  test("onboarding with a program id you don't own is a 404, not a 500", async ({ browser }) => {
    const { ctx, page } = await asFounder(browser, "onboarding-foreign");
    const res = await page.goto("/onboarding?program=prg_doesnotexist&step=2");
    expect(res!.status()).toBe(404);
    await ctx.close();
  });
});

/* ======================================================================== settings: program */

test.describe("settings", () => {
  test("program: every field saves and persists after reload", async ({ browser }) => {
    const { ctx, page } = await asFounder(browser, "program");
    await page.goto(`${programUrl}/settings`);
    const values: Record<string, string> = {
      "Program name": `Renamed ${id}`,
      Website: "https://renamed.example.com",
      Currency: "EUR",
      Rate: "25",
      Months: "6",
      "Per signup (lead) reward": "2.50",
      "Recruiter override": "5",
      Discount: "10",
      "For months": "3",
      "Stripe coupon id": "COUPON10",
      "Cookie window": "45",
      "Link parameter": "partner",
      "Refund hold": "14",
      "Minimum payout": "75.00",
      "Auto-hold at risk score": "60",
    };
    // Months is only enabled for a limited duration, so pick that first
    await pick(page, page.getByLabel("Duration", { exact: true }), /months/i);
    for (const [label, v] of Object.entries(values)) await page.getByLabel(label, { exact: true }).fill(v);
    await page.getByLabel("Program terms").fill(`Terms ${id}`);
    await pick(page, page.getByLabel("Visibility"), /Private/);
    await pick(page, page.getByLabel("Credit goes to"), /Last click/i);
    await pick(page, page.getByLabel("Schedule"), /Weekly/i);
    await saveProgram(page).click();
    await toast(page, "Program saved");
    await page.reload();
    for (const [label, v] of Object.entries(values))
      await expect(page.getByLabel(label, { exact: true }), label).toHaveValue(v);
    await expect(page.getByLabel("Program terms")).toHaveValue(`Terms ${id}`);
    await expect(page.getByLabel("Visibility")).toContainText(/Private/);
    await expect(page.getByLabel("Credit goes to")).toContainText(/Last click/i);
    await expect(page.getByLabel("Schedule")).toContainText(/Weekly/i);
    // put the website back so later steps (program page, imports) keep a reachable URL
    await page.getByLabel("Website", { exact: true }).fill("http://127.0.0.1:3000");
    await pick(page, page.getByLabel("Visibility"), /Public/);
    await saveProgram(page).click();
    await toast(page, "Program saved");
    await ctx.close();
  });

  test("program: invalid values are rejected with a toast and nothing changes", async ({ browser }) => {
    const { ctx, page } = await asFounder(browser, "program-invalid");
    await page.goto(`${programUrl}/settings`);
    for (const [label, bad] of [
      ["Link parameter", "BAD PARAM!"],
      ["Rate", "abc"],
      ["Cookie window", "9999"],
    ] as const) {
      await page.reload();
      await page.getByLabel(label, { exact: true }).fill(bad);
      await saveProgram(page).click();
      // either the browser blocks it (min/max/pattern) or the server answers with a toast
      const native = await page
        .getByLabel(label, { exact: true })
        .evaluate((e: HTMLInputElement) => !e.validity.valid);
      if (!native) await toast(page, /invalid|check the form/i);
      await page.reload();
      await expect(page.getByLabel(label, { exact: true })).not.toHaveValue(bad);
    }
    await ctx.close();
  });

  test("program: website must be http(s), javascript: URLs are rejected (stored XSS on /p/[slug])", async ({
    browser,
  }) => {
    const { ctx, page } = await asFounder(browser, "program-js-url");
    await page.goto(`${programUrl}/settings`);
    const before = await page.getByLabel("Website", { exact: true }).inputValue();
    // the input is type=url, which the browser accepts for javascript: too
    await page.getByLabel("Website", { exact: true }).fill("javascript:alert(document.domain)");
    await saveProgram(page).click();
    await page.waitForTimeout(2000);
    await page.reload();
    const after = await page.getByLabel("Website", { exact: true }).inputValue();
    if (after !== before) {
      // put it back so the rest of the suite runs on a sane program
      await page.getByLabel("Website", { exact: true }).fill(before);
      await saveProgram(page).click();
      await toast(page, "Program saved");
    }
    expect(after).toBe(before);
    await ctx.close();
  });

  /* ---------------------------------------------------------------- application form + apply */

  test("application form: add, require, remove questions; partner answers show to the founder", async ({
    browser,
  }) => {
    const { ctx, page } = await asFounder(browser, "application");
    await page.goto(`${programUrl}/settings/application`);
    await expect(page.getByText(`/p/${slug}/apply`).first()).toBeVisible();
    const add = page.getByRole("button", { name: "Add question" });
    for (let i = 0; i < 3; i++) await add.click();
    const qs = page.getByLabel("Question", { exact: true });
    await qs.nth(0).fill("How will you promote us?");
    await qs.nth(1).fill("Audience size");
    await qs.nth(2).fill("Delete me");
    await pick(page, page.getByLabel("Answer type").nth(0), "Long text");
    await page.getByRole("switch", { name: "Required" }).nth(0).click();
    await page.getByRole("button", { name: "Remove question" }).nth(2).click();
    // auto-approve rules
    await page.getByLabel("Max risk score").fill("70");
    await page.getByLabel("Blocked countries").fill("KP, IR");
    await page.getByRole("button", { name: "Save" }).last().click();
    await toast(page, /Saved|Application settings saved/);
    await page.reload();
    await expect(qs).toHaveCount(2);
    await expect(qs.nth(0)).toHaveValue("How will you promote us?");
    await expect(qs.nth(1)).toHaveValue("Audience size");
    await expect(page.getByRole("switch", { name: "Required" }).nth(0)).toHaveAttribute(
      "data-state",
      "checked",
    );
    await expect(page.getByLabel("Max risk score")).toHaveValue("70");
    await expect(page.getByLabel("Blocked countries")).toHaveValue("KP, IR");

    // empty question label is rejected cleanly
    await add.click();
    await page.getByRole("button", { name: "Save" }).last().click();
    await toast(page, /invalid/i);
    await ctx.close();

    // partner applies, required question enforced
    const p = await newPage(browser, "apply");
    await p.page.goto(`/p/${slug}/apply`);
    await p.page.getByLabel("Full name").fill("Apple Applicant");
    await p.page.getByLabel("Email").fill(`apply-${id}@e2e.test`);
    await p.page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await p.page.getByLabel("Website or main channel").fill("https://apple.example");
    await p.page.getByRole("checkbox").check();
    const required = p.page.getByLabel("How will you promote us?");
    expect(await required.evaluate((e: HTMLTextAreaElement) => e.required)).toBe(true);
    await required.fill("Weekly newsletter to 12k founders");
    await p.page.getByLabel("Audience size (optional)").fill("12000");
    for (let i = 0; i < 5; i++) {
      await p.page.getByRole("button", { name: /^(Join and get my link|Send application)$/ }).click();
      const r = await Promise.race([
        p.page.waitForURL(/\/portal/, { timeout: 20_000 }).then(() => "ok"),
        p.page
          .locator('[data-sonner-toast], p[role="alert"]')
          .first()
          .waitFor({ timeout: 20_000 })
          .then(
            async () =>
              (await p.page.locator('[data-sonner-toast], p[role="alert"]').first().textContent()) ?? "",
          ),
      ]);
      if (r === "ok" || /approved|portal is ready|received/i.test(r)) break;
      // 10 applications per hour per IP, shared with every other tester on this machine
      test.skip(
        /Too many applications from this network/.test(r),
        "application rate limit (shared IP) reached",
      );
      if (!/too many/i.test(r)) throw new Error(`apply failed: ${r}`);
      await p.page.waitForTimeout(11_000);
    }
    await p.page.waitForURL(/\/portal/);
    await p.ctx.close();

    const f = await asFounder(browser, "application-answers");
    const [pt] = sql<{ id: string; answers: Record<string, string> }>(
      `select id, answers from partner where email = 'apply-${id}@e2e.test' and program_id = '${programId}'`,
    );
    expect(pt, "application stored").toBeTruthy();
    expect(Object.values(pt!.answers)).toContain("Weekly newsletter to 12k founders");
    await f.page.goto(`${programUrl}/partners/${pt!.id}`);
    await expect(f.page.getByText("Weekly newsletter to 12k founders")).toBeVisible();
    await expect(f.page.getByText("How will you promote us?")).toBeVisible();
    await f.ctx.close();
  });

  /* ---------------------------------------------------------------- import */

  const csvs: Record<string, string> = {
    rewardful: `email,first_name,last_name,token,coupon,paypal_email\nrw-${id}@e2e.test,Rae,Ward,rw${id},RW${id},rw-pp-${id}@e2e.test\n`,
    firstpromoter: `Email,First Name,Last Name,Default Ref Id,Website\nfp-${id}@e2e.test,Fern,Promo,fp${id},https://fp.example\n`,
    tolt: `partner_email,partner_name,referral_code,country\ntl-${id}@e2e.test,Tol Tee,tl${id},de\n`,
    partnerstack: `"Email","Name","Partner Key","Promo Code"\r\nps-${id}@e2e.test,"Stack, Partner",ps${id},PS${id}\r\n`,
  };
  for (const [fmt, csv] of Object.entries(csvs)) {
    test(`import: ${fmt} CSV via file upload`, async ({ browser }) => {
      const { ctx, page } = await asFounder(browser, `import-${fmt}`);
      await page.goto(`${programUrl}/settings/import`);
      await page
        .getByLabel("CSV file")
        .setInputFiles({ name: `${fmt}.csv`, mimeType: "text/csv", buffer: Buffer.from(csv) });
      await expect(page.getByLabel("CSV contents")).not.toHaveValue("");
      await page.getByRole("button", { name: "Import" }).click();
      await toast(page, "1 partners imported");
      await expect(page.getByText(/Imported 1 and skipped 0/)).toBeVisible();
      // re-import is idempotent
      await page.getByRole("button", { name: "Import" }).click();
      await expect(page.getByText(/Imported 0 and skipped 1/)).toBeVisible();
      const pre = { rewardful: "rw", firstpromoter: "fp", tolt: "tl", partnerstack: "ps" }[fmt]!;
      const rows = sql<{ code: string; name: string }>(
        `select code, name from partner where email = '${pre}-${id}@e2e.test' and program_id = '${programId}'`,
      );
      expect(rows).toHaveLength(1);
      // old referral codes are kept so links already shared keep working
      expect(rows[0]!.code).toBe(`${pre}${id}`);
      await ctx.close();
    });
  }

  test("import: Excel CSV with a UTF-8 BOM still finds the email column", async ({ browser }) => {
    const { ctx, page } = await asFounder(browser, "import-bom");
    await page.goto(`${programUrl}/settings/import`);
    await page.getByLabel("CSV file").setInputFiles({
      name: "excel.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(`${String.fromCharCode(0xfeff)}email,name\nbom-${id}@e2e.test,Bo M\n`),
    });
    await expect(page.getByLabel("CSV contents")).not.toHaveValue("");
    await page.getByRole("button", { name: "Import" }).click();
    await toast(page, "1 partners imported");
    await ctx.close();
  });

  test("import: a file without an email column fails with a clear message", async ({ browser }) => {
    const { ctx, page } = await asFounder(browser, "import-bad");
    await page.goto(`${programUrl}/settings/import`);
    await page.getByLabel("CSV contents").fill("name,code\nNo Mail,nomail");
    await page.getByRole("button", { name: "Import" }).click();
    await toast(page, /No email column found/);
    await page.getByLabel("CSV contents").fill("email");
    await page.getByRole("button", { name: "Import" }).click();
    await toast(page, /header row and at least one partner/);
    await ctx.close();
  });

  /* ---------------------------------------------------------------- branding, portal, domain */

  test("branding: color, logo, headline, preview, persistence and public page", async ({ browser }) => {
    const { ctx, page } = await asFounder(browser, "branding");
    await page.goto(`${programUrl}/settings/branding`);
    await page.locator("#br-color").fill("#12a37f");
    await page.getByLabel("Logo URL").fill("http://localhost:3000/favicon.ico");
    await page.getByLabel("Headline").fill(`Earn with us ${id}`);
    await page.getByLabel("Description").fill("A short pitch for partners.");
    const preview = page.getByText("Join the program", { exact: true });
    await expect(preview).toHaveCSS("background-color", "rgb(18, 163, 127)");
    await expect(page.locator('img[src="http://localhost:3000/favicon.ico"]')).toHaveCount(1);
    await page.getByRole("button", { name: "Save", exact: true }).first().click();
    await toast(page, "Branding saved");
    await page.reload();
    await expect(page.locator("#br-color")).toHaveValue("#12A37F");
    await expect(page.getByLabel("Headline")).toHaveValue(`Earn with us ${id}`);
    await page.goto(`/p/${slug}`);
    await expect(page.getByText(`Earn with us ${id}`).first()).toBeVisible();
    await ctx.close();
  });

  test("branding: bad color and non-http logo are rejected", async ({ browser }) => {
    const { ctx, page } = await asFounder(browser, "branding-invalid");
    await page.goto(`${programUrl}/settings/branding`);
    await page.locator("#br-color").fill("red");
    await page.getByRole("button", { name: "Save", exact: true }).first().click();
    await toast(page, /invalid/i);
    await page.reload();
    await page.getByLabel("Logo URL").fill("javascript:alert(1)");
    await page.getByRole("button", { name: "Save", exact: true }).first().click();
    const t = await toast(page, /invalid|Branding saved/i);
    if (/Branding saved/.test((await t.textContent()) ?? "")) {
      await page.reload();
      await page.getByLabel("Logo URL").fill("http://localhost:3000/favicon.ico");
      await page.getByRole("button", { name: "Save", exact: true }).first().click();
      await toast(page, "Branding saved");
    }
    expect(await t.textContent().catch(() => "accepted")).toMatch(/invalid/i);
    await ctx.close();
  });

  test("portal & domain: validation, save, CNAME shown, verify fails cleanly, marketplace", async ({
    browser,
  }) => {
    const { ctx, page } = await asFounder(browser, "domain");
    await page.goto(`${programUrl}/settings/branding`);
    const domain = page.getByLabel("Domain", { exact: true });
    await domain.fill("not a domain");
    await page.getByRole("button", { name: "Save", exact: true }).nth(1).click();
    await toast(page, /Enter a domain like/);
    await domain.fill(`https://partners-${id}.e2e.test/path`);
    await page.getByRole("button", { name: "Save", exact: true }).nth(1).click();
    await toast(page, /Domain saved/);
    await page.reload();
    await expect(domain).toHaveValue(`partners-${id}.e2e.test`);
    await expect(page.getByText("CNAME", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Verify DNS" }).click();
    await toast(page, /No CNAME to/);
    // clear it again
    await domain.fill("");
    await page.getByRole("button", { name: "Save", exact: true }).nth(1).click();
    await toast(page, /Domain saved/);
    // marketplace listing + category
    await page.getByRole("switch", { name: "List in partner marketplace" }).click();
    await toast(page, "Listed in the partner marketplace");
    await page.getByLabel("Category").click();
    await page.getByRole("option").nth(1).click();
    await toast(page, "Category saved");
    await page.reload();
    await expect(page.getByRole("switch", { name: "List in partner marketplace" })).toHaveAttribute(
      "data-state",
      "checked",
    );
    await page.getByRole("switch", { name: "List in partner marketplace" }).click();
    await toast(page, "Removed from the partner marketplace");
    await ctx.close();
  });

  /* ---------------------------------------------------------------- install */

  test("install: snippet, status checklist and a way to re-check", async ({ browser }) => {
    const { ctx, page } = await asFounder(browser, "install");
    await page.goto(`${programUrl}/settings/install`);
    const script = page.locator("pre", { hasText: "data-program" }).first();
    await expect(script).toContainText(`data-program="${slug}"`);
    await expect(script).toContainText("/op.js");
    await expect(page.getByText("Not seen yet")).toBeVisible();
    await expect(page.getByText("Script seen on your site")).toBeVisible();
    // the brief asks for a check button; the onboarding step polls, settings has none
    await expect(page.getByRole("button", { name: /check|verify|re-check/i })).toBeVisible();
    await ctx.close();
  });

  /* ---------------------------------------------------------------- integrations */

  test("integrations: Stripe garbage key rejected, webhook secret saves", async ({ browser }) => {
    const { ctx, page } = await asFounder(browser, "int-stripe");
    await page.goto(`${programUrl}/settings/integrations`);
    await page.getByLabel("Restricted key").fill("garbage");
    await page.getByRole("button", { name: "Connect" }).first().click();
    await toast(page, /doesn't look like a Stripe/);
    await page.getByLabel("Restricted key").fill("");
    await page.getByLabel("Webhook signing secret").fill("whsec_e2e_local_test_secret");
    await page.getByRole("button", { name: "Connect" }).first().click();
    await toast(page, /Stripe connected|Done/);
    await page.reload();
    await expect(page.getByText(/Connected · test/).first()).toBeVisible();
    await ctx.close();
  });

  test("integrations: delete test data", async ({ browser }) => {
    const { ctx, page } = await asFounder(browser, "int-testdata");
    page.on("dialog", (d) => d.accept());
    await page.goto(`${programUrl}/settings/integrations`);
    await page.getByRole("button", { name: "Delete test data" }).click();
    await toast(page, "Test data deleted");
    await ctx.close();
  });

  for (const p of ["paddle", "lemonsqueezy", "polar", "chargebee"] as const) {
    test(`integrations: ${p} secret validation, save, disconnect`, async ({ browser }) => {
      const { ctx, page } = await asFounder(browser, `int-${p}`);
      page.on("dialog", (d) => d.accept());
      await page.goto(`${programUrl}/settings/integrations`);
      const input = page.getByLabel(`${p} webhook secret`);
      const card = page
        .locator("div", { has: input })
        .filter({ has: page.getByRole("button", { name: "Save" }) })
        .last();
      await input.fill("short");
      await card.getByRole("button", { name: "Save" }).click();
      await toast(page, /invalid/i);
      await input.fill(p === "chargebee" ? "e2euser:e2e-password-long" : `secret_${p}_${id}_e2e`);
      await card.getByRole("button", { name: "Save" }).click();
      await toast(page, "Connected");
      await page.reload();
      await expect(card.getByRole("button", { name: "Disconnect" })).toBeVisible();
      await card.getByRole("button", { name: "Disconnect" }).click();
      await toast(page, "Disconnected");
      await page.reload();
      await expect(card.getByRole("button", { name: "Disconnect" })).toHaveCount(0);
      await ctx.close();
    });
  }

  test("integrations: PayPal rejects garbage credentials cleanly", async ({ browser }) => {
    const { ctx, page } = await asFounder(browser, "int-paypal");
    await page.goto(`${programUrl}/settings/integrations`);
    await page.getByLabel("PayPal client ID").fill("x");
    await page.getByLabel("PayPal secret").fill("y");
    await page.getByRole("button", { name: "Save" }).nth(4).click();
    await toast(page, /invalid/i);
    // plausible-looking but fake: the app saves it without asking PayPal, then reports "connected"
    await page.reload();
    await page.getByLabel("PayPal client ID").fill("garbage-client-id");
    await page.getByLabel("PayPal secret").fill("garbage-secret");
    await page.getByRole("button", { name: "Save" }).nth(4).click();
    await toast(page, /invalid|could not|rejected|failed|credentials/i);
    await ctx.close();
  });

  test("integrations: Wise rejects garbage token and bad currency cleanly", async ({ browser }) => {
    const { ctx, page } = await asFounder(browser, "int-wise");
    await page.goto(`${programUrl}/settings/integrations`);
    await page.getByLabel("Wise API token").fill("short");
    await page.getByLabel("Wise profile ID").fill("1");
    await page.getByRole("button", { name: "Save" }).nth(5).click();
    await toast(page, /invalid/i);
    await page.reload();
    await page.getByLabel("Wise API token").fill("garbage-token-garbage");
    await page.getByLabel("Wise profile ID").fill("1");
    await page.getByLabel("Wise balance currency to pay from").fill("U$");
    await page.getByRole("button", { name: "Save" }).nth(5).click();
    await toast(page, /invalid|currency/i);
    await page.reload();
    await page.getByLabel("Wise API token").fill("garbage-token-garbage");
    await page.getByLabel("Wise profile ID").fill("1");
    await page.getByLabel("Wise balance currency to pay from").fill("USD");
    await page.getByRole("button", { name: "Save" }).nth(5).click();
    await toast(page, /invalid|could not|rejected|failed|token/i);
    await ctx.close();
  });

  /* ---------------------------------------------------------------- developers: API keys + webhooks */

  test("API keys: create, shown once, works against /api/v1, revoke stops it", async ({ browser }) => {
    const { ctx, page } = await asFounder(browser, "api-keys");
    page.on("dialog", (d) => d.accept());
    await page.goto(`${programUrl}/settings/developers`);
    await page.getByRole("button", { name: "New key" }).click();
    await page.getByLabel("Name").fill(`ci-${id}`);
    await page.getByRole("button", { name: "Create key" }).click();
    await toast(page, /API key created/);
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("This is the only time it's shown.")).toBeVisible();
    const key = (
      (await dialog
        .getByText(/^op_sk_/)
        .first()
        .textContent()) ?? ""
    ).trim();
    expect(key).toMatch(/^op_sk_/);
    await page.keyboard.press("Escape");
    await expect(page.getByText(`ci-${id}`)).toBeVisible();
    expect(await page.content()).not.toContain(key);

    const ok = await page.request.get("/api/v1/programs", { headers: { authorization: `Bearer ${key}` } });
    expect(ok.status()).toBe(200);
    // reopening the dialog shows a fresh form, never the old key
    await page.getByRole("button", { name: "New key" }).click();
    await expect(page.getByRole("button", { name: "Create key" })).toBeVisible();
    await page.keyboard.press("Escape");

    await page
      .locator("li", { hasText: `ci-${id}` })
      .getByRole("button", { name: "Revoke" })
      .click();
    await toast(page, "Key revoked");
    await expect(page.getByText(`ci-${id}`)).toHaveCount(0);
    const gone = await page.request.get("/api/v1/programs", { headers: { authorization: `Bearer ${key}` } });
    expect(gone.status()).toBe(401);
    await ctx.close();
  });

  test("webhooks: add endpoint, test event is delivered signed; Slack and Discord get text; delete", async ({
    browser,
  }) => {
    const got: { path: string; headers: http.IncomingHttpHeaders; body: string }[] = [];
    const server = http.createServer((req, res) => {
      let b = "";
      req.on("data", (c) => (b += c));
      req.on("end", () => {
        got.push({ path: req.url!, headers: req.headers, body: b });
        res.end("ok");
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as AddressInfo).port;
    const { ctx, page } = await asFounder(browser, "webhooks");
    await page.goto(`${programUrl}/settings/developers`);

    // invalid scheme
    await page.getByRole("button", { name: "Add endpoint" }).click();
    await page.getByLabel("URL").fill("ftp://127.0.0.1/hook");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await toast(page, /http|invalid/i);
    await page.keyboard.press("Escape");

    for (const [kind, label] of [
      ["webhook", /Webhook \(JSON, signed\)/],
      ["slack", "Slack incoming webhook"],
      ["discord", "Discord webhook"],
    ] as const) {
      await page.getByRole("button", { name: "Add endpoint" }).click();
      await pick(page, page.getByLabel("Type"), label);
      await page.getByLabel("URL").fill(`http://127.0.0.1:${port}/${kind}`);
      await page.getByRole("button", { name: "Add", exact: true }).click();
      await toast(page, "Endpoint added");
      await expect(page.getByText(`http://127.0.0.1:${port}/${kind}`)).toBeVisible();
      await page
        .locator("li", { hasText: `127.0.0.1:${port}/${kind}` })
        .getByRole("button", { name: "Test" })
        .click();
      await toast(page, "Test event queued");
    }
    await expect
      .poll(() => got.map((g) => g.path).sort(), { timeout: 30_000 })
      .toEqual(["/discord", "/slack", "/webhook"]);
    const wh = got.find((g) => g.path === "/webhook")!;
    expect(wh.headers["openpromoter-signature"]).toMatch(/t=\d+,v1=[0-9a-f]+/);
    expect(JSON.parse(wh.body).type).toBe("commission.created");
    expect(JSON.parse(got.find((g) => g.path === "/slack")!.body).text).toBeTruthy();
    expect(JSON.parse(got.find((g) => g.path === "/discord")!.body).content).toBeTruthy();
    await page.reload();
    await expect(page.getByText("Recent deliveries")).toBeVisible();

    for (const kind of ["slack", "discord"]) {
      await page
        .locator("li", { hasText: `127.0.0.1:${port}/${kind}` })
        .getByRole("button", { name: "Delete endpoint" })
        .click();
      await toast(page, "Endpoint removed");
    }
    await expect(page.getByText(`127.0.0.1:${port}/slack`)).toHaveCount(0);
    server.close();
    await ctx.close();
  });

  /* ---------------------------------------------------------------- programs */

  test("programs: create a second program, switch between them", async ({ browser }) => {
    const { ctx, page } = await asFounder(browser, "programs");
    await page.goto(`${programUrl}/settings/programs`);
    await page.getByLabel("Website").fill("http://127.0.0.1:3000");
    await page.getByLabel("Name", { exact: true }).fill(`Second ${id}`);
    await page.getByRole("button", { name: "Create program" }).click();
    await page.waitForURL(/\/onboarding\?program=prg_.*step=3/);
    const second = new URL(page.url()).searchParams.get("program")!;
    await page.goto(`/app/${second}/settings/programs`);
    await expect(page.getByRole("link", { name: `Second ${id}` })).toBeVisible();
    const [{ name: firstName }] = sql<{ name: string }>(
      `select name from program where id = '${programId}'`,
    ) as [{ name: string }];
    await expect(page.getByRole("link", { name: firstName })).toBeVisible();
    await page.getByRole("button", { name: "Switch program" }).click();
    await page.getByRole("menuitem", { name: firstName }).click();
    await page.waitForURL(new RegExp(`${programId}$`));
    await page.getByRole("button", { name: "Switch program" }).click();
    await page.getByRole("menuitem", { name: new RegExp(`Second ${id}`) }).click();
    await page.waitForURL(new RegExp(`${second}$`));
    await ctx.close();
  });

  test("programs: a program can be deleted", async ({ browser }) => {
    const { ctx, page } = await asFounder(browser, "programs-delete");
    await page.goto(`${programUrl}/settings/programs`);
    await expect(page.getByRole("button", { name: /delete|archive/i })).toBeVisible({ timeout: 5000 });
    await ctx.close();
  });

  /* ---------------------------------------------------------------- billing (self-host) */

  test("billing: hidden from nav in self-host mode and the page itself does not error", async ({
    browser,
  }) => {
    const { ctx, page } = await asFounder(browser, "billing");
    await page.goto(`${programUrl}/settings`);
    await expect(page.getByRole("navigation", { name: "Settings" }).getByText("Plan & billing")).toHaveCount(
      0,
    );
    const res = await page.goto(`${programUrl}/settings/billing`);
    expect(res!.status()).toBeLessThan(500);
    await ctx.close();
  });
});

/* ======================================================================== team + permissions */

test.describe("team", () => {
  const people = {
    admin: { name: "Ada Admin", email: `ada-${id}@e2e.test` },
    finance: { name: "Fin Finance", email: `fin-${id}@e2e.test` },
    viewer: { name: "Vic Viewer", email: `vic-${id}@e2e.test` },
  };

  test("invite admin, finance and viewer; each accepts in a fresh browser", async ({ browser }) => {
    const { ctx, page } = await asFounder(browser, "team-invite");
    await page.goto(`${programUrl}/settings/team`);
    const sent = Date.now() - 2000;
    for (const [role, who] of Object.entries(people)) {
      await page.getByLabel("Email", { exact: true }).fill(who.email);
      await pick(page, page.getByLabel("Role", { exact: true }), new RegExp(`^${role}:`, "i"));
      await page.getByRole("button", { name: "Send invite" }).click();
      await toast(page, "Invitation sent");
      await expect(page.locator("li", { hasText: who.email })).toContainText("Invited");
    }
    // invalid email
    await page.getByLabel("Email", { exact: true }).fill("nope@");
    await page.getByRole("button", { name: "Send invite" }).click();
    await expect(page.locator("li", { hasText: "nope@" })).toHaveCount(0);
    await ctx.close();

    for (const [role, who] of Object.entries(people)) {
      const link = await mailLink(who.email, /Join .* on OpenPromoter/, /\/invite\//, sent);
      const token = new URL(link).pathname;
      const m = await newPage(browser, `accept-${role}`);
      await m.page.goto(token);
      await m.page.waitForURL(/\/login\?next=/);
      await signUp(
        m.page,
        who.name,
        who.email,
        PASSWORD,
        `?next=${encodeURIComponent(token)}&email=${encodeURIComponent(who.email)}`,
      );
      // accepting must land in the program, not on "Invitation problem"
      await m.page.waitForLoadState("load");
      await m.page.waitForTimeout(1500);
      expect.soft(m.page.url(), `${role} landing after accept`).toContain(programId);
      expect
        .soft(
          await m.page.getByText("Invitation problem").count(),
          `${role} sees an error after a successful accept`,
        )
        .toBe(0);
      await m.page.goto(programUrl);
      await expect(m.page).toHaveURL(new RegExp(programId));
      await m.ctx.storageState({ path: `${STATE}/${role}.json` });
      await m.ctx.close();
    }

    const f = await asFounder(browser, "team-list");
    await f.page.goto(`${programUrl}/settings/team`);
    await expect(f.page.getByText("4 members")).toBeVisible();
    for (const [role, who] of Object.entries(people))
      await expect(f.page.getByLabel(`Role for ${who.name}`)).toContainText(new RegExp(role, "i"));
    await f.ctx.close();
  });

  test("an invitation cannot be accepted by a different account or twice", async ({ browser }) => {
    const { ctx, page } = await asFounder(browser, "team-wrong-user");
    await page.goto(`${programUrl}/settings/team`);
    const email = `other-${id}@e2e.test`;
    const sent = Date.now() - 2000;
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByRole("button", { name: "Send invite" }).click();
    await toast(page, "Invitation sent");
    await ctx.close();
    const link = new URL(await mailLink(email, /Join/, /\/invite\//, sent)).pathname;
    const v = await newPage(browser, "team-wrong-user-viewer", `${STATE}/viewer.json`);
    await v.page.goto(link);
    await expect(v.page.getByText(`This invitation is for ${email}`)).toBeVisible();
    await v.page.goto("/invite/not-a-real-token");
    await expect(v.page.getByText(/invalid or expired/)).toBeVisible();
    await v.ctx.close();
  });

  test("viewer: settings are read only and replayed admin actions are refused by the server", async ({
    browser,
  }) => {
    const owner = await asFounder(browser, "perm-owner");
    await owner.page.goto(`${programUrl}/settings/branding`);
    const branding = await captureAction(owner.page, () =>
      owner.page.getByRole("button", { name: "Save", exact: true }).first().click(),
    );
    await toast(owner.page, "Branding saved");
    await owner.page.goto(`${programUrl}/settings/team`);
    await owner.page.getByLabel("Email", { exact: true }).fill(`replay-${id}@e2e.test`);
    const invite = await captureAction(owner.page, () =>
      owner.page.getByRole("button", { name: "Send invite" }).click(),
    );
    await toast(owner.page, "Invitation sent");
    await owner.ctx.close();

    for (const role of ["viewer", "finance"] as const) {
      const v = await newPage(browser, `perm-${role}`, `${STATE}/${role}.json`);
      for (const path of ["", "/application", "/branding", "/integrations", "/developers", "/team"]) {
        await v.page.goto(`${programUrl}/settings${path}`);
        // disabled controls are fine, enabled ones are not
        await expect(
          v.page.locator("button:not([disabled])").filter({
            hasText: /^\s*(Save|Send invite|New key|Add endpoint|Add question|Connect|Delete test data)\s*$/,
          }),
          `${role} on settings${path}`,
        ).toHaveCount(0);
      }
      for (const a of [branding, invite]) {
        const r = await replayAction(v.ctx, a);
        expect(r.status).toBeLessThan(500);
        expect(r.text).toContain(`Your role (${role}) cannot do this`);
      }
      await v.ctx.close();
    }
  });

  test("viewer cannot see outgoing webhook signing secrets in the page payload", async ({ browser }) => {
    const v = await newPage(browser, "perm-secret", `${STATE}/viewer.json`);
    await v.page.goto(`${programUrl}/settings/developers`);
    await expect(v.page.getByText(/127\.0\.0\.1:\d+\/webhook/)).toBeVisible();
    const html = await (await v.ctx.request.get(`${programUrl}/settings/developers`)).text();
    expect(html).not.toMatch(/whsec_[A-Za-z0-9_-]{10,}/);
    await v.ctx.close();
  });

  test("admin: can manage settings but not add owners or change an owner; payout setup matches what the UI offers", async ({
    browser,
  }) => {
    const a = await newPage(browser, "perm-admin", `${STATE}/admin.json`);
    await a.page.goto(`${programUrl}/settings/team`);
    await pick(a.page, a.page.getByLabel("Role", { exact: true }), /^Owner:/);
    await a.page.getByLabel("Email", { exact: true }).fill(`own-${id}@e2e.test`);
    await a.page.getByRole("button", { name: "Send invite" }).click();
    await toast(a.page, "Only owners can add owners");
    await pick(a.page, a.page.getByLabel(`Role for ${founder.name}`), "Viewer");
    await toast(a.page, "Only owners can change an owner's role");
    await settle(a.page);
    await pick(a.page, a.page.getByLabel(`Role for ${people.viewer.name}`), "Owner");
    await toast(a.page, "Only owners can make owners");

    // the integrations page gives admins enabled PayPal/Wise Save buttons; they must work or be hidden
    await a.page.goto(`${programUrl}/settings/integrations`);
    const save = a.page.getByRole("button", { name: "Save" }).nth(4);
    if (await save.isEnabled()) {
      await a.page.getByLabel("PayPal client ID").fill("x");
      await a.page.getByLabel("PayPal secret").fill("y");
      await save.click();
      const t = await toast(a.page, /./);
      await expect(t).not.toContainText("cannot do this");
    }
    await a.ctx.close();
  });

  test("owner changes a role and removes a member; removed member loses access", async ({ browser }) => {
    const { ctx, page } = await asFounder(browser, "team-role");
    await page.goto(`${programUrl}/settings/team`);
    await pick(page, page.getByLabel(`Role for ${people.viewer.name}`), "Finance");
    await toast(page, "Team updated");
    await settle(page);
    await page.reload();
    await expect(page.getByLabel(`Role for ${people.viewer.name}`)).toContainText("Finance");
    await pick(page, page.getByLabel(`Role for ${people.viewer.name}`), "Viewer");
    await toast(page, "Team updated");
    await settle(page);
    await pick(page, page.getByLabel(`Role for ${people.finance.name}`), "Remove");
    await toast(page, "Team updated");
    await settle(page);
    await page.reload();
    await expect(page.getByText(people.finance.email)).toHaveCount(0);
    // owner cannot demote themself as the last owner: their own row has no select
    await expect(page.getByLabel(`Role for ${founder.name}`)).toHaveCount(0);
    await ctx.close();

    const gone = await newPage(browser, "team-removed", `${STATE}/finance.json`);
    const res = await gone.page.goto(`${programUrl}/settings`);
    expect(res!.status()).toBe(404);
    await gone.ctx.close();
  });

  test("audit log lists the actions taken above", async ({ browser }) => {
    const { ctx, page } = await asFounder(browser, "audit");
    await page.goto(`${programUrl}/settings/audit`);
    for (const action of [
      "program.update",
      "program.application_update",
      "program.domain",
      "program.network",
      "partner.import",
      "api_key.create",
      "api_key.revoke",
      "webhook.create",
      "billing.disconnect",
      "member.invite",
      "member.join",
      "member.role",
      "program.delete_test_data",
    ])
      await expect
        .soft(page.getByRole("cell", { name: action, exact: true }).first(), action)
        .toBeVisible({ timeout: 3000 });
    // these settings changes are not audited today
    for (const action of [/branding/, /webhook\.delete|endpoint/, /webhook_secret|provider/])
      await expect
        .soft(page.getByRole("cell", { name: action }).first(), String(action))
        .toBeVisible({ timeout: 3000 });
    const exp = await page.request.get(`/api/export/audit?program=${programId}`);
    expect(exp.status()).toBe(200);
    expect(await exp.text()).toContain("program.update");
    await ctx.close();
  });
});

/* ======================================================================== account */

test.describe("account", () => {
  const acct = { name: "Andy Account", email: `andy-${id}@e2e.test` };

  test("setup: account owner", async ({ browser }) => {
    const { ctx, page } = await newPage(browser, "acct-setup");
    acctProgram = await newFounder(page, acct.name, acct.email, `Acctco ${id}`);
    save({ acctProgram });
    await ctx.storageState({ path: `${STATE}/acct.json` });
    await ctx.close();
  });

  test("account: name can be changed from the account page", async ({ browser }) => {
    const { ctx, page } = await newPage(browser, "acct-name", `${STATE}/acct.json`);
    await page.goto(`${acctProgram}/settings/account`);
    await expect(page.getByLabel("Name")).toBeEditable({ timeout: 5000 });
    await ctx.close();
  });

  test("account: password can be changed from the account page", async ({ browser }) => {
    const { ctx, page } = await newPage(browser, "acct-pass-ui", `${STATE}/acct.json`);
    await page.goto(`${acctProgram}/settings/account`);
    await expect(page.getByLabel(/current password/i)).toBeVisible({ timeout: 5000 });
    await ctx.close();
  });

  test("account: change name and password through the auth API, then sign in with the new password", async ({
    browser,
  }) => {
    const { ctx, page } = await newPage(browser, "acct-pass", `${STATE}/acct.json`);
    await page.goto(`${acctProgram}/settings/account`);
    const call = (path: string, body: object) =>
      page.evaluate(
        async ([p, b]) => {
          const r = await fetch(p as string, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(b),
          });
          return { status: r.status, text: await r.text() };
        },
        [path, body] as const,
      );
    expect((await call("/api/auth/update-user", { name: "Andy Renamed" })).status).toBe(200);
    await page.reload();
    await expect(page.getByLabel("Name")).toHaveValue("Andy Renamed");
    let r = await call("/api/auth/change-password", {
      currentPassword: "wrong-one-123",
      newPassword: "x".repeat(12),
    });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(r.status).toBeLessThan(500);
    for (let i = 0; i < 4; i++) {
      r = await call("/api/auth/change-password", {
        currentPassword: PASSWORD,
        newPassword: "changed-pass-321",
      });
      if (r.status !== 429) break;
      await page.waitForTimeout(11_000);
    }
    expect(r.status, r.text).toBe(200);
    await ctx.close();

    const fresh = await newPage(browser, "acct-newpass");
    await signIn(fresh.page, acct.email, "changed-pass-321");
    await fresh.page.waitForURL(/\/app\//);
    await fresh.ctx.storageState({ path: `${STATE}/acct.json` });
    await fresh.ctx.close();
  });

  let secret = "";
  test("2FA: enable with TOTP, sign-in requires the code, disable", async ({ browser }) => {
    const pw = "changed-pass-321";
    const { ctx, page } = await newPage(browser, "2fa", `${STATE}/acct.json`);
    await page.goto(`${acctProgram}/settings/account`);
    // wrong password first
    await page.getByLabel("Password", { exact: true }).fill("wrong-pass-000");
    await page.getByRole("button", { name: "Set up 2FA" }).click();
    await toast(page, /invalid|password/i);
    const enable = page.waitForResponse((r) => r.url().includes("/two-factor/enable") && r.status() === 200);
    await page.getByLabel("Password", { exact: true }).fill(pw);
    await page.getByRole("button", { name: "Set up 2FA" }).click();
    const uri = ((await (await enable).json()) as { totpURI: string }).totpURI;
    secret = new URL(uri).searchParams.get("secret")!;
    expect(secret).toBeTruthy();
    await expect(page.getByAltText("Scan with your authenticator app")).toBeVisible();
    await expect(page.getByText(/Backup codes/)).toBeVisible();
    await page.getByLabel("Code").fill("000000");
    await page.getByRole("button", { name: "Verify" }).click();
    await toast(page, /invalid|wrong|code/i);
    await page.getByLabel("Code").fill(totp(secret));
    await page.getByRole("button", { name: "Verify" }).click();
    await toast(page, "Two-factor authentication is on");
    await expect(page.getByText("Enabled", { exact: true })).toBeVisible();
    await page.goto(`${acctProgram}/settings/team`);
    await expect(page.getByText("2FA on")).toBeVisible();
    await ctx.close();

    // fresh browser: password is not enough
    const s = await newPage(browser, "2fa-signin");
    await signIn(s.page, acct.email, pw);
    await s.page.waitForURL(/2fa=1/);
    await expect(s.page.getByRole("heading", { name: "Two-factor code" })).toBeVisible();
    const direct = await s.page.goto(`${acctProgram}/settings`);
    expect(new URL(s.page.url()).pathname).toBe("/login");
    expect(direct!.status()).toBeLessThan(500);
    await s.page.goto(`/login?2fa=1&next=${encodeURIComponent(`${acctProgram}/settings/account`)}`);
    await s.page.getByLabel("Code").fill("123456");
    await s.page.getByRole("button", { name: "Verify" }).click();
    await expect(alertOf(s.page)).toBeVisible();
    for (let i = 0; i < 5; i++) {
      await s.page.getByLabel("Code").fill(totp(secret));
      await s.page.getByRole("button", { name: "Verify" }).click();
      const ok = await s.page.waitForURL(/\/settings\/account/, { timeout: 8000 }).then(
        () => true,
        () => false,
      );
      if (ok) break;
      await s.page.waitForTimeout(11_000);
    }
    await s.page.waitForURL(/\/settings\/account/);

    // disable
    await s.page.getByLabel("Password", { exact: true }).fill("wrong-pass-000");
    await s.page.getByRole("button", { name: "Disable 2FA" }).click();
    await toast(s.page, /invalid|password/i);
    await s.page.getByLabel("Password", { exact: true }).fill(pw);
    await s.page.getByRole("button", { name: "Disable 2FA" }).click();
    await toast(s.page, "2FA disabled");
    await expect(s.page.getByRole("button", { name: "Set up 2FA" })).toBeVisible();
    await s.ctx.storageState({ path: `${STATE}/acct.json` });
    await s.ctx.close();

    const again = await newPage(browser, "2fa-off-signin");
    await signIn(again.page, acct.email, pw);
    await again.page.waitForURL(/\/app\//);
    await again.ctx.close();
  });

  test("data export: personal and workspace", async ({ browser }) => {
    const { ctx, page } = await newPage(browser, "export", `${STATE}/acct.json`);
    await page.goto(`${acctProgram}/settings/account`);
    const dl = page.waitForEvent("download");
    await page.getByRole("link", { name: "Export my data" }).click();
    const file = await dl;
    expect(file.suggestedFilename()).toBe("openpromoter-data.json");
    const data = JSON.parse(await (await import("node:fs/promises")).readFile((await file.path())!, "utf8"));
    expect(data.user.email).toBe(acct.email);
    expect(JSON.stringify(data)).not.toMatch(/"password"|twoFactorSecret|"secret"/);
    const ws = await page.getByRole("link", { name: "Export the whole workspace" }).getAttribute("href");
    const wsRes = await page.request.get(ws!);
    expect(wsRes.status()).toBe(200);
    // signed-out export is refused
    const anon = await (await newPage(browser, "export-anon")).ctx.request.get("/api/account/export");
    expect(anon.status()).toBe(401);
    await ctx.close();
  });

  test("delete account: wrong password refused, right password deletes and signs out", async ({
    browser,
  }) => {
    const { ctx, page } = await newPage(browser, "delete", `${STATE}/acct.json`);
    await page.goto(`${acctProgram}/settings/account`);
    page.once("dialog", (d) => d.accept("wrong-pass-000"));
    await page.getByRole("button", { name: "Delete my account" }).click();
    await toast(page, /invalid|password/i);
    page.once("dialog", (d) => d.accept("changed-pass-321"));
    await page.getByRole("button", { name: "Delete my account" }).click();
    await page.waitForURL(/\/login/);
    await ctx.close();

    const s = await newPage(browser, "delete-signin");
    for (let i = 0; i < 4; i++) {
      await s.page.goto("/login");
      await s.page.getByLabel("Email").fill(acct.email);
      await s.page.getByLabel("Password", { exact: true }).fill("changed-pass-321");
      await s.page.getByRole("button", { name: "Sign in" }).click();
      const t = (await alertOf(s.page).textContent()) ?? "";
      if (!/too many/i.test(t)) break;
      await s.page.waitForTimeout(11_000);
    }
    await expect(alertOf(s.page)).toHaveText(/invalid email or password/i);
    await s.ctx.close();
  });

  test("delete account: the sole owner's workspace is not left live with no owner", async () => {
    const prg = acctProgram.split("/").pop()!;
    const rows = sql<{ members: number; programs: number }>(
      `select (select count(*)::int from member m where m.workspace_id = p.workspace_id) as members,
              (select count(*)::int from program x where x.workspace_id = p.workspace_id) as programs
         from program p where p.id = '${prg}'`,
    );
    // either the workspace went with its only owner, or someone still owns it
    if (rows.length) expect(rows[0]!.members, "program still live with zero members").toBeGreaterThan(0);
  });
});

/* ======================================================================== mobile */

test.describe("mobile 390px", () => {
  for (const path of [
    "",
    "/application",
    "/import",
    "/branding",
    "/install",
    "/integrations",
    "/developers",
    "/team",
    "/audit",
    "/programs",
    "/account",
  ]) {
    test(`settings${path || "/"} has no horizontal scroll at 390px`, async ({ browser }) => {
      const ctx = await browser.newContext({
        storageState: `${STATE}/founder.json`,
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      });
      const page = watch(await ctx.newPage(), `mobile${path}`);
      await page.goto(`${programUrl}/settings${path}`);
      await page.waitForLoadState("load");
      const { sw, cw } = await page.evaluate(() => ({
        sw: document.documentElement.scrollWidth,
        cw: document.documentElement.clientWidth,
      }));
      expect(sw, `scrollWidth ${sw} > ${cw}`).toBeLessThanOrEqual(cw);
      await ctx.close();
    });
  }
});

test("no console errors, page errors or 5xx responses anywhere above", () => {
  expect(problems()).toEqual([]);
});
