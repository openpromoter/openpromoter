import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import type { APIRequestContext, Browser, BrowserContext, Page } from "@playwright/test";

/** Scratch folder for state, storage states and nothing else. */
export const SCRATCH = process.env.PARTNER_E2E_DIR ?? path.join(tmpdir(), "openpromoter-partner-e2e");
mkdirSync(SCRATCH, { recursive: true });
const STATE_FILE = path.join(SCRATCH, "state.json");

export const APP = process.env.E2E_BASE_URL ?? "http://localhost:3000";
export const PASSWORD = "e2e-password-123";
export const CHROME_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

export type State = {
  id: string;
  port: number;
  founder: { email: string; ip: string };
  founderB: { email: string; ip: string };
  programPath: string;
  programId: string;
  slug: string;
  webhookUrl: string;
  programPathB: string;
  slugB: string;
  partners: Record<
    string,
    { email: string; name: string; code?: string; linkKey?: string; id?: string; ip: string }
  >;
  [k: string]: unknown;
};

export function loadState(): State {
  if (!existsSync(STATE_FILE)) throw new Error("setup has not run");
  return JSON.parse(readFileSync(STATE_FILE, "utf8"));
}
export function saveState(s: Partial<State>) {
  const cur = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, "utf8")) : {};
  writeFileSync(STATE_FILE, JSON.stringify({ ...cur, ...s }, null, 2));
}
export function patchState(fn: (s: State) => void) {
  const s = loadState();
  fn(s);
  writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}
export const storagePath = (who: string) => path.join(SCRATCH, `storage-${who}.json`);

/** A random private IP: rate limits and Better Auth sign-in limits key on X-Forwarded-For in dev. */
export const randomIp = () =>
  `10.${50 + Math.floor(Math.random() * 150)}.${Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}`;

export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(p));
    });
    s.on("error", reject);
  });
}

/**
 * The founder's "marketing site": one HTML page with op.js. The path picks the mode and program:
 *   /                       plain mode, program A
 *   /<mode>/<slug>[/...]    mode: plain | consent | nostorage | embed
 * Any other path (e.g. /pricing) serves plain mode for program A.
 */
export function startSite(port: number, defaultSlug: () => string) {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
    const [, mode, slug] = u.pathname.split("/");
    const known = ["plain", "consent", "nostorage", "embed"].includes(mode ?? "");
    const m = known ? mode! : "plain";
    const s = known && slug ? slug : defaultSlug();
    if (u.pathname === "/favicon.ico") return void res.writeHead(404).end();
    const attrs =
      m === "consent" ? ' data-consent="required"' : m === "nostorage" ? ' data-storage="none"' : "";
    const embed =
      m === "embed"
        ? `<script src="${APP}/embed.js"></script><openpromoter-dashboard program="${s}" token="${u.searchParams.get("token") ?? ""}"></openpromoter-dashboard>`
        : "";
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(`<!doctype html><html><head><meta charset="utf-8"><title>Site ${m}</title>
<script src="${APP}/op.js" data-program="${s}"${attrs}></script></head>
<body><h1>Founder site (${m})</h1>
<a id="buy" href="https://buy.stripe.com/test_e2e">Buy</a>
<stripe-buy-button id="sbb"></stripe-buy-button>
${embed}
</body></html>`);
  });
  return new Promise<http.Server>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

/**
 * New context with a unique client IP and a normal (non-headless) Chrome UA. The IP header is added by
 * request interception, not extraHTTPHeaders: a custom header on op.js's cross-origin fetch would force a
 * CORS preflight that the tracking endpoints (correctly) don't allow.
 */
export async function newCtx(browser: Browser, opts: { ip?: string; storage?: string; ua?: string } = {}) {
  const ip = opts.ip ?? randomIp();
  const ctx = await browser.newContext({
    userAgent: opts.ua ?? CHROME_UA,
    storageState: opts.storage && existsSync(opts.storage) ? opts.storage : undefined,
    permissions: ["clipboard-read", "clipboard-write"],
    extraHTTPHeaders: {},
  });
  await ctx.route(`${APP}/**`, (route) =>
    route.continue({ headers: { ...route.request().headers(), "x-forwarded-for": ip } }),
  );
  return ctx;
}

export async function signIn(page: Page, email: string, next: RegExp) {
  for (let attempt = 0; attempt < 4; attempt++) {
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    const ok = await page.waitForURL(next, { timeout: 8000 }).then(
      () => true,
      () => false,
    );
    if (ok) return;
    await page.waitForTimeout(10_000);
  }
  throw new Error(`could not sign in ${email}`);
}

/** Opens a context signed in as `who`, signing in again only when the stored session no longer works. */
export async function as(
  browser: Browser,
  who: string,
  email: string,
  ip: string,
  probe: string,
  ok: RegExp,
) {
  const ctx = await newCtx(browser, { ip, storage: storagePath(who) });
  const page = await ctx.newPage();
  await page.goto(probe);
  if (!ok.test(new URL(page.url()).pathname)) {
    await signIn(page, email, ok);
    await page.goto(probe);
  }
  await ctx.storageState({ path: storagePath(who) });
  return { ctx, page };
}

/**
 * Server action ids of every action the page's client bundles import, by export name. Next dev builds
 * carry a `__next_internal_action_entry_do_not_use__` manifest comment per action module.
 */
export async function actionIds(page: Page, pagePath: string): Promise<Record<string, string>> {
  const html = await (await page.request.get(pagePath)).text();
  const srcs = [...html.matchAll(/src="(\/_next\/[^"]+\.js[^"]*)"/g)].map((m) => m[1]!);
  const out: Record<string, string> = {};
  for (const s of new Set(srcs)) {
    const js = await (await page.request.get(s)).text();
    for (const m of js.matchAll(/__next_internal_action_entry_do_not_use__ (\[.*?\]) \*\//g)) {
      try {
        const [map] = JSON.parse(m[1]!) as [Record<string, { name: string }>];
        for (const [id, v] of Object.entries(map)) out[v.name] = id;
      } catch {}
    }
  }
  return out;
}

/** Calls a server action exactly like the browser does, with any arguments. Returns status, redirect and body. */
export async function callAction(page: Page, pagePath: string, id: string, args: unknown[]) {
  const res = await page.request.post(pagePath, {
    headers: {
      "Next-Action": id,
      "Content-Type": "text/plain;charset=UTF-8",
      Accept: "text/x-component",
    },
    data: JSON.stringify(args),
    maxRedirects: 0,
  });
  const body = await res.text();
  const m = body.match(/^\d+:(\{"ok":.*)$/m);
  let result: { ok: boolean; error?: string; data?: unknown } | null = null;
  try {
    result = m ? JSON.parse(m[1]!) : null;
  } catch {}
  return { status: res.status(), redirect: res.headers()["x-action-redirect"] ?? null, body, result };
}

export async function postJson(request: APIRequestContext, url: string, data: unknown, headers = {}) {
  return request.post(url, { data, headers: { "content-type": "application/json", ...headers } });
}

export type { BrowserContext };

/**
 * Store a PayPal or Wise connection directly, the way a verified connect would. The settings form now checks
 * credentials with PayPal and Wise, so fake ones can't be connected through the UI.
 */
export async function seedPayoutConnection(programId: string, provider: "paypal" | "wise") {
  const { createCipheriv, createHash, randomBytes } = await import("node:crypto");
  const env = Object.fromEntries(
    readFileSync(path.resolve(process.cwd(), ".env.local"), "utf8")
      .split("\n")
      .filter((l) => l.includes("=") && !l.startsWith("#"))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
  );
  const key = createHash("sha256")
    .update(env.ENCRYPTION_KEY ?? env.BETTER_AUTH_SECRET ?? "")
    .digest();
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const secret =
    provider === "paypal"
      ? { clientId: "qa-fake", clientSecret: "qa-fake", sandbox: true }
      : { token: "qa-fake-token", profileId: "1", sandbox: true };
  const body = Buffer.concat([c.update(JSON.stringify(secret), "utf8"), c.final()]);
  const enc = [iv, c.getAuthTag(), body].map((b) => b.toString("base64url")).join(".");
  const { default: postgres } = await import("postgres");
  const sql = postgres(env.DATABASE_URL!);
  try {
    const [p] = await sql`select workspace_id from program where id = ${programId}`;
    await sql`insert into billing_connection (id, workspace_id, provider, mode, secret_enc, created_at)
      values (${`bcn_qa_${provider}_${Date.now()}`}, ${p!.workspace_id}, ${provider}, 'api_key', ${enc}, now())
      on conflict (workspace_id, provider) do update set secret_enc = excluded.secret_enc`;
    await sql`update program set payout_methods = (select array(select distinct unnest(payout_methods || array[${provider}]::text[]))) where id = ${programId}`;
  } finally {
    await sql.end();
  }
}
