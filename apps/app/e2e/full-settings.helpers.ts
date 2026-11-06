import { createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Browser, BrowserContext, Page } from "@playwright/test";

export const PASSWORD = "e2e-password-123";
export const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const MAILPIT = process.env.MAILPIT_URL ?? "http://localhost:8025";

/* ------------------------------------------------------------------ quality guard */

/**
 * Console errors, page errors and 5xx responses seen anywhere in the suite, checked by the last test.
 * Kept in a file because Playwright starts a new worker after every failing test.
 */
const PROBLEMS = () =>
  process.env.FULL_SETTINGS_PROBLEMS ?? path.join(os.tmpdir(), "op-full-settings-problems.log");
const report = (line: string) => {
  fs.mkdirSync(path.dirname(PROBLEMS()), { recursive: true });
  fs.appendFileSync(PROBLEMS(), `${line.replace(/\n/g, " ")}\n`);
};
export const problems = () =>
  fs.existsSync(PROBLEMS()) ? fs.readFileSync(PROBLEMS(), "utf8").split("\n").filter(Boolean) : [];

export function watch(page: Page, label: string) {
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    // the browser logs every non-2xx fetch; 4xx from negative tests are expected, 5xx are caught below
    if (/Failed to load resource: the server responded with a status of 4\d\d/.test(t)) return;
    // fallout of the open-redirect probes (evil.com is stubbed), reported by their own tests
    if (t.includes("evil.com")) return;
    report(`[${label}] console: ${page.url()} ${t.slice(0, 300)}`);
  });
  page.on("pageerror", (e) => report(`[${label}] pageerror: ${page.url()} ${e.message.slice(0, 300)}`));
  page.on("response", (r) => {
    if (r.status() >= 500) report(`[${label}] HTTP ${r.status()}: ${r.request().method()} ${r.url()}`);
  });
  return page;
}

export async function newPage(browser: Browser, label: string, storageState?: string) {
  const ctx = await browser.newContext(storageState ? { storageState } : {});
  // never let a test reach the real internet (open-redirect probes land here)
  await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (r) =>
    r.fulfill({ status: 200, contentType: "text/html", body: "<h1>OFFSITE</h1>" }),
  );
  const page = watch(await ctx.newPage(), label);
  return { ctx, page };
}

/* ------------------------------------------------------------------ auth (rate limited: 3 per 10 s per IP) */

async function retrying(page: Page, attempt: () => Promise<"ok" | "limited" | string>) {
  for (let i = 0; i < 6; i++) {
    const r = await attempt();
    if (r === "ok") return;
    if (r !== "limited") throw new Error(r);
    await page.waitForTimeout(11_000);
  }
  throw new Error("still rate limited after 6 tries");
}

const LIMITED = /too many|rate limit|try again later/i;

export async function signUp(page: Page, name: string, email: string, password = PASSWORD, query = "") {
  await retrying(page, async () => {
    await page.goto(`/signup${query}`);
    await page.getByLabel("Name").fill(name);
    await page.getByLabel("Work email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Create account" }).click();
    const alert = page.getByRole("alert").filter({ hasText: /\S/ });
    const r = await Promise.race([
      page.waitForURL((u) => !u.pathname.startsWith("/signup"), { timeout: 20_000 }).then(() => "ok"),
      alert.waitFor({ timeout: 20_000 }).then(async () => (await alert.textContent()) ?? "error"),
    ]);
    return r === "ok" ? "ok" : LIMITED.test(r) ? "limited" : `signup failed: ${r}`;
  });
}

export async function signIn(page: Page, email: string, password = PASSWORD, next?: string) {
  await retrying(page, async () => {
    await page.goto(next ? `/login?next=${encodeURIComponent(next)}` : "/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    const alert = page.getByRole("alert").filter({ hasText: /\S/ });
    const r = await Promise.race([
      page
        .waitForURL(
          (u) =>
            u.pathname !== "/login" || u.searchParams.get("2fa") === "1" || u.host !== new URL(BASE).host,
          { timeout: 20_000 },
        )
        .then(() => "ok"),
      alert.waitFor({ timeout: 20_000 }).then(async () => (await alert.textContent()) ?? "error"),
    ]);
    return r === "ok" ? "ok" : LIMITED.test(r) ? "limited" : `signin failed: ${r}`;
  });
}

/** Signs up a founder and finishes onboarding (skip Stripe, accept the program, skip install). */
export async function newFounder(page: Page, name: string, email: string, product: string) {
  await signUp(page, name, email);
  await page.waitForURL(/\/onboarding/);
  await page.getByLabel("Website URL").fill("http://127.0.0.1:3000");
  await page.getByLabel("Product name").fill(product);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: /Use Paddle, Lemon Squeezy or Polar instead/ }).click();
  await page.getByRole("button", { name: "Accept this program" }).click();
  await page.getByRole("button", { name: /I'll do this later|Continue/ }).click();
  await page.getByRole("link", { name: "Go to dashboard" }).click();
  await page.waitForURL(/\/app\/prg_/);
  return new URL(page.url()).pathname.match(/^\/app\/prg_[^/]+/)![0];
}

/* ------------------------------------------------------------------ mail (Mailpit catches SMTP in dev) */

export async function mailLink(to: string, subject: RegExp, pathRe: RegExp, after = 0): Promise<string> {
  for (let i = 0; i < 40; i++) {
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}&limit=20`);
    const { messages = [] } = (await res.json()) as {
      messages?: { ID: string; Subject: string; Created: string }[];
    };
    const m = messages.find((x) => subject.test(x.Subject) && Date.parse(x.Created) >= after);
    if (m) {
      const full = (await (await fetch(`${MAILPIT}/api/v1/message/${m.ID}`)).json()) as {
        Text: string;
        HTML: string;
      };
      const urls = `${full.Text}\n${full.HTML}`.match(/https?:\/\/[^\s"'<>)]+/g) ?? [];
      const hit = urls.map((u) => u.replace(/&amp;/g, "&")).find((u) => pathRe.test(u));
      if (hit) return hit;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`no mail to ${to} matching ${subject}`);
}

/* ------------------------------------------------------------------ TOTP (RFC 6238, SHA1, 6 digits, 30 s) */

function base32(s: string) {
  const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of s.replace(/=+$/, "").toUpperCase()) bits += abc.indexOf(c).toString(2).padStart(5, "0");
  const out: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(Number.parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(out);
}

export function totp(secret: string, at = Date.now()) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const h = createHmac("sha1", base32(secret)).update(counter).digest();
  const o = h[h.length - 1]! & 0xf;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

/* ------------------------------------------------------------------ server actions */

export interface CapturedAction {
  url: string;
  headers: Record<string, string>;
  body: string;
}

/** Records the next server action the page posts, so it can be replayed as another user. */
export async function captureAction(page: Page, trigger: () => Promise<unknown>): Promise<CapturedAction> {
  const req = page.waitForRequest((r) => r.method() === "POST" && !!r.headers()["next-action"]);
  await trigger();
  const r = await req;
  const h = r.headers();
  return {
    url: r.url(),
    body: r.postData() ?? "",
    headers: Object.fromEntries(
      ["next-action", "content-type", "accept", "next-router-state-tree"]
        .filter((k) => h[k])
        .map((k) => [k, h[k]!]),
    ),
  };
}

export async function replayAction(ctx: BrowserContext, a: CapturedAction) {
  const res = await ctx.request.post(a.url, {
    headers: { ...a.headers, origin: BASE },
    data: a.body,
  });
  return { status: res.status(), text: await res.text() };
}

export async function toast(page: Page, text: string | RegExp) {
  const t = page.locator("[data-sonner-toast]").filter({ hasText: text });
  await t.first().waitFor({ timeout: 15_000 });
  return t.first();
}
