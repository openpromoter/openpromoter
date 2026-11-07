import { createHmac, randomBytes } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { type APIRequestContext, type Browser, expect, type Page, test } from "@playwright/test";
import { signUp, uid } from "./helpers";

/**
 * Developer surface end to end: REST API v1 (auth, scopes, pagination, filters, errors, idempotency,
 * rate limits, tenant isolation), OpenAPI spec, outgoing webhooks, non-Stripe billing providers
 * (Paddle, Lemon Squeezy, Polar, Chargebee), exports and health. Pure HTTP except account setup,
 * which goes through the UI like a founder would.
 */

// the website repo sits next to this one; the docs check is skipped when it isn't there
const DOCS =
  process.env.SITE_DOCS_DIR ?? `${import.meta.dirname}/../../../../openpromoter-site/apps/www/content/docs`;
const PASSWORD = "e2e-password-123";
const hex = (n = 16) => randomBytes(n).toString("hex");
const now = () => Math.floor(Date.now() / 1000);
const hmacHex = (key: string | Buffer, s: string) => createHmac("sha256", key).update(s).digest("hex");

type Founder = {
  storage: Awaited<ReturnType<import("@playwright/test").BrowserContext["storageState"]>>;
  programId: string;
  workspaceId: string;
  slug: string;
  keys: Record<"full" | "rate" | "read" | "revoke" | "tracking", string>;
};

type Received = { headers: IncomingHttpHeaders; body: string; at: number; path: string };
let listener: Server;

/*
 * Playwright restarts the worker after a failing test, which would drop module state. Everything set up
 * once (founders, keys, secrets, the listener port) lives in a per-run file so later tests still run and
 * report their own result. The runner's pid identifies the run.
 */
// state shared with tools that drive the SDK, CLI and MCP server against the same data
const DIR = process.env.E2E_STATE_DIR ?? `${tmpdir()}/openpromoter-api-e2e`;
mkdirSync(DIR, { recursive: true });
const STATE = `${DIR}/state-${process.ppid}.json`;
const HOOKS = `${DIR}/received-${process.ppid}.jsonl`;
type State = {
  id: string;
  port: number;
  secrets: { paddle: string; lemonsqueezy: string; polar: string; chargebee: string };
  endpointSecret: string;
  A?: Founder;
  B?: Founder;
  prog?: { commissionValue: number; commissionType: string; currency: string };
  partners: Record<string, { id: string; code: string; email: string }>;
};
const S: State = existsSync(STATE)
  ? JSON.parse(readFileSync(STATE, "utf8"))
  : {
      id: uid(),
      port: 0,
      secrets: {
        paddle: `pdl_ntfset_${hex(16)}`,
        lemonsqueezy: `ls_${hex(16)}`,
        polar: `whsec_${randomBytes(24).toString("base64")}`,
        chargebee: `cbuser:${hex(12)}`,
      },
      endpointSecret: "",
      partners: {},
    };
const save = () => writeFileSync(STATE, JSON.stringify(S));
const received = (): Received[] =>
  existsSync(HOOKS)
    ? readFileSync(HOOKS, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l))
    : [];
const secrets = S.secrets;
const listenerUrl = () => `http://127.0.0.1:${S.port}/hook`;
async function pageFor(browser: Browser, f: Founder) {
  const ctx = await browser.newContext({ storageState: f.storage });
  return { ctx, page: await ctx.newPage() };
}

async function onboard(page: Page, name: string, email: string) {
  const id = uid();
  await signUp(page, name, email, PASSWORD);
  await page.getByLabel("Website URL").fill("http://127.0.0.1:3000");
  await page.getByLabel("Product name").fill(`Apico ${id}`);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Connect Stripe" })).toBeVisible();
  await page.getByRole("button", { name: /Skip for now/ }).click();
  await page.getByRole("button", { name: "Accept this program" }).click();
  await expect(page.getByRole("heading", { name: "Install tracking" })).toBeVisible();
  await page.getByRole("button", { name: /I'll do this later|Continue/ }).click();
  await page.getByRole("link", { name: "Go to dashboard" }).click();
  await page.waitForURL(/\/app\/prg_/);
  const programId = new URL(page.url()).pathname.split("/")[2]!;
  await page.goto(`/app/${programId}/settings/integrations`);
  const wh = (await page.locator("text=/api/webhooks/stripe/").first().textContent())!.trim();
  const workspaceId = wh.split("/").pop()!;
  await page.goto(`/app/${programId}/settings/install`);
  const slug = (await page.locator("pre", { hasText: "data-program" }).first().textContent())!.match(
    /data-program="([^"]+)"/,
  )![1]!;
  return { programId, workspaceId, slug };
}

async function createKey(page: Page, programId: string, name: string, scopes: string[]) {
  await page.goto(`/app/${programId}/settings/developers`);
  await page.getByRole("button", { name: "New key" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("Name").fill(name);
  for (const s of ["read", "partners:write", "tracking:write", "commissions:write", "payouts:request"]) {
    const box = dlg
      .locator("label", { has: page.locator(`span.font-mono:text-is("${s}")`) })
      .getByRole("checkbox");
    const want = scopes.includes(s);
    if ((await box.getAttribute("aria-checked")) !== String(want)) await box.click();
  }
  await dlg.getByRole("button", { name: "Create key" }).click();
  const key = (await dlg.locator("text=/^op_(sk|live)_/").first().textContent())!.trim();
  await page.keyboard.press("Escape");
  return key;
}

const api = (request: APIRequestContext, key: string | null) => {
  const headers = (extra?: Record<string, string>) => ({
    ...(key ? { authorization: `Bearer ${key}` } : {}),
    ...extra,
  });
  return {
    get: (path: string) => request.get(`/api/v1${path}`, { headers: headers() }),
    post: (path: string, data?: unknown) =>
      request.post(`/api/v1${path}`, { headers: headers({ "content-type": "application/json" }), data }),
    patch: (path: string, data?: unknown) =>
      request.patch(`/api/v1${path}`, { headers: headers({ "content-type": "application/json" }), data }),
  };
};

async function json(res: { status(): number; text(): Promise<string> }, status = 200) {
  const text = await res.text();
  expect(res.status(), text).toBe(status);
  return JSON.parse(text);
}

function verifyAsDocs(rawBody: string, header: string, secret: string, toleranceSeconds = 300) {
  // copied from webhooks.md "Without the SDK, in Node"
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=")));
  const t = Number(parts.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > toleranceSeconds)
    throw new Error("Timestamp outside tolerance");
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(parts.v1 ?? "", "hex");
  if (a.length !== b.length || !a.equals(b)) throw new Error("Bad signature");
  return JSON.parse(rawBody);
}

async function waitFor<T>(fn: () => Promise<T | undefined | null | false>, ms = 30_000): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > until) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 500));
  }
}

test.describe("developer surface", () => {
  test.describe.configure({ mode: "default" });
  test.setTimeout(180_000);
  const id = S.id;
  let A = S.A as Founder;
  let B = S.B as Founder;
  let prog = S.prog!;
  const partners = S.partners;

  test.beforeAll(async () => {
    const seen = new Set<string>();
    listener = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        appendFileSync(
          HOOKS,
          `${JSON.stringify({ headers: req.headers, body, at: Date.now(), path: req.url })}\n`,
        );
        // /flaky answers the first attempt of each delivery with a redirect (docs: a redirect is a failure)
        const d = String(req.headers["openpromoter-delivery"]);
        if (req.url === "/flaky" && !seen.has(d)) {
          seen.add(d);
          res.writeHead(302, { location: "/hook" }).end();
          return;
        }
        res.writeHead(200).end("ok");
      });
    });
    await new Promise<void>((r) => listener.listen(S.port, "127.0.0.1", r));
    S.port = (listener.address() as AddressInfo).port;
    save();
  });
  test.afterAll(async () => {
    await new Promise((r) => listener.close(r));
    save();
  });

  test("setup: founder A signs up, creates keys, a webhook endpoint and connects 4 providers", async ({
    browser,
  }) => {
    test.skip(!!S.A, "already set up in this run");
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const o = await onboard(page, "Ada Founder", `ada-${id}@e2e.test`);
    A = { storage: await ctx.storageState(), ...o, keys: {} as Founder["keys"] };
    A.keys.full = await createKey(page, o.programId, "full", [
      "read",
      "partners:write",
      "tracking:write",
      "commissions:write",
      "payouts:request",
    ]);
    A.keys.read = await createKey(page, o.programId, "read only", ["read"]);
    A.keys.revoke = await createKey(page, o.programId, "to revoke", ["read"]);
    A.keys.rate = await createKey(page, o.programId, "rate", ["read"]);
    A.keys.tracking = await createKey(page, o.programId, "tracking", ["tracking:write"]);
    expect(A.keys.full).toMatch(/^op_sk_/);

    await page.goto(`/app/${o.programId}/settings/developers`);
    await page.getByRole("button", { name: "Add endpoint" }).click();
    await page.getByRole("dialog").getByLabel("URL").fill(listenerUrl());
    await page.getByRole("dialog").getByRole("button", { name: "Add" }).click();
    await expect(page.locator("li", { hasText: listenerUrl() })).toBeVisible();
    S.endpointSecret = (await page
      .locator("li", { hasText: listenerUrl() })
      .locator("text=/^whsec_/")
      .textContent())!;
    expect(S.endpointSecret).toMatch(/^whsec_/);

    await page.goto(`/app/${o.programId}/settings/integrations`);
    let n = 0;
    for (const [p, s] of Object.entries(secrets)) {
      const input = page.getByLabel(`${p} webhook secret`);
      await input.fill(s);
      await input.locator("xpath=ancestor::form").getByRole("button", { name: "Save" }).click();
      await expect(page.getByText(/Connected · (live|test)/)).toHaveCount(++n);
    }
    await page.reload();
    await expect(page.getByText(/Connected · (live|test)/)).toHaveCount(4);
    A.storage = await ctx.storageState();
    S.A = A;
    save();
    await ctx.close();
  });

  test("setup: founder B in another workspace", async ({ browser }) => {
    test.skip(!!S.B, "already set up in this run");
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const o = await onboard(page, "Bea Founder", `bea-${id}@e2e.test`);
    B = { storage: await ctx.storageState(), ...o, keys: {} as Founder["keys"] };
    B.keys.full = await createKey(page, o.programId, "full", [
      "read",
      "partners:write",
      "tracking:write",
      "commissions:write",
      "payouts:request",
    ]);
    expect(B.workspaceId).not.toBe(A.workspaceId);
    B.storage = await ctx.storageState();
    S.B = B;
    save();
    await ctx.close();
  });

  test("health and OpenAPI spec are valid and match the routes and the docs", async ({ request }) => {
    expect(await json(await request.get("/api/health"))).toEqual({ ok: true });
    const spec = await json(await request.get("/api/openapi.json"));
    expect(spec.openapi).toBe("3.1.0");
    expect(spec.info.title).toBeTruthy();
    expect(spec.info.version).toBeTruthy();
    expect(spec.servers[0].url).toMatch(/\/api\/v1$/);
    expect(spec.components.securitySchemes.bearer).toMatchObject({ type: "http", scheme: "bearer" });

    // structural OAS 3.1 checks + JSON Schema 2020-12 compile of every schema
    // ajv comes in through other packages; pnpm keeps it in its store, not in node_modules/ajv
    const store = `${import.meta.dirname}/../../../node_modules/.pnpm`;
    const ajvDir = readdirSync(store).find((d) => d.startsWith("ajv@8"));
    const { default: Ajv2020 } = await import(`${store}/${ajvDir}/node_modules/ajv/dist/2020.js`);
    const ajv = new Ajv2020({ strict: false, validateFormats: false });
    const documented = new Set<string>();
    for (const [path, ops] of Object.entries<Record<string, any>>(spec.paths)) {
      expect(path.startsWith("/")).toBe(true);
      const templ = [...path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
      for (const [method, op] of Object.entries<any>(ops)) {
        expect(["get", "post", "patch", "put", "delete"]).toContain(method);
        documented.add(`${method.toUpperCase()} ${path}`);
        expect(op.responses?.["200"], `${method} ${path}`).toBeTruthy();
        const pp = op.parameters.filter((p: any) => p.in === "path").map((p: any) => p.name);
        expect(pp.sort()).toEqual([...templ].sort());
        for (const p of op.parameters) {
          expect(["path", "query", "header", "cookie"]).toContain(p.in);
          expect(() => ajv.compile(p.schema)).not.toThrow();
        }
        if (op.requestBody)
          expect(() => ajv.compile(op.requestBody.content["application/json"].schema)).not.toThrow();
        // every write endpoint can return a validation error; the spec should say so
        if (op.requestBody) expect.soft(op.responses["400"], `${method} ${path} documents 400`).toBeTruthy();
      }
    }
    // the endpoints table in docs/api.md lists exactly the routes in the spec
    if (!existsSync(`${DOCS}/api.md`)) return;
    const md = readFileSync(`${DOCS}/api.md`, "utf8");
    const inDocs = new Set(
      [...md.matchAll(/^\| `(GET|POST|PATCH)` \| `([^`]+)` \| `([^`]+)` \|/gm)].map((m) => `${m[1]} ${m[2]}`),
    );
    expect.soft([...inDocs].sort()).toEqual([...documented].sort());
    // and the scopes column matches x-scope
    for (const m of md.matchAll(/^\| `(GET|POST|PATCH)` \| `([^`]+)` \| `([^`]+)` \|/gm))
      expect.soft(spec.paths[m[2]!]?.[m[1]!.toLowerCase()]?.["x-scope"], `${m[1]} ${m[2]}`).toBe(m[3]);
  });

  test("auth: missing, malformed, invalid and revoked keys get 401 with the documented error shape", async ({
    request,
    browser,
  }) => {
    const r1 = await json(await api(request, null).get("/programs"), 401);
    expect(r1).toEqual({ error: { code: "unauthorized", message: expect.any(String) } });
    await json(
      await request.get("/api/v1/programs", { headers: { authorization: `Basic ${A.keys.full}` } }),
      401,
    );
    await json(await request.get("/api/v1/programs", { headers: { authorization: A.keys.full } }), 401);
    const r2 = await json(await api(request, `op_sk_${hex(24)}`).get("/programs"), 401);
    expect(r2.error.code).toBe("unauthorized");
    // every documented route requires auth
    for (const p of [
      "/events",
      `/programs/${A.programId}/stats`,
      `/programs/${A.programId}/partners`,
      `/programs/${A.programId}/commissions`,
      `/programs/${A.programId}/payouts`,
      `/programs/${A.programId}/referrals`,
      `/programs/${A.programId}/campaigns`,
      `/programs/${A.programId}/autopilot`,
    ])
      await json(await api(request, null).get(p), 401);
    await json(await api(request, null).post("/conversions", {}), 401);

    // revoke through the UI, then the key stops working
    await json(await api(request, A.keys.revoke).get("/programs"));
    const { ctx, page } = await pageFor(browser, A);
    await page.goto(`/app/${A.programId}/settings/developers`);
    page.once("dialog", (d) => d.accept());
    await page.locator("li", { hasText: "to revoke" }).getByRole("button", { name: "Revoke" }).click();
    await expect(page.locator("li", { hasText: "to revoke" }))
      .toHaveCount(0, { timeout: 10_000 })
      .catch(() => {});
    await waitFor(async () => (await api(request, A.keys.revoke).get("/programs")).status() === 401);
    expect((await json(await api(request, A.keys.revoke).get("/programs"), 401)).error.code).toBe(
      "unauthorized",
    );
    // the key list shows it was used
    await page.reload();
    await expect(page.locator("li", { hasText: "read only" })).toContainText("used ");
    await ctx.close();
  });

  test("programs list and stats", async ({ request }) => {
    const r = await json(await api(request, A.keys.read).get("/programs"));
    expect(r.data).toHaveLength(1);
    expect(r.data[0]).toMatchObject({ id: A.programId, slug: A.slug });
    prog = r.data[0];
    S.prog = prog;
    save();
    const s = await json(await api(request, A.keys.read).get(`/programs/${A.programId}/stats?days=7`));
    for (const k of ["revenue", "commissions", "clicks", "leads", "customers", "mrr", "owed"])
      expect(typeof s[k], k).toBe("number");
    await json(await api(request, A.keys.read).get(`/programs/${A.programId}/stats?days=0`), 400);
    await json(await api(request, A.keys.read).get(`/programs/${A.programId}/stats?days=731`), 400);
    await json(await api(request, A.keys.read).get(`/programs/prg_nope/stats`), 404);
  });

  test("scopes: each write route refuses a key without its scope (403 forbidden)", async ({ request }) => {
    const read = api(request, A.keys.read);
    const cases: [string, string, unknown][] = [
      ["post", `/programs/${A.programId}/partners`, { email: `x-${id}@e2e.test`, name: "X" }],
      ["patch", `/partners/prt_x`, { status: "paused" }],
      ["post", `/partners/prt_x/links`, { destination: "http://127.0.0.1:3000/" }],
      ["post", `/programs/${A.programId}/embed-tokens`, { email: `x-${id}@e2e.test`, name: "X" }],
      ["post", `/clicks`, { programId: A.programId, code: "x" }],
      ["post", `/leads`, { programId: A.programId, email: `x-${id}@e2e.test` }],
      ["post", `/conversions`, {}],
      ["post", `/refunds`, {}],
      ["post", `/programs/${A.programId}/commissions`, {}],
      ["post", `/programs/${A.programId}/payouts`, {}],
      ["post", `/programs/${A.programId}/campaigns`, { prompt: "double commissions" }],
      ["post", `/programs/${A.programId}/autopilot/act_x/apply`, {}],
    ];
    for (const [m, p, body] of cases) {
      const res = await (m === "post" ? read.post(p, body) : read.patch(p, body));
      const j = await json(res, 403);
      expect(j.error.code, `${m} ${p}`).toBe("forbidden");
    }
    // a tracking-only key can't read
    expect((await json(await api(request, A.keys.tracking).get("/programs"), 403)).error.code).toBe(
      "forbidden",
    );
  });

  test("partners: create, duplicate, get, list filters, pagination, update status and tier", async ({
    request,
  }) => {
    const full = api(request, A.keys.full);
    for (const n of ["one", "two", "three", "four"]) {
      const p = await json(
        await full.post(`/programs/${A.programId}/partners`, {
          email: `p-${n}-${id}@e2e.test`,
          name: `Pat ${n}`,
          website: "https://pat.example",
          country: "us",
        }),
      );
      expect(p).toMatchObject({ programId: A.programId, status: "approved", country: "US" });
      partners[n] = { id: p.id, code: p.code, email: p.email };
    }
    save();
    // same email again: idempotent, same partner
    const again = await json(
      await full.post(`/programs/${A.programId}/partners`, {
        email: partners.one!.email.toUpperCase(),
        name: "Pat",
      }),
    );
    expect(again.id).toBe(partners.one!.id);
    // recruiter (two-tier)
    const sub = await json(
      await full.post(`/programs/${A.programId}/partners`, {
        email: `p-sub-${id}@e2e.test`,
        name: "Sub Partner",
        recruiterCode: partners.one!.code,
      }),
    );
    expect(sub.recruitedBy).toBe(partners.one!.id);
    partners.sub = { id: sub.id, code: sub.code, email: sub.email };
    save();

    // validation errors carry issues
    const bad = await json(
      await full.post(`/programs/${A.programId}/partners`, { email: "nope", name: "" }),
      400,
    );
    expect(bad.error.code).toBe("invalid_request");
    expect(bad.error.issues.map((i: any) => i.path).sort()).toEqual(["email", "name"]);
    // malformed JSON is a 400, not a 500
    const raw = await request.post(`/api/v1/programs/${A.programId}/partners`, {
      headers: { authorization: `Bearer ${A.keys.full}`, "content-type": "application/json" },
      data: "{not json",
    });
    expect(raw.status()).toBe(400);

    const got = await json(await api(request, A.keys.read).get(`/partners/${partners.one!.id}`));
    expect(got.links.length).toBeGreaterThan(0);
    await json(await api(request, A.keys.read).get(`/partners/prt_nope`), 404);

    const list = await json(await api(request, A.keys.read).get(`/programs/${A.programId}/partners?limit=2`));
    expect(list.data).toHaveLength(2);
    expect(list.hasMore).toBe(true);
    const next = await json(
      await api(request, A.keys.read).get(
        `/programs/${A.programId}/partners?limit=2&before=${list.data[1].id}`,
      ),
    );
    expect(next.data.map((p: any) => p.id)).not.toContain(list.data[0].id);
    expect(next.data.map((p: any) => p.id)).not.toContain(list.data[1].id);
    // newest first
    const all = await json(
      await api(request, A.keys.read).get(`/programs/${A.programId}/partners?limit=100`),
    );
    expect(all.data).toHaveLength(5);
    expect(all.hasMore).toBe(false);
    const times = all.data.map((p: any) => new Date(p.createdAt).getTime());
    expect
      .soft(
        [...times].sort((a, b) => b - a),
        "docs: newest first",
      )
      .toEqual(times);
    const rec = await json(
      await api(request, A.keys.read).get(
        `/programs/${A.programId}/partners?recruitedBy=${partners.one!.id}`,
      ),
    );
    expect(rec.data.map((p: any) => p.id)).toEqual([partners.sub.id]);
    await json(await api(request, A.keys.read).get(`/programs/${A.programId}/partners?limit=0`), 400);
    await json(await api(request, A.keys.read).get(`/programs/${A.programId}/partners?limit=101`), 400);
    await json(await api(request, A.keys.read).get(`/programs/${A.programId}/partners?status=weird`), 400);

    const paused = await json(await full.patch(`/partners/${partners.four!.id}`, { status: "paused" }));
    expect(paused.status).toBe("paused");
    const onlyPaused = await json(
      await api(request, A.keys.read).get(`/programs/${A.programId}/partners?status=paused`),
    );
    expect(onlyPaused.data.map((p: any) => p.id)).toEqual([partners.four!.id]);
    await json(await full.patch(`/partners/${partners.four!.id}`, { status: "approved" }));
    const tier = await json(await full.patch(`/partners/${partners.four!.id}`, { groupId: "grp_nope" }), 404);
    expect(tier.error.code).toBe("not_found");
    await json(await full.patch(`/partners/${partners.four!.id}`, { status: "pending" }), 400);
  });

  test("links: deep links stay on the founder's domain; custom keys; duplicate key is a clean error", async ({
    request,
  }) => {
    const full = api(request, A.keys.full);
    const key = `k${id}`;
    const l = await json(
      await full.post(`/partners/${partners.two!.id}/links`, {
        destination: "http://127.0.0.1:3000/pricing",
        subId: "yt",
        key,
      }),
    );
    expect(l).toMatchObject({ key, subId: "yt" });
    const r = await request.get(`/r/${A.slug}/l/${key}`, { maxRedirects: 0 });
    expect([301, 302, 307, 308]).toContain(r.status());
    const off = await json(
      await full.post(`/partners/${partners.two!.id}/links`, { destination: "https://evil.example/" }),
      400,
    );
    expect(off.error.code).toBe("invalid_request");
    // a key that is already taken (by any program) must not be a 500
    const dup = await full.post(`/partners/${partners.three!.id}/links`, {
      destination: "http://127.0.0.1:3000/",
      key,
    });
    expect(dup.status(), await dup.text()).toBeLessThan(500);
    expect(dup.status()).toBe(400);
  });

  test("tracking: clicks, leads, conversions (idempotent), refunds, referrals list", async ({ request }) => {
    const t = api(request, A.keys.full);
    const click = await json(
      await t.post("/clicks", {
        programId: A.programId,
        code: partners.two!.code,
        url: "http://127.0.0.1:3000/",
      }),
    );
    expect(click.clickId).toMatch(/^clk_/);
    await json(await t.post("/clicks", { programId: A.programId, code: "no-such-code" }), 404);

    const lead = await json(
      await t.post("/leads", {
        programId: A.programId,
        email: `lead-${id}@e2e.test`,
        clickId: click.clickId,
      }),
    );
    expect(lead).toMatchObject({ attributed: true, partnerId: partners.two!.id });
    const unattributed = await json(
      await t.post("/leads", { programId: A.programId, email: `cold-${id}@e2e.test` }),
    );
    expect(unattributed).toEqual({ attributed: false, referralId: null, partnerId: null });

    const conv = {
      programId: A.programId,
      paymentId: `inv_${id}`,
      customerId: `cus_${id}`,
      amount: 10000,
      currency: "usd",
      interval: "month",
      email: `lead-${id}@e2e.test`,
    };
    const c1 = await json(await t.post("/conversions", conv));
    expect(c1.duplicate).toBe(false);
    expect(c1.effects.join(" ")).toMatch(/com_/);
    const c2 = await json(await t.post("/conversions", conv));
    expect(c2.duplicate).toBe(true);

    const coms = await json(
      await api(request, A.keys.read).get(
        `/programs/${A.programId}/commissions?partnerId=${partners.two!.id}&kind=sale`,
      ),
    );
    expect(coms.data).toHaveLength(1);
    const sale = coms.data[0];
    expect(sale).toMatchObject({ saleAmount: 10000, status: "pending", currency: "usd" });
    if (prog.commissionType === "percent")
      expect(sale.amount).toBe(Math.round((10000 * prog.commissionValue) / 10000));

    // partner code credit
    const c3 = await json(
      await t.post("/conversions", {
        ...conv,
        paymentId: `inv2_${id}`,
        customerId: `cus2_${id}`,
        email: null,
        partnerCode: partners.three!.code,
      }),
    );
    expect(c3.effects.join(" ")).toMatch(/com_/);
    // amount validation
    await json(await t.post("/conversions", { ...conv, paymentId: `inv3_${id}`, amount: 0 }), 400);
    await json(await t.post("/conversions", { ...conv, paymentId: `inv3_${id}`, amount: 12.5 }), 400);

    // partial refund halves, a repeat is a duplicate, full refund reverses
    const r1 = await json(
      await t.post("/refunds", {
        programId: A.programId,
        paymentId: conv.paymentId,
        refundId: `re1_${id}`,
        refundedTotal: 5000,
        chargedTotal: 10000,
      }),
    );
    expect(r1.duplicate).toBe(false);
    expect(
      (
        await json(
          await t.post("/refunds", {
            programId: A.programId,
            paymentId: conv.paymentId,
            refundId: `re1_${id}`,
            refundedTotal: 5000,
            chargedTotal: 10000,
          }),
        )
      ).duplicate,
    ).toBe(true);
    const after = await json(
      await api(request, A.keys.read).get(
        `/programs/${A.programId}/commissions?partnerId=${partners.two!.id}`,
      ),
    );
    const adj = after.data.find((c: any) => c.kind === "adjustment");
    expect(adj.amount).toBe(-Math.round(sale.amount / 2));
    await json(
      await t.post("/refunds", {
        programId: A.programId,
        paymentId: conv.paymentId,
        refundId: `re2_${id}`,
        refundedTotal: 10000,
        chargedTotal: 10000,
      }),
    );
    const rev = await json(
      await api(request, A.keys.read).get(
        `/programs/${A.programId}/commissions?partnerId=${partners.two!.id}&status=reversed`,
      ),
    );
    expect(rev.data.map((c: any) => c.id)).toContain(sale.id);

    const refs = await json(
      await api(request, A.keys.read).get(`/programs/${A.programId}/referrals?limit=100`),
    );
    const mine = refs.data.find((r: any) => r.customerId === `cus_${id}`);
    expect(mine).toMatchObject({
      partnerId: partners.two!.id,
      email: `lead-${id}@e2e.test`,
      status: "refunded",
    });
    const leads = await json(
      await api(request, A.keys.read).get(`/programs/${A.programId}/referrals?status=lead`),
    );
    expect(leads.data.every((r: any) => r.status === "lead")).toBe(true);
    const pg = await json(await api(request, A.keys.read).get(`/programs/${A.programId}/referrals?limit=1`));
    expect(pg.data).toHaveLength(1);
    expect(pg.hasMore).toBe(true);
  });

  test("commissions: manual bonus is approved, idempotency key, negative adjustment, filters, wrong partner", async ({
    request,
  }) => {
    const full = api(request, A.keys.full);
    const body = {
      partnerId: partners.one!.id,
      amount: 12000,
      description: "Launch bonus",
      idempotencyKey: `bonus-${id}`,
    };
    const c = await json(await full.post(`/programs/${A.programId}/commissions`, body));
    expect(c).toMatchObject({
      kind: "bonus",
      status: "approved",
      amount: 12000,
      partnerId: partners.one!.id,
    });
    expect(await json(await full.post(`/programs/${A.programId}/commissions`, body))).toEqual({
      duplicate: true,
    });
    const adj = await json(
      await full.post(`/programs/${A.programId}/commissions`, {
        partnerId: partners.one!.id,
        amount: -1000,
        description: "Fix",
      }),
    );
    expect(adj.kind).toBe("adjustment");
    const nope = await full.post(`/programs/${A.programId}/commissions`, {
      ...body,
      partnerId: "prt_nope",
      idempotencyKey: undefined,
    });
    expect.soft(nope.status(), `docs: unknown partner is 404 not_found; got ${await nope.text()}`).toBe(404);
    expect(nope.status()).toBeLessThan(500);
    // out-of-range integers are validation errors, not 500s
    const huge = await full.post(`/programs/${A.programId}/commissions`, {
      partnerId: partners.one!.id,
      amount: 3_000_000_000,
      description: "huge",
    });
    expect.soft(huge.status(), await huge.text()).toBe(400);
    const hugeConv = await api(request, A.keys.full).post("/conversions", {
      programId: A.programId,
      paymentId: `huge_${id}`,
      customerId: `huge_${id}`,
      amount: 3_000_000_000,
      currency: "usd",
      partnerCode: partners.one!.code,
    });
    expect.soft(hugeConv.status(), await hugeConv.text()).toBe(400);
    const zero = await full.post(`/programs/${A.programId}/commissions`, {
      partnerId: partners.one!.id,
      amount: 0,
      description: "zero",
    });
    expect.soft(zero.status(), `a zero commission is meaningless; got ${await zero.text()}`).toBe(400);
    const bonuses = await json(
      await api(request, A.keys.read).get(`/programs/${A.programId}/commissions?kind=bonus`),
    );
    expect(bonuses.data.every((x: any) => x.kind === "bonus")).toBe(true);
    const approved = await json(
      await api(request, A.keys.read).get(`/programs/${A.programId}/commissions?status=approved&limit=1`),
    );
    expect(approved.data).toHaveLength(1);
    await json(await api(request, A.keys.read).get(`/programs/${A.programId}/commissions?status=nope`), 400);
    // another bonus for the race test
    await json(
      await full.post(`/programs/${A.programId}/commissions`, {
        partnerId: partners.three!.id,
        amount: 9000,
        description: "Race",
      }),
    );
  });

  test("payouts: API prepares a batch that waits for a person; no API route can approve", async ({
    request,
  }) => {
    const full = api(request, A.keys.full);
    // five concurrent prepares for the same partner must produce one payout
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        full.post(`/programs/${A.programId}/payouts`, { partnerIds: [partners.three!.id] }),
      ),
    );
    for (const r of results) expect(r.status()).toBe(200);
    const p3 = await json(await api(request, A.keys.read).get(`/programs/${A.programId}/payouts?limit=100`));
    expect
      .soft(
        p3.data.filter((p: any) => p.partnerId === partners.three!.id),
        "concurrent prepares",
      )
      .toHaveLength(1);

    const batch = await json(await full.post(`/programs/${A.programId}/payouts`, {}));
    expect(batch.approvalRequired).toBe(true);
    const mine = batch.data.find((p: any) => p.partnerId === partners.one!.id);
    expect(mine).toMatchObject({ status: "awaiting_approval", amount: 11000, method: "manual" });
    // preparing again doesn't duplicate
    const again = await json(await full.post(`/programs/${A.programId}/payouts`, {}));
    expect(again.data).toHaveLength(0);
    const list = await json(
      await api(request, A.keys.read).get(`/programs/${A.programId}/payouts?status=awaiting_approval`),
    );
    expect(list.data.map((p: any) => p.id)).toContain(mine.id);
    expect(list.data.every((p: any) => p.status === "awaiting_approval")).toBe(true);
    await json(await api(request, A.keys.read).get(`/programs/${A.programId}/payouts?status=paid`)).then(
      (r) => expect(r.data).toHaveLength(0),
    );
    // there is no approval endpoint, with any key
    for (const [m, p] of [
      ["post", `/programs/${A.programId}/payouts/${mine.id}/approve`],
      ["post", `/payouts/${mine.id}/approve`],
      ["patch", `/payouts/${mine.id}`],
      ["patch", `/programs/${A.programId}/payouts/${mine.id}`],
    ] as const) {
      const res = await (m === "post" ? full.post(p, { status: "paid" }) : full.patch(p, { status: "paid" }));
      expect(res.status(), `${m} ${p}`).toBe(404);
    }
    const still = await json(
      await api(request, A.keys.read).get(`/programs/${A.programId}/payouts?limit=100`),
    );
    expect(still.data.find((p: any) => p.id === mine.id).status).toBe("awaiting_approval");
    // the commissions are not locked to the payout until a person approves it
    const coms = await json(
      await api(request, A.keys.read).get(
        `/programs/${A.programId}/commissions?partnerId=${partners.one!.id}`,
      ),
    );
    expect(coms.data.every((c: any) => c.payoutId === null)).toBe(true);
  });

  test("growth: embed tokens, campaigns, autopilot and ask", async ({ request }) => {
    const full = api(request, A.keys.full);
    const e = await json(
      await full.post(`/programs/${A.programId}/embed-tokens`, {
        email: `emb-${id}@e2e.test`,
        name: "Em Bed",
      }),
    );
    expect(e).toMatchObject({ expiresIn: 3600, partnerId: expect.stringMatching(/^prt_/) });
    expect(e.token.length).toBeGreaterThan(20);
    const camp = await full.post(`/programs/${A.programId}/campaigns`, {
      prompt: "double commissions for annual plans this month",
    });
    expect([200, 422]).toContain(camp.status());
    const cj = await camp.json();
    if (camp.status() === 422) expect(cj.error.code).toBe("unparseable");
    else expect(cj.status).toBe("draft");
    const list = await json(await api(request, A.keys.read).get(`/programs/${A.programId}/campaigns`));
    expect(Array.isArray(list.data)).toBe(true);
    const ap = await json(await api(request, A.keys.read).get(`/programs/${A.programId}/autopilot`));
    expect(Array.isArray(ap.data)).toBe(true);
    const apply = await full.post(`/programs/${A.programId}/autopilot/act_nope/apply`);
    expect
      .soft(apply.status(), `docs: missing things are 404 not_found; got ${await apply.text()}`)
      .toBe(404);
    const ask = await api(request, A.keys.read).post(`/programs/${A.programId}/ask`, {
      question: "how many partners do I have?",
    });
    expect(ask.status(), await ask.text()).toBe(200);
    expect(typeof (await ask.json()).text).toBe("string");
  });

  test("tenant isolation: workspace B's key cannot read or touch workspace A", async ({ request }) => {
    const b = api(request, B.keys.full);
    const progs = await json(await b.get("/programs"));
    expect(progs.data.map((p: any) => p.id)).toEqual([B.programId]);
    for (const p of ["stats", "partners", "referrals", "commissions", "payouts", "campaigns", "autopilot"])
      expect((await json(await b.get(`/programs/${A.programId}/${p}`), 404)).error.code).toBe("not_found");
    await json(await b.get(`/partners/${partners.one!.id}`), 404);
    await json(await b.patch(`/partners/${partners.one!.id}`, { status: "banned" }), 404);
    await json(
      await b.post(`/partners/${partners.one!.id}/links`, { destination: "http://127.0.0.1:3000/" }),
      404,
    );
    await json(
      await b.post(`/programs/${A.programId}/partners`, { email: `evil-${id}@e2e.test`, name: "Evil" }),
      404,
    );
    await json(
      await b.post(`/programs/${A.programId}/embed-tokens`, { email: partners.one!.email, name: "x" }),
      404,
    );
    await json(await b.post("/clicks", { programId: A.programId, code: partners.one!.code }), 404);
    await json(
      await b.post("/leads", {
        programId: A.programId,
        email: `evil-${id}@e2e.test`,
        partnerCode: partners.one!.code,
      }),
      404,
    );
    await json(
      await b.post("/conversions", {
        programId: A.programId,
        paymentId: `x_${id}`,
        customerId: "c",
        amount: 100,
        currency: "usd",
      }),
      404,
    );
    await json(
      await b.post("/refunds", {
        programId: A.programId,
        paymentId: `inv_${id}`,
        refundId: "r",
        refundedTotal: 1,
        chargedTotal: 1,
      }),
      404,
    );
    await json(
      await b.post(`/programs/${A.programId}/commissions`, {
        partnerId: partners.one!.id,
        amount: 1,
        description: "x",
      }),
      404,
    );
    await json(await b.post(`/programs/${A.programId}/payouts`, {}), 404);
    await json(await b.post(`/programs/${A.programId}/ask`, { question: "list partners" }), 404);
    // B's own program with A's ids
    const xc = await b.post(`/programs/${B.programId}/commissions`, {
      partnerId: partners.one!.id,
      amount: 100000,
      description: "x",
    });
    expect([400, 404]).toContain(xc.status());
    const pb = await json(
      await b.post(`/programs/${B.programId}/payouts`, {
        partnerIds: [partners.one!.id, partners.three!.id],
      }),
    );
    expect(pb.data).toHaveLength(0);
    const lb = await json(
      await b.post("/leads", {
        programId: B.programId,
        email: `x-${id}@e2e.test`,
        partnerCode: partners.one!.code,
      }),
    );
    expect(lb.attributed).toBe(false);
    // B can reuse a payment id that A used (idempotency is per workspace)
    const bp = await json(
      await b.post(`/programs/${B.programId}/partners`, { email: `bp-${id}@e2e.test`, name: "Bp" }),
    );
    const conv = await json(
      await b.post("/conversions", {
        programId: B.programId,
        paymentId: `inv_${id}`,
        customerId: `cus_${id}`,
        amount: 5000,
        currency: "usd",
        partnerCode: bp.code,
      }),
    );
    expect(conv.duplicate).toBe(false);
    // A's refund for that payment id didn't touch B, and B's events contain nothing of A
    const ev = await json(await b.get("/events?limit=100"));
    expect(JSON.stringify(ev)).not.toContain(partners.one!.id);
    // A's data unchanged
    const one = await json(await api(request, A.keys.read).get(`/partners/${partners.one!.id}`));
    expect(one.status).toBe("approved");
  });

  test("events feed: cursor, order, limit, same payloads as webhooks", async ({ request }) => {
    const read = api(request, A.keys.read);
    const all = await waitFor(async () => {
      const r = await json(await read.get("/events?limit=100"));
      return r.data.some((e: any) => e.type === "commission.created") ? r : null;
    });
    const ids = all.data.map((e: any) => e.id);
    expect([...ids].sort()).toEqual(ids);
    for (const e of all.data)
      expect(e).toMatchObject({
        id: expect.any(String),
        type: expect.any(String),
        created: expect.any(Number),
      });
    const first = await json(await read.get("/events?limit=1"));
    expect(first.data).toHaveLength(1);
    const rest = await json(await read.get(`/events?after=${first.data[0].id}&limit=100`));
    // the feed is live: events written after the first read may follow, but only after everything seen
    const restIds = rest.data.map((e: any) => e.id);
    expect(restIds.slice(0, ids.length - 1)).toEqual(ids.slice(1));
    expect([...restIds].sort()).toEqual(restIds);
    await json(await read.get("/events?limit=0"), 400);
  });

  test("outgoing webhooks: signed per docs, documented headers and payload fields", async () => {
    const { verifyWebhook } = await import("../../../packages/sdk/src/index");
    const hooks = await waitFor(async () => {
      const got = received();
      const types = new Set(got.map((r) => r.headers["openpromoter-event"]));
      return types.has("commission.created") &&
        types.has("partner.approved") &&
        types.has("commission.reversed") &&
        types.has("referral.created")
        ? got
        : null;
    }, 60_000);
    const endpointSecret = S.endpointSecret;
    for (const h of hooks) {
      expect(h.headers["user-agent"]).toBe("OpenPromoter-Webhooks/1");
      expect(h.headers["content-type"]).toContain("application/json");
      expect(h.headers["openpromoter-delivery"]).toMatch(/^whd_/);
      const sig = String(h.headers["openpromoter-signature"]);
      expect(sig).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
      const evt = verifyAsDocs(h.body, sig, endpointSecret);
      expect(verifyWebhook(h.body, sig, endpointSecret)).toEqual(evt);
      expect(() => verifyAsDocs(h.body, sig, "whsec_wrong")).toThrow();
      expect(() => verifyWebhook(`${h.body} `, sig, endpointSecret)).toThrow();
      expect(evt.type).toBe(h.headers["openpromoter-event"]);
      expect(evt.id).toBe(h.headers["openpromoter-delivery"]);
      expect(typeof evt.created).toBe("number");
    }
    const parse = (t: string) =>
      hooks.filter((h) => h.headers["openpromoter-event"] === t).map((h) => JSON.parse(h.body).data);
    for (const d of parse("partner.approved")) expect(d).toHaveProperty("recruitedBy");
    expect(parse("partner.approved").find((d) => d.id === partners.sub!.id)?.recruitedBy).toBe(
      partners.one!.id,
    );
    // docs: commission.created carries id, kind, partnerId, amount, currency and status (every commission)
    for (const d of parse("commission.created"))
      for (const k of ["id", "kind", "partnerId", "amount", "currency", "status"])
        expect.soft(d, `commission.created.${k}`).toHaveProperty(k);
    const overrides = parse("commission.created").filter((d) => d.kind === "override");
    for (const o of overrides)
      expect(o).toMatchObject({ parentCommissionId: expect.any(String), subPartnerId: expect.any(String) });
    // a sale override (two-tier) is emitted when the sub partner earns
  });

  test("outgoing webhooks: a redirect counts as a failure and is retried with the same delivery id", async ({
    request,
    browser,
  }) => {
    test.setTimeout(150_000);
    const { ctx, page } = await pageFor(browser, A);
    const url = `http://127.0.0.1:${S.port}/flaky`;
    await page.goto(`/app/${A.programId}/settings/developers`);
    await page.getByRole("button", { name: "Add endpoint" }).click();
    await page.getByRole("dialog").getByLabel("URL").fill(url);
    await page.getByRole("dialog").getByRole("button", { name: "Add" }).click();
    await expect(page.locator("li", { hasText: url })).toBeVisible();
    const secret = (await page.locator("li", { hasText: url }).locator("text=/^whsec_/").textContent())!;
    await ctx.close();
    const p = await json(
      await api(request, A.keys.full).post(`/programs/${A.programId}/partners`, {
        email: `retry-${id}@e2e.test`,
        name: "Retry Me",
      }),
    );
    const hits = await waitFor(async () => {
      const mine = received().filter((r) => r.path === "/flaky" && JSON.parse(r.body).data?.id === p.id);
      return mine.length >= 2 ? mine : null;
    }, 120_000);
    expect(hits[0]!.headers["openpromoter-delivery"]).toBe(hits[1]!.headers["openpromoter-delivery"]);
    expect(hits[1]!.at - hits[0]!.at).toBeGreaterThan(20_000);
    verifyAsDocs(hits[1]!.body, String(hits[1]!.headers["openpromoter-signature"]), secret);
    // the redirect was not followed: /hook never saw this endpoint's delivery id
    expect(
      received().filter(
        (r) =>
          r.path === "/hook" &&
          r.headers["openpromoter-delivery"] === hits[0]!.headers["openpromoter-delivery"],
      ),
    ).toHaveLength(0);
  });

  test("Paddle: signed transaction → commission; partial refund reduces; chargeback holds; bad signatures 400", async ({
    request,
  }) => {
    const url = `/api/webhooks/paddle/${A.workspaceId}`;
    const send = (body: object, opts: { secret?: string; ts?: number; header?: string | null } = {}) => {
      const raw = JSON.stringify(body);
      const ts = opts.ts ?? now();
      const header =
        opts.header === undefined
          ? `ts=${ts};h1=${hmacHex(opts.secret ?? secrets.paddle, `${ts}:${raw}`)}`
          : opts.header;
      return request.post(url, {
        data: raw,
        headers: { "content-type": "application/json", ...(header ? { "paddle-signature": header } : {}) },
      });
    };
    const click = await json(
      await api(request, A.keys.full).post("/clicks", { programId: A.programId, code: partners.one!.code }),
    );
    const ctm = `ctm_${hex(10)}`;
    const txn = `txn_${hex(10)}`;
    const evt = (type: string, data: object) => ({
      event_id: `evt_${hex(12)}`,
      event_type: type,
      occurred_at: new Date().toISOString(),
      notification_id: `ntf_${hex(12)}`,
      data,
    });
    expect(
      (
        await json(
          await send(
            evt("customer.created", {
              id: ctm,
              name: "Pad Buyer",
              email: `pad-${id}@e2e.test`,
              status: "active",
              custom_data: null,
              created_at: new Date().toISOString(),
            }),
          ),
        )
      ).received,
    ).toBe(true);
    const completed = evt("transaction.completed", {
      id: txn,
      status: "completed",
      customer_id: ctm,
      subscription_id: `sub_${hex(10)}`,
      discount_id: null,
      custom_data: { op_click: click.clickId },
      currency_code: "USD",
      billed_at: new Date().toISOString(),
      items: [
        {
          price: {
            id: "pri_1",
            description: "Pro monthly",
            billing_cycle: { interval: "month", frequency: 1 },
          },
          quantity: 1,
        },
      ],
      details: {
        totals: {
          subtotal: "10000",
          discount: "0",
          tax: "2000",
          total: "12000",
          fee: "600",
          earnings: "9400",
          grand_total: "12000",
          currency_code: "USD",
        },
      },
    });
    const r1 = await json(await send(completed));
    expect(r1).toEqual({ received: true, duplicate: false });
    expect((await json(await send(completed))).duplicate).toBe(true);
    const coms = await json(
      await api(request, A.keys.read).get(
        `/programs/${A.programId}/commissions?partnerId=${partners.one!.id}&kind=sale`,
      ),
    );
    const sale = coms.data.find((c: any) => c.saleAmount === 10000);
    expect(sale, "Paddle sale commission booked").toBeTruthy();
    const refs = await json(
      await api(request, A.keys.read).get(`/programs/${A.programId}/referrals?limit=100`),
    );
    expect(refs.data.find((r: any) => r.customerId === ctm)).toMatchObject({
      partnerId: partners.one!.id,
      status: "active",
      revenue: 10000,
    });

    // bad signatures
    expect((await send(completed, { secret: "wrong" })).status()).toBe(400);
    expect((await send(completed, { ts: now() - 3600 })).status()).toBe(400);
    expect((await send(completed, { header: null })).status()).toBe(400);
    expect((await send(completed, { header: "garbage" })).status()).toBe(400);

    // refund adjustment: pending approval does nothing; approved partial refund of half the subtotal halves it
    const adj = (status: string) =>
      evt(status === "pending_approval" ? "adjustment.created" : "adjustment.updated", {
        id: `adj_${txn}`,
        action: "refund",
        type: "partial",
        status,
        reason: "error",
        transaction_id: txn,
        customer_id: ctm,
        currency_code: "USD",
        items: [
          {
            id: "adjitm_1",
            item_id: "txnitm_1",
            type: "partial",
            amount: "6000",
            totals: { subtotal: "5000", tax: "1000", total: "6000" },
          },
        ],
        totals: {
          subtotal: "5000",
          tax: "1000",
          total: "6000",
          fee: "300",
          retained_fee: "0",
          earnings: "4700",
          currency_code: "USD",
        },
      });
    await json(await send(adj("pending_approval")));
    let now1 = await json(
      await api(request, A.keys.read).get(
        `/programs/${A.programId}/commissions?partnerId=${partners.one!.id}`,
      ),
    );
    expect(now1.data.find((c: any) => c.id === sale.id).status).toBe("pending");
    await json(await send(adj("approved")));
    now1 = await json(
      await api(request, A.keys.read).get(
        `/programs/${A.programId}/commissions?partnerId=${partners.one!.id}`,
      ),
    );
    const s2 = now1.data.find((c: any) => c.id === sale.id);
    expect(s2.status, "a 50% Paddle refund must not reverse the whole commission").not.toBe("reversed");
    const reduction = now1.data.filter(
      (c: any) => c.kind === "adjustment" && c.referralId === sale.referralId,
    );
    expect(reduction.map((c: any) => c.amount)).toEqual([-Math.round(sale.amount / 2)]);
  });

  test("Paddle: chargeback warning holds the commission", async ({ request }) => {
    const url = `/api/webhooks/paddle/${A.workspaceId}`;
    const send = (body: object) => {
      const raw = JSON.stringify(body);
      const ts = now();
      return request.post(url, {
        data: raw,
        headers: {
          "content-type": "application/json",
          "paddle-signature": `ts=${ts};h1=${hmacHex(secrets.paddle, `${ts}:${raw}`)}`,
        },
      });
    };
    const ctm = `ctm_${hex(10)}`;
    const txn = `txn_${hex(10)}`;
    await json(
      await send({
        event_id: `evt_${hex(12)}`,
        event_type: "transaction.completed",
        data: {
          id: txn,
          customer_id: ctm,
          subscription_id: null,
          custom_data: { op_ref: partners.three!.code },
          currency_code: "USD",
          billed_at: new Date().toISOString(),
          items: [{ price: { billing_cycle: null } }],
          details: { totals: { subtotal: "8000", discount: "1000", tax: "0", total: "7000" } },
        },
      }),
    );
    const c = (
      await json(
        await api(request, A.keys.read).get(
          `/programs/${A.programId}/commissions?partnerId=${partners.three!.id}&kind=sale`,
        ),
      )
    ).data.find((x: any) => x.saleAmount === 7000);
    expect(c, "commission on subtotal minus discount").toBeTruthy();
    await json(
      await send({
        event_id: `evt_${hex(12)}`,
        event_type: "adjustment.created",
        data: {
          id: `adj_${hex(6)}`,
          action: "chargeback_warning",
          status: "approved",
          transaction_id: txn,
          totals: { subtotal: "8000" },
        },
      }),
    );
    const held = (
      await json(
        await api(request, A.keys.read).get(
          `/programs/${A.programId}/commissions?partnerId=${partners.three!.id}&status=held`,
        ),
      )
    ).data;
    expect(held.map((x: any) => x.id)).toContain(c.id);
  });

  test("Lemon Squeezy: signed order → commission; partial refund; subscription; bad signature 400", async ({
    request,
  }) => {
    const url = `/api/webhooks/lemonsqueezy/${A.workspaceId}`;
    const send = (body: object, secret = secrets.lemonsqueezy, sigOverride?: string) => {
      const raw = JSON.stringify(body);
      return request.post(url, {
        data: raw,
        headers: {
          "content-type": "application/json",
          "x-event-name": (body as any).meta.event_name,
          "x-signature": sigOverride ?? hmacHex(secret, raw),
        },
      });
    };
    const click = await json(
      await api(request, A.keys.full).post("/clicks", { programId: A.programId, code: partners.two!.code }),
    );
    const orderId = String(Math.floor(Math.random() * 1e9));
    const customerId = Math.floor(Math.random() * 1e9);
    const created = new Date().toISOString();
    const order = (event: string, attrs: object) => ({
      meta: { event_name: event, custom_data: { op_click: click.clickId } },
      data: {
        type: "orders",
        id: orderId,
        attributes: {
          store_id: 1,
          customer_id: customerId,
          identifier: hex(8),
          order_number: 1001,
          user_name: "Lem Buyer",
          user_email: `lem-${id}@e2e.test`,
          currency: "USD",
          currency_rate: "1.0",
          subtotal: 10000,
          setup_fee: 0,
          discount_total: 0,
          tax: 2000,
          total: 12000,
          subtotal_usd: 10000,
          total_usd: 12000,
          status: "paid",
          refunded: false,
          refunded_at: null,
          refunded_amount: 0,
          test_mode: false,
          first_order_item: { product_name: "Pro", variant_name: "Default", price: 10000 },
          created_at: created,
          updated_at: created,
          ...attrs,
        },
      },
    });
    expect(await json(await send(order("order_created", {})))).toEqual({ received: true, duplicate: false });
    expect((await send(order("order_created", {}), "wrong")).status()).toBe(400);
    expect((await send(order("order_created", {}), secrets.lemonsqueezy, "")).status()).toBe(400);
    const sale = (
      await json(
        await api(request, A.keys.read).get(
          `/programs/${A.programId}/commissions?partnerId=${partners.two!.id}&kind=sale`,
        ),
      )
    ).data.find((c: any) => c.saleAmount === 10000 && c.status === "pending");
    expect(sale, "Lemon Squeezy sale").toBeTruthy();
    // partial refund of half the order total (refunded_amount includes tax like total)
    await json(
      await send(
        order("order_refunded", {
          status: "partial_refund",
          refunded_amount: 6000,
          updated_at: new Date(Date.now() + 1000).toISOString(),
        }),
      ),
    );
    const adj = (
      await json(
        await api(request, A.keys.read).get(
          `/programs/${A.programId}/commissions?partnerId=${partners.two!.id}&kind=adjustment`,
        ),
      )
    ).data.filter((c: any) => c.referralId === sale.referralId);
    expect(adj.map((c: any) => c.amount)).toEqual([-Math.round(sale.amount / 2)]);
    // subscription status
    await json(
      await send({
        meta: { event_name: "subscription_cancelled", custom_data: { op_click: click.clickId } },
        data: {
          type: "subscriptions",
          id: String(Date.now()),
          attributes: {
            customer_id: customerId,
            order_id: Number(orderId),
            status: "cancelled",
            ends_at: new Date().toISOString(),
            test_mode: false,
            updated_at: created,
          },
        },
      }),
    );
    const refs = await json(
      await api(request, A.keys.read).get(`/programs/${A.programId}/referrals?limit=100`),
    );
    expect(refs.data.find((r: any) => r.customerId === String(customerId))?.status).toBe("canceled");
  });

  test("Polar: Standard Webhooks signature (both secret schemes) → commission; partial refund; bad sig 400", async ({
    request,
  }) => {
    const url = `/api/webhooks/polar/${A.workspaceId}`;
    const send = (body: object, opts: { key?: Buffer; ts?: number; id?: string } = {}) => {
      const raw = JSON.stringify(body);
      const wid = opts.id ?? `msg_${hex(10)}`;
      const ts = String(opts.ts ?? now());
      const key = opts.key ?? Buffer.from(secrets.polar.slice(6), "base64");
      const sig = createHmac("sha256", key).update(`${wid}.${ts}.${raw}`).digest("base64");
      return request.post(url, {
        data: raw,
        headers: {
          "content-type": "application/json",
          "webhook-id": wid,
          "webhook-timestamp": ts,
          "webhook-signature": `v1,${sig}`,
        },
      });
    };
    const click = await json(
      await api(request, A.keys.full).post("/clicks", { programId: A.programId, code: partners.three!.code }),
    );
    const cust = crypto.randomUUID();
    const orderId = crypto.randomUUID();
    const order = (type: string, extra: object) => ({
      type,
      timestamp: new Date().toISOString(),
      data: {
        id: orderId,
        status: "paid",
        paid: true,
        customer_id: cust,
        subscription_id: null,
        product_id: crypto.randomUUID(),
        discount_id: null,
        subtotal_amount: 5000,
        discount_amount: 500,
        net_amount: 4500,
        tax_amount: 900,
        total_amount: 5400,
        refunded_amount: 0,
        refunded_tax_amount: 0,
        currency: "usd",
        billing_reason: "purchase",
        metadata: { op_click: click.clickId },
        created_at: new Date().toISOString(),
        modified_at: null,
        customer: { id: cust, email: `pol-${id}@e2e.test`, metadata: {}, external_id: null },
        product: { name: "Pro", recurring_interval: null },
        discount: null,
        ...extra,
      },
    });
    expect(await json(await send(order("order.paid", {})))).toEqual({ received: true, duplicate: false });
    // a redelivery has the same webhook-id
    const wid = `msg_${hex(10)}`;
    await json(await send(order("order.updated", {}), { id: wid }));
    expect((await json(await send(order("order.updated", {}), { id: wid }))).duplicate).toBe(true);
    // legacy secret scheme: key = UTF-8 bytes of the whole whsec_ string
    expect(
      (await send(order("order.updated", {}), { key: Buffer.from(secrets.polar, "utf8") })).status(),
    ).toBe(200);
    expect((await send(order("order.paid", {}), { key: Buffer.from("whsec_other") })).status()).toBe(400);
    expect((await send(order("order.paid", {}), { ts: now() - 3600 })).status()).toBe(400);
    expect(
      (await request.post(url, { data: "{}", headers: { "content-type": "application/json" } })).status(),
    ).toBe(400);
    const sale = (
      await json(
        await api(request, A.keys.read).get(
          `/programs/${A.programId}/commissions?partnerId=${partners.three!.id}&kind=sale`,
        ),
      )
    ).data.find((c: any) => c.saleAmount === 4500);
    expect(sale, "Polar sale on net_amount").toBeTruthy();
    await json(
      await send(
        order("order.refunded", {
          status: "partially_refunded",
          refunded_amount: 2250,
          refunded_tax_amount: 450,
        }),
      ),
    );
    const adj = (
      await json(
        await api(request, A.keys.read).get(
          `/programs/${A.programId}/commissions?partnerId=${partners.three!.id}&kind=adjustment`,
        ),
      )
    ).data.filter((c: any) => c.referralId === sale.referralId);
    expect(adj.map((c: any) => c.amount)).toEqual([-Math.round(sale.amount / 2)]);
    // subscription revoked → canceled
    await json(
      await send({
        type: "subscription.revoked",
        timestamp: new Date().toISOString(),
        data: {
          id: crypto.randomUUID(),
          customer_id: cust,
          status: "canceled",
          canceled_at: new Date().toISOString(),
        },
      }),
    );
    const refs = await json(
      await api(request, A.keys.read).get(`/programs/${A.programId}/referrals?limit=100`),
    );
    expect(refs.data.find((r: any) => r.customerId === cust)?.status).toBe("canceled");
  });

  test("Chargebee: basic auth → customer attribution, payment commission, refund via refunded_txn_id, wrong auth 400", async ({
    request,
  }) => {
    const url = `/api/webhooks/chargebee/${A.workspaceId}`;
    const send = (body: object, creds = secrets.chargebee) =>
      request.post(url, {
        data: JSON.stringify(body),
        headers: {
          "content-type": "application/json",
          authorization: `Basic ${Buffer.from(creds).toString("base64")}`,
        },
      });
    const click = await json(
      await api(request, A.keys.full).post("/clicks", { programId: A.programId, code: partners.four!.code }),
    );
    const cus = `cb_${hex(6)}`;
    const sub = `sub_${hex(6)}`;
    const txn = `txn_${hex(8)}`;
    const ev = (type: string, content: object) => ({
      id: `ev_${hex(10)}`,
      occurred_at: now(),
      source: "admin_console",
      object: "event",
      api_version: "v2",
      event_type: type,
      content,
    });
    const customer = {
      id: cus,
      email: `cb-${id}@e2e.test`,
      first_name: "Cee",
      last_name: "Bee",
      meta_data: { op_click: click.clickId },
      created_at: now(),
    };
    expect(await json(await send(ev("customer_created", { customer })))).toEqual({
      received: true,
      duplicate: false,
    });
    expect((await send(ev("customer_created", { customer }), "cbuser:wrong")).status()).toBe(400);
    expect(
      (await request.post(url, { data: "{}", headers: { "content-type": "application/json" } })).status(),
    ).toBe(400);
    await json(
      await send(
        ev("payment_succeeded", {
          transaction: {
            id: txn,
            customer_id: cus,
            subscription_id: sub,
            type: "payment",
            status: "success",
            amount: 13950,
            currency_code: "USD",
            date: now(),
          },
          invoice: {
            id: `inv_${hex(4)}`,
            customer_id: cus,
            subscription_id: sub,
            sub_total: 15000,
            total: 13950,
            tax: 0,
            discounts: [
              {
                amount: 1050,
                entity_type: "document_level_coupon",
                entity_id: "LAUNCH7",
                description: "Launch 7%",
              },
            ],
          },
          customer,
          subscription: {
            id: sub,
            customer_id: cus,
            status: "active",
            billing_period: 1,
            billing_period_unit: "month",
            mrr: 13950,
            meta_data: {},
          },
        }),
      ),
    );
    const sale = (
      await json(
        await api(request, A.keys.read).get(
          `/programs/${A.programId}/commissions?partnerId=${partners.four!.id}&kind=sale`,
        ),
      )
    ).data.find((c: any) => c.saleAmount === 13950);
    expect(sale, "Chargebee sale on sub_total minus discounts").toBeTruthy();
    // a real Chargebee refund links the original payment with refunded_txn_id
    await json(
      await send(
        ev("payment_refunded", {
          transaction: {
            id: `txn_${hex(8)}`,
            customer_id: cus,
            subscription_id: sub,
            type: "refund",
            status: "success",
            amount: 13950,
            currency_code: "USD",
            date: now(),
            refunded_txn_id: txn,
          },
          invoice: { id: "inv_x", total: 13950, sub_total: 15000 },
          credit_note: { id: "CN-1", total: 13950 },
          customer,
        }),
      ),
    );
    const after = (
      await json(
        await api(request, A.keys.read).get(
          `/programs/${A.programId}/commissions?partnerId=${partners.four!.id}`,
        ),
      )
    ).data.find((c: any) => c.id === sale.id);
    expect(after.status, "full Chargebee refund reverses the commission").toBe("reversed");
  });

  test("webhook route: unknown provider 404, unconfigured workspace 404, oversized body 413", async ({
    request,
  }) => {
    expect((await request.post(`/api/webhooks/square/${A.workspaceId}`, { data: "{}" })).status()).toBe(404);
    expect((await request.post(`/api/webhooks/paddle/ws_nope`, { data: "{}" })).status()).toBe(404);
    expect((await request.post(`/api/webhooks/paddle/${B.workspaceId}`, { data: "{}" })).status()).toBe(404);
    const big = await request.post(`/api/webhooks/lemonsqueezy/${A.workspaceId}`, {
      data: "x".repeat(2_100_000),
      headers: { "content-type": "application/json", "x-signature": "00" },
    });
    expect(big.status()).toBe(413);
  });

  test("exports: CSV kinds, workspace JSON and account JSON enforce sign-in and tenancy", async ({
    request,
    browser,
  }) => {
    const ca = await pageFor(browser, A);
    const cb = await pageFor(browser, B);
    const endpointSecret = S.endpointSecret;
    for (const p of [
      `/api/export/partners?program=${A.programId}`,
      `/api/export/workspace?workspace=${A.workspaceId}`,
      "/api/account/export",
    ])
      expect((await request.get(p)).status(), p).toBe(401);
    const a = ca.ctx.request;
    // spreadsheet formula injection: a partner-controlled name must not start a formula in the CSV
    await json(
      await api(request, A.keys.full).post(`/programs/${A.programId}/partners`, {
        email: `csv-${id}@e2e.test`,
        name: '=HYPERLINK("http://x","y")',
      }),
    );
    const pcsv = await (await a.get(`/api/export/partners?program=${A.programId}`)).text();
    const row = pcsv.split(/\r?\n/).find((l) => l.includes(`csv-${id}@e2e.test`))!;
    expect(row).not.toMatch(/(^|,)"?=HYPERLINK/);
    const heads: Record<string, string> = {
      partners: "id,name,email,status,code,website,country,risk_score,payout_method,created_at",
      customers: "id,email,partner,status,via,customer_id,revenue,mrr,signed_up,first_paid",
      commissions: "id,partner,kind,status,sale,commission,currency,description,payout_id,created_at",
      payouts: "invoice,partner,email,amount,currency,method,status,paypal_email,reference,paid_at",
    };
    for (const [kind, head] of Object.entries(heads)) {
      const r = await a.get(`/api/export/${kind}?program=${A.programId}`);
      expect(r.status(), kind).toBe(200);
      expect(r.headers()["content-type"]).toContain("text/csv");
      expect(r.headers()["content-disposition"]).toContain(`${kind}-`);
      const text = await r.text();
      const lines = text.trim().split(/\r?\n/);
      expect(lines[0]).toBe(head);
      if (kind === "partners") {
        const viaApi = await json(
          await api(request, A.keys.read).get(`/programs/${A.programId}/partners?limit=100`),
        );
        expect(lines.length - 1).toBe(viaApi.data.length);
        expect(text).toContain(partners.one!.email);
      }
      if (kind === "payouts") {
        const viaApi = await json(
          await api(request, A.keys.read).get(`/programs/${A.programId}/payouts?limit=100`),
        );
        expect(lines.length - 1).toBe(viaApi.data.length);
      }
    }
    for (const kind of ["analytics", "audit", "1099"]) {
      const r = await a.get(`/api/export/${kind}?program=${A.programId}`);
      expect(r.status(), kind).toBe(200);
      expect(r.headers()["content-type"]).toContain("text/csv");
    }
    const audit = await (await a.get(`/api/export/audit?program=${A.programId}`)).text();
    expect(audit).toContain("api_key.create");
    expect(audit).not.toContain(A.keys.full);
    expect((await a.get(`/api/export/nope?program=${A.programId}`)).status()).toBe(404);
    // founder B can't export A
    for (const kind of ["partners", "customers", "commissions", "payouts", "analytics", "audit", "1099"])
      expect((await cb.ctx.request.get(`/api/export/${kind}?program=${A.programId}`)).status(), kind).toBe(
        404,
      );
    expect((await cb.ctx.request.get(`/api/export/workspace?workspace=${A.workspaceId}`)).status()).toBe(404);

    const ws = await a.get(`/api/export/workspace?workspace=${A.workspaceId}`);
    expect(ws.status()).toBe(200);
    expect(ws.headers()["content-type"]).toContain("application/json");
    const wsText = await ws.text();
    const w = JSON.parse(wsText);
    expect(w.programs.map((p: any) => p.id)).toEqual([A.programId]);
    expect(w.partners).toHaveLength(
      (await json(await api(request, A.keys.read).get(`/programs/${A.programId}/partners?limit=100`))).data
        .length,
    );
    expect(w.team).toEqual([{ email: `ada-${id}@e2e.test`, name: "Ada Founder", role: "owner" }]);
    for (const k of ["commissions", "payouts", "referrals", "clicks", "auditLog"])
      expect(Array.isArray(w[k]), k).toBe(true);
    expect(w.payouts.length).toBeGreaterThanOrEqual(2);
    for (const secret of [...Object.values(secrets), endpointSecret, ...Object.values(A.keys)])
      expect(wsText).not.toContain(secret);
    expect(wsText).not.toContain(B.programId);

    const me = await a.get("/api/account/export");
    expect(me.status()).toBe(200);
    const mj = JSON.parse(await me.text());
    expect(mj.user.email).toBe(`ada-${id}@e2e.test`);
    expect(mj.memberships).toHaveLength(1);
    expect(JSON.stringify(mj)).not.toMatch(/"password"|"token"/);
    await ca.ctx.close();
    await cb.ctx.close();
  });

  test("rate limit: 600 requests per minute per key, then 429 rate_limited", async ({ request }) => {
    const r = api(request, A.keys.rate);
    let ok = 0;
    let limited = 0;
    let code = "";
    for (let batch = 0; batch < 13; batch++) {
      const res = await Promise.all(Array.from({ length: 50 }, () => r.get("/programs")));
      for (const x of res) {
        if (x.status() === 200) ok++;
        else if (x.status() === 429) {
          limited++;
          code = (await x.json()).error.code;
        }
      }
    }
    expect(ok).toBe(600);
    expect(limited).toBe(50);
    expect(code).toBe("rate_limited");
    // other keys are unaffected
    expect((await api(request, A.keys.read).get("/programs")).status()).toBe(200);
  });
});
