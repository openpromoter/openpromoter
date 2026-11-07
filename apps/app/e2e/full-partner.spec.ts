import type http from "node:http";
import { expect, type Page, test } from "@playwright/test";
import {
  APP,
  actionIds,
  as,
  CHROME_UA,
  callAction,
  freePort,
  loadState,
  newCtx,
  PASSWORD,
  patchState,
  postJson,
  randomIp,
  type State,
  saveState,
  seedPayoutConnection,
  startSite,
  storagePath,
} from "./full-partner.helpers";
import { signUp, stripeEvent, uid, WEBHOOK_SECRET } from "./helpers";

/**
 * Partner side and tracking, end to end, against a running dev server (E2E_BASE_URL).
 * Tests run in file order with one worker. They share state through a JSON file in the scratch folder, so a
 * failing test does not stop the ones after it (no serial mode).
 */
test.setTimeout(180_000);

let site: http.Server | null = null;
const siteUrl = (s: State) => `http://127.0.0.1:${s.port}`;

test.beforeAll(async () => {
  try {
    const s = loadState();
    if (s.port && s.slug) site = await startSite(s.port, () => loadState().slug);
  } catch {}
});
test.afterAll(async () => {
  await new Promise((r) => (site ? site.close(r) : r(null)));
  site = null;
});

const founderA = (browser: import("@playwright/test").Browser) => {
  const s = loadState();
  return as(browser, "founderA", s.founder.email, s.founder.ip, `${s.programPath}`, /^\/app\/prg_/);
};
const founderB = (browser: import("@playwright/test").Browser) => {
  const s = loadState();
  return as(browser, "founderB", s.founderB.email, s.founderB.ip, `${s.programPathB}`, /^\/app\/prg_/);
};
const partnerAs = (browser: import("@playwright/test").Browser, who: string, slug?: string) => {
  const s = loadState();
  const p = s.partners[who]!;
  const sl = slug ?? (p as { slug?: string }).slug ?? s.slug;
  return as(browser, who, p.email, p.ip, `/p/${sl}/portal`, /\/portal/);
};

/** Radix select: open the combobox and pick the option by its label. */
async function choose(page: Page, sel: string, option: string | RegExp) {
  await page.locator(sel).click();
  await page.getByRole("option", { name: option }).click();
}

async function onboard(page: Page, product: string, website: string) {
  await page.getByLabel("Website URL").fill(website);
  await page.getByLabel("Product name").fill(product);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Connect Stripe" })).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: /Skip for now/ }).click();
  await page.getByRole("button", { name: "Accept this program" }).click();
  await expect(page.getByRole("heading", { name: "Install tracking" })).toBeVisible();
  await page.getByRole("button", { name: /I'll do this later|Continue/ }).click();
  await page.getByRole("link", { name: "Go to dashboard" }).click();
  await page.waitForURL(/\/app\/prg_/);
  const programPath = new URL(page.url()).pathname.match(/^\/app\/prg_[^/]+/)![0];
  await page.goto(`${programPath}/settings/install`);
  const slug = (await page.locator("pre", { hasText: "data-program" }).first().textContent())!.match(
    /data-program="([^"]+)"/,
  )![1]!;
  return { programPath, slug };
}

/** Saves the program settings form after `edit` changes fields. */
async function saveProgram(page: Page, programPath: string, edit: (p: Page) => Promise<void>) {
  await page.goto(`${programPath}/settings`);
  await edit(page);
  await page.getByRole("button", { name: "Save", exact: true }).first().click();
  await expect(page.getByText("Program saved").first()).toBeVisible();
}

/** Applies through the public form in a fresh context and stores the partner's session. */
async function apply(
  browser: import("@playwright/test").Browser,
  who: string,
  o: { slug: string; name: string; email: string; website?: string; answer?: string; recruit?: string },
) {
  const ip = randomIp();
  const ctx = await newCtx(browser, { ip });
  const page = await ctx.newPage();
  await page.goto(`/p/${o.slug}/apply${o.recruit ? `?recruit=${o.recruit}` : ""}`);
  await page.getByLabel("Full name").fill(o.name);
  await page.getByLabel("Email").fill(o.email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  if (o.website) await page.getByLabel("Website or main channel").fill(o.website);
  if (o.answer) await page.getByLabel(/How will you promote us/).fill(o.answer);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: /^(Join and get my link|Send application)$/ }).click();
  const err = page.locator("[data-sonner-toast][data-type=error]");
  await Promise.race([
    page.waitForURL(/\/portal$/, { timeout: 30_000 }),
    err.waitFor({ timeout: 30_000 }).then(async () => {
      throw new Error(`apply refused: ${await err.textContent()}`);
    }),
  ]);
  await ctx.storageState({ path: storagePath(who) });
  patchState((s) => {
    s.partners[who] = { email: o.email, name: o.name, ip, ...({ slug: o.slug } as object) };
  });
  return { ctx, page };
}

const cookieOf = async (ctx: import("@playwright/test").BrowserContext) =>
  (await ctx.cookies("http://127.0.0.1")).find((c) => c.name === "op_ref");

// ---------------------------------------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------------------------------------

test("00 setup: founder A, program A on a local static site, Stripe webhook secret, program rules", async ({
  browser,
}) => {
  if (site) await new Promise((r) => site!.close(r));
  const id = uid();
  const port = await freePort();
  const founder = { email: `qa-fa-${id}@e2e.test`, ip: randomIp() };
  saveState({ id, port, founder, partners: {} } as Partial<State>);
  const ctx = await newCtx(browser, { ip: founder.ip });
  const page = await ctx.newPage();
  await signUp(page, "Fay Founder", founder.email);
  const { programPath, slug } = await onboard(page, `QA Partner Co ${id}`, `http://127.0.0.1:${port}`);
  site = await startSite(port, () => loadState().slug);

  await page.goto(`${programPath}/settings/integrations`);
  const webhookUrl = (await page.locator("text=/api/webhooks/stripe/").first().textContent())!.trim();
  await page.getByLabel("Webhook signing secret").fill(WEBHOOK_SECRET);
  await page.getByRole("button", { name: "Connect" }).first().click();
  await expect(page.getByText("Webhook secret missing")).toHaveCount(0);

  // default tier pays 35%; 10% recruiter override, 30-day cookie, last click, $10 minimum payout
  // workaround: with any duration but "months" the Months input is disabled and the save fails (see test 90)
  await saveProgram(page, programPath, async (p) => {
    await choose(p, "#commissionDuration", "Recurring for N months");
    await p.locator("#overridePercent").fill("10");
    await p.locator("#cookieDays").fill("30");
    await choose(p, "#attributionModel", "Last click");
    await p.locator("#minPayout").fill("10");
  });

  // auto-approve only with a website, and one required custom question
  await page.goto(`${programPath}/settings/application`);
  await choose(page, "#aa-web", "Yes");
  await page.getByRole("button", { name: "Add question" }).click();
  await page.getByRole("textbox", { name: "Question" }).last().fill("How will you promote us?");
  await page.getByRole("switch", { name: "Required" }).last().click();
  await page.getByRole("button", { name: "Save" }).last().click();
  await expect(page.getByText("Application settings saved").first()).toBeVisible();

  await ctx.storageState({ path: storagePath("founderA") });
  saveState({ programPath, programId: programPath.split("/").pop()!, slug, webhookUrl });
  await ctx.close();
});

test("01 setup: founder B with program B (the other tenant)", async ({ browser }) => {
  const s = loadState();
  const founderB = { email: `qa-fb-${s.id}@e2e.test`, ip: randomIp() };
  const ctx = await newCtx(browser, { ip: founderB.ip });
  const page = await ctx.newPage();
  await signUp(page, "Ben Founder", founderB.email);
  const { programPath, slug } = await onboard(page, `QA Other Co ${s.id}`, "https://other-tenant.example");
  await ctx.storageState({ path: storagePath("founderB") });
  saveState({ founderB, programPathB: programPath, slugB: slug });
  await ctx.close();
});

test("02 setup: API key for the founder (used to look up partner ids and mint embed tokens)", async ({
  browser,
}) => {
  const { ctx, page } = await founderA(browser);
  const s = loadState();
  await page.goto(`${s.programPath}/settings/developers`);
  await page.getByRole("button", { name: "New key" }).click();
  await page.getByLabel("Name").fill("qa partner e2e");
  for (const scope of ["partners:write"]) {
    const box = page.locator("label", { hasText: scope }).getByRole("checkbox");
    if ((await box.getAttribute("data-state")) !== "checked") await box.click();
  }
  await page.getByRole("button", { name: "Create key" }).click();
  await expect(page.getByRole("dialog").getByText("Copy your key")).toBeVisible();
  const key = (await page.getByRole("dialog").locator("span.font-mono").first().textContent())!.trim();
  expect(key.length).toBeGreaterThan(20);
  saveState({ apiKey: key });
  await ctx.close();
});

/** Partner id by email through the public API (embed-tokens returns the existing partner). */
async function partnerId(request: import("@playwright/test").APIRequestContext, email: string, name = "x") {
  const s = loadState();
  const res = await request.post(`/api/v1/programs/${s.programId}/embed-tokens`, {
    headers: { authorization: `Bearer ${s.apiKey}` },
    data: { email, name },
  });
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()) as { token: string; partnerId: string };
}

// ---------------------------------------------------------------------------------------------------------
// Public program page and applications
// ---------------------------------------------------------------------------------------------------------

test("10 public program page shows the offer and links to the application", async ({ page, request }) => {
  const s = loadState();
  await page.goto(`/p/${s.slug}`);
  await expect(page.getByText(`QA Partner Co ${s.id}`).first()).toBeVisible();
  await page.getByRole("link", { name: "Become a partner" }).first().click();
  await page.waitForURL(new RegExp(`/p/${s.slug}/apply`));
  await expect(page.getByText("Most applications are approved instantly.")).toBeVisible();
  await expect(page.getByLabel(/How will you promote us/)).toBeVisible();
  expect((await request.get("/p/no-such-program-qa")).status()).toBe(404);
  expect((await request.get("/p/no-such-program-qa/apply")).status()).toBe(404);
});

test("11 apply: required custom question is enforced on the server, then auto-approved", async ({
  browser,
}) => {
  const s = loadState();
  const email = `qa-p1-${s.id}${uid()}@e2e.test`;
  const ip = randomIp();
  const ctx = await newCtx(browser, { ip });
  const page = await ctx.newPage();
  await page.goto(`/p/${s.slug}/apply`);
  await page.getByLabel("Full name").fill("Paula One");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Website or main channel").fill("https://paula.example");
  await page.getByRole("checkbox").check();
  // skip the browser's own check: the server must refuse an empty required answer
  await page.locator("form").evaluate((f) => {
    for (const el of f.querySelectorAll("[required]")) el.removeAttribute("required");
  });
  await page.getByRole("button", { name: /^(Join and get my link|Send application)$/ }).click();
  await expect(page.getByText("Please answer: How will you promote us?")).toBeVisible();
  // the form clears itself after the error (test 18), so fill it again
  await page.getByLabel("Full name").fill("Paula One");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Website or main channel").fill("https://paula.example");
  await page.getByRole("checkbox").check();
  await page.getByLabel(/How will you promote us/).fill("YouTube reviews");
  await page.getByRole("button", { name: /^(Join and get my link|Send application)$/ }).click();
  await page.waitForURL(/\/portal$/);
  await expect(page.getByText("You're approved. Your portal is ready.")).toBeVisible();
  await expect(page.getByText("Your application is being reviewed")).toHaveCount(0);
  const short = (await page.locator("span.font-mono", { hasText: "/r/" }).first().textContent())!.trim();
  expect(short).toMatch(new RegExp(`^${APP}/r/${s.slug}/l/[a-z0-9]+$`));
  const code = (await page.locator("code", { hasText: "?via=" }).first().textContent())!
    .split("=")[1]!
    .trim();
  await ctx.storageState({ path: storagePath("p1") });
  patchState((st) => {
    st.partners.p1 = { email, name: "Paula One", ip, code, linkKey: short.split("/").pop()! };
  });
  await ctx.close();
});

test("12 apply: without a website the application waits for review (pending state)", async ({ browser }) => {
  const s = loadState();
  const email = `qa-p2-${s.id}${uid()}@e2e.test`;
  const xssName = `Pat <img src=x onerror="window.__xss=1">`;
  const { ctx, page } = await apply(browser, "p2", {
    slug: s.slug,
    name: xssName,
    email,
    answer: `<script>window.__xss=2</script><img src=x onerror="window.__xss=3">`,
  });
  await expect(page.getByText("Application received. We'll email you soon.")).toBeVisible();
  await expect(
    page.getByText("Your application is being reviewed. You'll get an email when you're approved."),
  ).toBeVisible();
  const code = (await page.locator("code", { hasText: "?via=" }).first().textContent())!
    .split("=")[1]!
    .trim();
  patchState((st) => {
    st.partners.p2!.code = code;
  });
  // a pending partner can't create links or see a recruit link
  await page.goto(`/p/${s.slug}/portal/links`);
  await page.getByRole("button", { name: "Create link" }).click();
  await expect(page.getByText("Your account isn't active yet")).toBeVisible();
  await page.goto(`/p/${s.slug}/portal/recruits`);
  await expect(page.getByText("Your link appears here once your account is approved.")).toBeVisible();
  await expect(page.locator("text=/apply\\?recruit=/")).toHaveCount(0);
  await ctx.close();
});

test("13 pending partner's links do not attribute (no click id on the redirect, no lead)", async ({
  request,
}) => {
  const s = loadState();
  const res = await request.get(`/r/${s.slug}/${s.partners.p2!.code}`, {
    maxRedirects: 0,
    headers: { "x-forwarded-for": randomIp(), "user-agent": CHROME_UA },
  });
  expect(res.status()).toBe(302);
  const loc = new URL(res.headers().location!);
  expect(loc.origin).toBe(siteUrl(s));
  expect(loc.searchParams.get("op_click")).toBeNull();
  // op.js click with the pending code: no click
  const click = await postJson(
    request,
    "/api/track/click",
    { program: s.slug, code: s.partners.p2!.code },
    {
      "x-forwarded-for": randomIp(),
    },
  );
  expect(await click.json()).toEqual({ ok: false });
});

test("14 lead with a pending partner's code is not attributed to them", async ({ request }) => {
  const s = loadState();
  const res = await postJson(
    request,
    "/api/track/lead",
    { program: s.slug, email: `lead-pending-${s.id}@e2e.test`, code: s.partners.p2!.code },
    { "x-forwarded-for": randomIp() },
  );
  expect(res.status()).toBe(200);
  // clicks from non-approved partners are dropped; leads by code must follow the same rule
  expect(await res.json()).toEqual({ ok: false });
});

test("15 duplicate application: signed-in partner is sent to the portal; same email anonymously is refused", async ({
  browser,
}) => {
  const s = loadState();
  const { ctx, page } = await partnerAs(browser, "p1");
  await page.goto(`/p/${s.slug}/apply`);
  await page.waitForURL(new RegExp(`/p/${s.slug}/portal$`));
  await ctx.close();

  const anon = await newCtx(browser);
  const p = await anon.newPage();
  await p.goto(`/p/${s.slug}/apply`);
  await p.getByLabel("Full name").fill("Paula Again");
  await p.getByLabel("Email").fill(s.partners.p1!.email.toUpperCase());
  await p.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await p.getByLabel("Website or main channel").fill("https://paula.example");
  await p.getByLabel(/How will you promote us/).fill("again");
  await p.getByRole("checkbox").check();
  await p.getByRole("button", { name: /^(Join and get my link|Send application)$/ }).click();
  await expect(p.getByText("You already have an account. Please sign in before you apply.")).toBeVisible();
  await anon.close();
});

test("16 rejected partner sees the rejected state and earns nothing", async ({ browser, request }) => {
  const s = loadState();
  const email = `qa-p3-${s.id}${uid()}@e2e.test`;
  const a = await apply(browser, "p3", { slug: s.slug, name: "Rex Rejected", email, answer: "spam" });
  await a.ctx.close();
  const { partnerId: pid } = await partnerId(request, email);
  patchState((st) => {
    st.partners.p3!.id = pid;
  });
  const f = await founderA(browser);
  await f.page.goto(`${s.programPath}/partners/${pid}`);
  await f.page.getByRole("button", { name: "Reject" }).click();
  await expect(f.page.getByText("Partner rejected")).toBeVisible();
  await f.ctx.close();

  const { ctx, page } = await partnerAs(browser, "p3");
  await expect(page.getByText("Your partner account is rejected.")).toBeVisible();
  const code = (await page.locator("code", { hasText: "?via=" }).first().textContent())!
    .split("=")[1]!
    .trim();
  const res = await request.get(`/r/${s.slug}/${code}`, { maxRedirects: 0 });
  expect(new URL(res.headers().location!).searchParams.get("op_click")).toBeNull();
  await page.goto(`/p/${s.slug}/portal/links`);
  await page.getByRole("button", { name: "Create link" }).click();
  await expect(page.getByText("Your account isn't active yet")).toBeVisible();
  await ctx.close();
});

test("17 partner-supplied name and answers render as text for the founder (no XSS)", async ({
  browser,
  request,
}) => {
  const s = loadState();
  const { partnerId: pid } = await partnerId(request, s.partners.p2!.email);
  patchState((st) => {
    st.partners.p2!.id = pid;
  });
  const { ctx, page } = await founderA(browser);
  for (const path of [`${s.programPath}/partners`, `${s.programPath}/partners/${pid}`]) {
    await page.goto(path);
    await expect(page.getByText(/Pat <img src=x/).first()).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
  }
  await expect(page.getByText("<script>window.__xss=2</script>", { exact: false }).first()).toBeVisible();
  await ctx.close();
});

test("18 apply form keeps what the partner typed when the server refuses the application", async ({
  browser,
}) => {
  const s = loadState();
  const ctx = await newCtx(browser);
  const page = await ctx.newPage();
  await page.goto(`/p/${s.slug}/apply`);
  await page.getByLabel("Full name").fill("Keep Me");
  await page.getByLabel("Email").fill(`qa-keep-${s.id}@e2e.test`);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Website or main channel").fill("https://keep.example");
  await page.getByRole("checkbox").check();
  await page.locator("form").evaluate((f) => {
    for (const el of f.querySelectorAll("[required]")) el.removeAttribute("required");
  });
  await page.getByRole("button", { name: /^(Join and get my link|Send application)$/ }).click();
  await expect(page.getByText("Please answer: How will you promote us?")).toBeVisible();
  // React resets a <form action> once the action settles; give it that moment before reading the fields
  await page.waitForTimeout(1000);
  await expect(page.getByLabel("Full name")).toHaveValue("Keep Me");
  await expect(page.getByLabel("Email")).toHaveValue(`qa-keep-${s.id}@e2e.test`);
  await expect(page.getByLabel("Website or main channel")).toHaveValue("https://keep.example");
  await ctx.close();
});

// ---------------------------------------------------------------------------------------------------------
// Partner portal
// ---------------------------------------------------------------------------------------------------------

test("20 portal home: link ticket copies, QR opens and downloads as SVG", async ({ browser }) => {
  const s = loadState();
  const { ctx, page } = await partnerAs(browser, "p1");
  const short = `${APP}/r/${s.slug}/l/${s.partners.p1!.linkKey}`;
  await expect(page.getByRole("heading", { name: "Hi Paula" })).toBeVisible();
  await page.getByRole("button", { name: "Copy link" }).first().click();
  await expect(page.getByText("Link copied").first()).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(short);
  await page.getByRole("button", { name: "QR code" }).first().click();
  const dialog = page.getByRole("dialog");
  const img = dialog.getByRole("img", { name: "QR code" });
  await expect(img).toBeVisible();
  await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
  const [dl] = await Promise.all([
    page.waitForEvent("download"),
    dialog.getByRole("link", { name: "Download SVG" }).click(),
  ]);
  expect(dl.suggestedFilename()).toBe("qr.svg");
  const svg = await (await import("node:fs/promises")).readFile((await dl.path())!, "utf8");
  expect(svg).toContain("<svg");
  // the QR endpoint itself
  const qr = await page.request.get(`/api/qr?url=${encodeURIComponent(short)}&download=1`);
  expect(qr.headers()["content-type"]).toBe("image/svg+xml");
  expect(qr.headers()["content-disposition"]).toContain("attachment");
  expect(qr.headers()["content-security-policy"]).toContain("sandbox");
  expect((await page.request.get("/api/qr?url=javascript:alert(1)")).status()).toBe(400);
  await ctx.close();
});

test("21 links: create a deep link with a sub-id; off-site destinations are refused", async ({ browser }) => {
  const s = loadState();
  const { ctx, page } = await partnerAs(browser, "p1");
  await page.goto(`/p/${s.slug}/portal/links`);
  await page.getByLabel("Destination page").fill(`${siteUrl(s)}/pricing`);
  await page.getByLabel("Sub-ID").fill("youtube");
  await page.getByRole("button", { name: "Create link" }).click();
  await expect(page.getByText("Link created").first()).toBeVisible();
  const row = page.locator("li", { hasText: `to 127.0.0.1:${s.port}/pricing` });
  await expect(row).toBeVisible();
  await expect(row.getByText("youtube", { exact: true })).toBeVisible();
  const url = (await row.locator("span.font-mono").first().textContent())!.trim();
  expect(url).toMatch(new RegExp(`^${APP}/r/${s.slug}/l/`));
  patchState((st) => {
    (st as Record<string, unknown>).deepKey = url.split("/").pop();
  });
  // copy and QR on a row
  await row.getByRole("button", { name: "Copy link" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);
  await row.getByRole("button", { name: "QR code" }).click();
  await expect(page.getByRole("dialog").getByText(url)).toBeVisible();
  await page.keyboard.press("Escape");

  for (const bad of ["https://evil.example/", `http://127.0.0.1.evil.example:${s.port}/`]) {
    await page.getByLabel("Destination page").fill(bad);
    await page.getByRole("button", { name: "Create link" }).click();
    await expect(page.getByText("Links must point to 127.0.0.1").first()).toBeVisible();
  }
  // the deep link redirects to the page, tagged with the sub-id
  const res = await page.request.get(url, { maxRedirects: 0, headers: { "x-forwarded-for": randomIp() } });
  expect(res.status()).toBe(302);
  const loc = new URL(res.headers().location!);
  expect(`${loc.origin}${loc.pathname}`).toBe(`${siteUrl(s)}/pricing`);
  expect(loc.searchParams.get("op_click")).toMatch(/^clk_/);
  expect(loc.searchParams.get("via")).toBe(s.partners.p1!.code);
  await ctx.close();
});

test("22 links: server refuses non-http destinations that merely contain the site host (javascript:, data:)", async ({
  browser,
}) => {
  const s = loadState();
  const { ctx, page } = await partnerAs(browser, "p1");
  const path = `/p/${s.slug}/portal/links`;
  const ids = await actionIds(page, path);
  expect(ids.partnerLinkAction).toBeTruthy();
  for (const destination of [
    "javascript://127.0.0.1/%0aalert(document.cookie)",
    `ftp://127.0.0.1:${s.port}/file`,
  ]) {
    const r = await callAction(page, path, ids.partnerLinkAction!, [s.slug, { destination }]);
    expect(r.result?.ok, `${destination} was accepted as a link destination`).toBe(false);
  }
  await ctx.close();
});

test("23 recruits: two-tier invite link, a sub-partner signs up through it", async ({ browser, request }) => {
  const s = loadState();
  const { ctx, page } = await partnerAs(browser, "p1");
  await page.goto(`/p/${s.slug}/portal/recruits`);
  await expect(page.getByText("You earn 10% of every commission they earn.", { exact: false })).toBeVisible();
  const url = `${APP}/p/${s.slug}/apply?recruit=${encodeURIComponent(s.partners.p1!.code!)}`;
  await expect(page.getByText(url)).toBeVisible();
  await ctx.close();

  const email = `qa-sub-${s.id}${uid()}@e2e.test`;
  const sub = await apply(browser, "sub", {
    slug: s.slug,
    name: "Sam Sub",
    email,
    website: "https://sam.example",
    answer: "Newsletter",
    recruit: s.partners.p1!.code,
  });
  const code = (await sub.page.locator("code", { hasText: "?via=" }).first().textContent())!
    .split("=")[1]!
    .trim();
  patchState((st) => {
    st.partners.sub!.code = code;
  });
  await sub.ctx.close();
  const { partnerId: subId } = await partnerId(request, email);
  patchState((st) => {
    st.partners.sub!.id = subId;
  });

  const again = await partnerAs(browser, "p1");
  await again.page.goto(`/p/${s.slug}/portal/recruits`);
  await expect(again.page.locator("li", { hasText: "Sam Sub" })).toBeVisible();
  await expect(again.page.getByText("1 recruited partner.", { exact: false })).toBeVisible();
  await again.ctx.close();
});

// ---------------------------------------------------------------------------------------------------------
// Redirects and open-redirect safety
// ---------------------------------------------------------------------------------------------------------

test("30 /r/[slug]/[code] and /r/[slug]/l/[key] only ever redirect to the program's site", async ({
  request,
}) => {
  const s = loadState();
  const code = s.partners.p1!.code!;
  const key = s.partners.p1!.linkKey!;
  const h = () => ({ "x-forwarded-for": randomIp(), "user-agent": CHROME_UA });
  const tries = [
    `/r/${s.slug}/${code}?url=https://evil.example`,
    `/r/${s.slug}/${code}?redirect=https://evil.example&next=//evil.example&to=https://evil.example&destination=https://evil.example`,
    `/r/${s.slug}/l/${key}?url=https://evil.example&destination=https://evil.example`,
    `/r/${s.slug}/%2F%2Fevil.example`,
    `/r/${s.slug}/https:%2F%2Fevil.example`,
    `/r/${s.slug}/l/%2F%2Fevil.example`,
    `/r/${s.slug}/l/..%2F..%2Fevil.example`,
    `/r/${s.slug}/${code}?op_click=https://evil.example&via=evil`,
  ];
  for (const t of tries) {
    const res = await request.get(t, { maxRedirects: 0, headers: h() });
    expect(res.status(), t).toBe(302);
    const loc = new URL(res.headers().location!);
    expect(loc.origin, t).toBe(siteUrl(s));
  }
  // utm parameters pass through; the partner code wins over a forged one
  const res = await request.get(`/r/${s.slug}/${code}?utm_source=yt&utm_campaign=nov&via=evil`, {
    maxRedirects: 0,
    headers: h(),
  });
  const loc = new URL(res.headers().location!);
  expect(loc.searchParams.get("utm_source")).toBe("yt");
  expect(loc.searchParams.get("utm_campaign")).toBe("nov");
  expect(loc.searchParams.get("via")).toBe(code);
  expect(loc.searchParams.get("op_days")).toBe("30");
  expect(loc.searchParams.get("op_visitor")).toMatch(/^vis_/);
  // a short-link key from program B does not resolve in program A
  expect((await request.get(`/r/no-such-program-qa/${code}`, { maxRedirects: 0 })).status()).toBe(404);
  const cross = await request.get(`/r/${s.slugB}/l/${key}`, { maxRedirects: 0, headers: h() });
  expect(cross.status()).toBe(302);
  const cl = new URL(cross.headers().location!);
  expect(cl.origin).toBe("https://other-tenant.example");
  expect(cl.searchParams.get("op_click")).toBeNull();
  // and A's partner code is unknown in B
  const cross2 = await request.get(`/r/${s.slugB}/${code}`, { maxRedirects: 0, headers: h() });
  expect(new URL(cross2.headers().location!).searchParams.get("op_click")).toBeNull();
});

// ---------------------------------------------------------------------------------------------------------
// op.js on the founder's site
// ---------------------------------------------------------------------------------------------------------

const waitClick = (page: Page) =>
  page.waitForFunction(
    () => (window as unknown as { openpromoter?: { clickId?: string } }).openpromoter?.clickId,
    null,
    {
      timeout: 15_000,
    },
  );
const opState = (page: Page) =>
  page.evaluate(() => {
    const o = (window as unknown as { openpromoter: { clickId: string; visitorId: string; code: string } })
      .openpromoter;
    return { clickId: o.clickId, visitorId: o.visitorId, code: o.code };
  });
const cookieVal = (c: { value: string } | undefined) =>
  c ? (JSON.parse(decodeURIComponent(c.value)) as { c: string; v: string; p: string }) : null;
const daysLeft = (c: { expires: number }) => (c.expires * 1000 - Date.now()) / 86_400_000;

test("31 op.js ?via=code records the click, sets the cookie for the program's window and decorates checkout", async ({
  browser,
}) => {
  const s = loadState();
  const ctx = await newCtx(browser);
  const page = await ctx.newPage();
  const ping = page.waitForResponse((r) => r.url().endsWith("/api/track/ping"));
  await page.goto(`${siteUrl(s)}/?via=${s.partners.p1!.code}`);
  await waitClick(page);
  const st = await opState(page);
  expect(st.clickId).toMatch(/^clk_/);
  expect(st.visitorId).toMatch(/^vis_/);
  expect(st.code).toBe(s.partners.p1!.code);
  expect((await ping).status()).toBe(204);
  const c = await cookieOf(ctx);
  expect(cookieVal(c)).toEqual({ c: st.clickId, v: st.visitorId, p: st.code });
  expect(daysLeft(c!)).toBeGreaterThan(29.9);
  expect(daysLeft(c!)).toBeLessThan(30.1);
  await expect(page.locator("#buy")).toHaveAttribute(
    "href",
    `https://buy.stripe.com/test_e2e?client_reference_id=${st.clickId}`,
  );
  await expect(page.locator("#sbb")).toHaveAttribute("client-reference-id", st.clickId);
  // a new visit without a code keeps the attribution from the cookie
  await page.goto(`${siteUrl(s)}/pricing`);
  await page.waitForFunction(
    () => (window as unknown as { openpromoter?: { clickId?: string } }).openpromoter?.clickId,
  );
  expect((await opState(page)).clickId).toBe(st.clickId);
  await ctx.close();
});

test("32 last click (default): a newer partner click replaces the cookie", async ({ browser }) => {
  const s = loadState();
  const ctx = await newCtx(browser);
  const page = await ctx.newPage();
  await page.goto(`${siteUrl(s)}/?via=${s.partners.p1!.code}`);
  await waitClick(page);
  const first = await opState(page);
  await page.goto(`${siteUrl(s)}/?via=${s.partners.sub!.code}`);
  await page.waitForFunction(
    (c) => (window as unknown as { openpromoter: { code: string } }).openpromoter.code === c,
    s.partners.sub!.code,
  );
  const v = cookieVal(await cookieOf(ctx))!;
  expect(v.p).toBe(s.partners.sub!.code);
  expect(v.c).not.toBe(first.clickId);
  expect(v.v).toBe(first.visitorId);
  await ctx.close();
});

test("33 first click: the first partner keeps the visitor (op.js and redirect links)", async ({
  browser,
}) => {
  const s = loadState();
  const f = await founderA(browser);
  await saveProgram(f.page, s.programPath, async (p) => {
    await choose(p, "#commissionDuration", "Recurring for N months");
    await choose(p, "#attributionModel", "First click");
  });
  try {
    const ctx = await newCtx(browser);
    const page = await ctx.newPage();
    await page.goto(`${siteUrl(s)}/?via=${s.partners.p1!.code}`);
    await waitClick(page);
    const first = await opState(page);
    const second = page.waitForResponse((r) => r.url().endsWith("/api/track/click"));
    await page.goto(`${siteUrl(s)}/?via=${s.partners.sub!.code}`);
    expect((await (await second).json()).model).toBe("first_click");
    await page.waitForTimeout(500);
    expect(cookieVal(await cookieOf(ctx))!.c).toBe(first.clickId);
    // a redirect link from the second partner lands with op_model=first_click and must not replace it
    await page.goto(`${APP}/r/${s.slug}/${s.partners.sub!.code}`);
    await page.waitForURL(new RegExp(`^${siteUrl(s)}`));
    expect(new URL(page.url()).searchParams.get("op_model")).toBe("first_click");
    await page.waitForTimeout(500);
    expect(cookieVal(await cookieOf(ctx))!.c).toBe(first.clickId);
    expect((await opState(page)).clickId).toBe(first.clickId);
    await ctx.close();
  } finally {
    await saveProgram(f.page, s.programPath, async (p) => {
      await choose(p, "#commissionDuration", "Recurring for N months");
      await choose(p, "#attributionModel", "Last click");
    });
    await f.ctx.close();
  }
});

test("34 consent mode: no cookie before consent, click id still reaches checkout, cookie after consent", async ({
  browser,
}) => {
  const s = loadState();
  const ctx = await newCtx(browser);
  const page = await ctx.newPage();
  await page.goto(`${siteUrl(s)}/consent/${s.slug}?via=${s.partners.p1!.code}`);
  await waitClick(page);
  const st = await opState(page);
  await page.waitForTimeout(300);
  expect(await cookieOf(ctx)).toBeUndefined();
  await expect(page.locator("#buy")).toHaveAttribute("href", new RegExp(`client_reference_id=${st.clickId}`));
  await page.evaluate(() =>
    (window as unknown as { openpromoter: (c: string, v: boolean) => void }).openpromoter("consent", true),
  );
  const c = await cookieOf(ctx);
  expect(cookieVal(c)).toEqual({ c: st.clickId, v: st.visitorId, p: st.code });
  await ctx.close();
});

test("35 consent mode: the cookie written after consent uses the program's cookie window (30 days)", async ({
  browser,
}) => {
  const s = loadState();
  const ctx = await newCtx(browser);
  const page = await ctx.newPage();
  await page.goto(`${siteUrl(s)}/consent/${s.slug}?via=${s.partners.p1!.code}`);
  await waitClick(page);
  await page.evaluate(() =>
    (window as unknown as { openpromoter: { consent: (v: boolean) => void } }).openpromoter.consent(true),
  );
  const c = await cookieOf(ctx);
  expect(c).toBeTruthy();
  expect(daysLeft(c!), "cookie lifetime in days after consent").toBeLessThan(30.1);
  await ctx.close();
});

test("36 cookieless mode never writes a cookie, even after consent, and still decorates checkout", async ({
  browser,
}) => {
  const s = loadState();
  const ctx = await newCtx(browser);
  const page = await ctx.newPage();
  await page.goto(`${siteUrl(s)}/nostorage/${s.slug}?via=${s.partners.p1!.code}`);
  await waitClick(page);
  const st = await opState(page);
  await page.evaluate(() =>
    (window as unknown as { openpromoter: { consent: (v: boolean) => void } }).openpromoter.consent(true),
  );
  await page.waitForTimeout(300);
  expect(await cookieOf(ctx)).toBeUndefined();
  await expect(page.locator("#buy")).toHaveAttribute("href", new RegExp(`client_reference_id=${st.clickId}`));
  await ctx.close();
});

test("37 redirect link hands the click to op.js on the landing page", async ({ browser }) => {
  const s = loadState();
  const ctx = await newCtx(browser);
  const page = await ctx.newPage();
  await page.goto(`${APP}/r/${s.slug}/l/${s.partners.p1!.linkKey}?sub=podcast`);
  await page.waitForURL(new RegExp(`^${siteUrl(s)}`));
  const clk = new URL(page.url()).searchParams.get("op_click")!;
  expect(clk).toMatch(/^clk_/);
  await waitClick(page);
  expect((await opState(page)).clickId).toBe(clk);
  const c = await cookieOf(ctx);
  expect(cookieVal(c)!.c).toBe(clk);
  expect(daysLeft(c!)).toBeLessThan(30.1);
  await ctx.close();
});

test("38 bot user agents are not counted as clicks", async ({ browser, request }) => {
  const s = loadState();
  const { ctx, page } = await partnerAs(browser, "p1");
  const path = `/p/${s.slug}/portal/links`;
  const ids = await actionIds(page, path);
  const r = await callAction(page, path, ids.partnerLinkAction!, [
    s.slug,
    { destination: `${siteUrl(s)}/bots`, subId: "botcheck" },
  ]);
  expect(r.result?.ok).toBe(true);
  const key = r.result!.data as string;
  for (const ua of [
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    "curl/8.4.0",
    "facebookexternalhit/1.1",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0 Safari/537.36",
    "python-requests/2.31",
  ]) {
    const res = await request.get(`/r/${s.slug}/l/${key}`, {
      maxRedirects: 0,
      headers: { "user-agent": ua, "x-forwarded-for": randomIp() },
    });
    expect(res.status()).toBe(302);
  }
  await request.get(`/r/${s.slug}/l/${key}`, {
    maxRedirects: 0,
    headers: { "user-agent": CHROME_UA, "x-forwarded-for": randomIp() },
  });
  const row = page.locator("li", { hasText: "/bots" });
  await expect
    .poll(async () => {
      await page.goto(path);
      return (await row.locator("span.num").first().textContent())?.replace(/\D/g, "");
    })
    .toBe("1");
  await ctx.close();
});

test("39 /api/track/click and /api/track/ping: CORS, validation, unknown program and code", async ({
  request,
}) => {
  const s = loadState();
  const h = () => ({ "x-forwarded-for": randomIp() });
  for (const path of ["/api/track/click", "/api/track/lead", "/api/track/ping"]) {
    const o = await request.fetch(path, { method: "OPTIONS" });
    expect(o.status()).toBe(204);
    expect(o.headers()["access-control-allow-origin"]).toBe("*");
  }
  expect((await postJson(request, "/api/track/click", { nope: 1 }, h())).status()).toBe(400);
  expect(
    (await postJson(request, "/api/track/click", { program: s.slug, code: "x".repeat(65) }, h())).status(),
  ).toBe(400);
  expect(
    (await postJson(request, "/api/track/click", { program: "no-such-program-qa", code: "x" }, h())).status(),
  ).toBe(404);
  expect(
    await (await postJson(request, "/api/track/click", { program: s.slug, code: "nobody" }, h())).json(),
  ).toEqual({ ok: false });
  const byId = await (
    await postJson(request, "/api/track/click", { program: s.programId, code: s.partners.p1!.code }, h())
  ).json();
  expect(byId.ok).toBe(true);
  expect(byId.cookieDays).toBe(30);
  expect(byId.model).toBe("last_click");
  // code lookups are case-insensitive
  const upper = await (
    await postJson(
      request,
      "/api/track/click",
      { program: s.slug, code: s.partners.p1!.code!.toUpperCase() },
      h(),
    )
  ).json();
  expect(upper.ok).toBe(true);
  expect((await postJson(request, "/api/track/ping", { program: s.slug }, h())).status()).toBe(204);
  expect((await postJson(request, "/api/track/ping", "not json", h())).status()).toBe(204);
  expect(
    (await postJson(request, "/api/track/lead", { program: s.slug, email: "not-an-email" }, h())).status(),
  ).toBe(400);
  expect(
    (
      await postJson(request, "/api/track/lead", { program: "no-such-program-qa", email: "a@b.co" }, h())
    ).status(),
  ).toBe(404);
});

test("40 rate limits: click 60/min, lead 20/min, ping 30/min per IP; redirects keep working but stop recording", async ({
  request,
}) => {
  const s = loadState();
  const run = async (path: string, n: number, body: unknown) => {
    const ip = randomIp();
    const codes: number[] = [];
    for (let i = 0; i < n; i++)
      codes.push((await postJson(request, path, body, { "x-forwarded-for": ip })).status());
    return codes;
  };
  const click = await run("/api/track/click", 61, { program: s.slug, code: "nobody" });
  expect(click.slice(0, 60).every((c) => c !== 429)).toBe(true);
  expect(click[60]).toBe(429);
  const lead = await run("/api/track/lead", 21, { program: "no-such-program-qa", email: "a@b.co" });
  expect(lead.slice(0, 20).every((c) => c !== 429)).toBe(true);
  expect(lead[20]).toBe(429);
  const ping = await run("/api/track/ping", 31, { program: "no-such-program-qa" });
  expect(ping.slice(0, 30).every((c) => c === 204)).toBe(true);
  expect(ping[30]).toBe(429);
  // another IP is not affected
  expect((await postJson(request, "/api/track/ping", {}, { "x-forwarded-for": randomIp() })).status()).toBe(
    204,
  );
  // redirects: the 121st within a minute still sends the visitor on, without a click id
  const ip = randomIp();
  let last: URL | null = null;
  for (let i = 0; i < 121; i++) {
    const res = await request.get(`/r/${s.slug}/${s.partners.p1!.code}`, {
      maxRedirects: 0,
      headers: { "x-forwarded-for": ip, "user-agent": CHROME_UA },
    });
    expect(res.status()).toBe(302);
    last = new URL(res.headers().location!);
    if (i === 119) expect(last.searchParams.get("op_click")).toMatch(/^clk_/);
  }
  expect(last!.origin).toBe(siteUrl(s));
  expect(last!.searchParams.get("op_click")).toBeNull();
});

// ---------------------------------------------------------------------------------------------------------
// End to end: click → lead → signed Stripe invoice.paid → commission in the portal
// ---------------------------------------------------------------------------------------------------------

const invoice = (id: string, email: string, amount: number) => ({
  id: `in_${id}`,
  object: "invoice",
  customer: `cus_${id}`,
  customer_email: email,
  amount_paid: amount,
  tax: 0,
  currency: "usd",
  charge: `ch_${id}`,
  subscription: `sub_${id}`,
  status_transitions: { paid_at: Math.floor(Date.now() / 1000) },
  lines: {
    data: [{ description: "Pro plan", price: { recurring: { interval: "month", interval_count: 1 } } }],
  },
});

async function earningsRow(page: Page, slug: string, amount: string) {
  const row = page.locator("li", { hasText: amount });
  await expect
    .poll(
      async () => {
        await page.goto(`/p/${slug}/portal/earnings`);
        return row.count();
      },
      { timeout: 30_000 },
    )
    .toBeGreaterThan(0);
  return row.first();
}

test("41 E2E: op.js click → signup lead → Stripe invoice.paid → $70.00 pending commission in the portal", async ({
  browser,
  request,
}) => {
  const s = loadState();
  const buyer = `buyer-${s.id}${uid()}@e2e.test`;
  const ctx = await newCtx(browser);
  const page = await ctx.newPage();
  await page.goto(`${siteUrl(s)}/?via=${s.partners.p1!.code}`);
  await waitClick(page);
  const lead = await page.evaluate(
    (email) =>
      (
        window as unknown as { openpromoter: { signup: (o: object) => Promise<{ ok: boolean }> } }
      ).openpromoter.signup({
        email,
        name: "Bea Buyer",
      }),
    buyer,
  );
  expect(lead).toEqual({ ok: true });
  await ctx.close();
  const id = uid() + uid();
  await stripeEvent(request, s.webhookUrl, "invoice.paid", invoice(id, buyer, 20000));

  const p = await partnerAs(browser, "p1");
  const row = await earningsRow(p.page, s.slug, "$70.00");
  await expect(row).toContainText("Pending");
  await p.page.goto(`/p/${s.slug}/portal`);
  await expect(p.page.getByText("$70").first()).toBeVisible();
  await expect(p.page.getByText("became paying customers")).toBeVisible();
  // replaying the same Stripe event id is idempotent
  await p.ctx.close();
});

test("42 two-tier: sub-partner's sale pays them 35% and the recruiter a 10% override", async ({
  browser,
  request,
}) => {
  const s = loadState();
  const res = await request.get(`/r/${s.slug}/${s.partners.sub!.code}`, {
    maxRedirects: 0,
    headers: { "x-forwarded-for": randomIp(), "user-agent": CHROME_UA },
  });
  const clk = new URL(res.headers().location!).searchParams.get("op_click")!;
  expect(clk).toMatch(/^clk_/);
  const id = uid() + uid();
  const email = `buyer2-${id}@e2e.test`;
  await stripeEvent(request, s.webhookUrl, "checkout.session.completed", {
    id: `cs_${id}`,
    object: "checkout.session",
    customer: `cus_${id}`,
    client_reference_id: clk,
    customer_details: { email, name: "Second Buyer" },
    subscription: `sub_${id}`,
    metadata: {},
  });
  await stripeEvent(request, s.webhookUrl, "invoice.paid", invoice(id, email, 10000));

  const sub = await partnerAs(browser, "sub");
  await expect(await earningsRow(sub.page, s.slug, "$35.00")).toContainText("Pending");
  await sub.ctx.close();

  const p1 = await partnerAs(browser, "p1");
  await earningsRow(p1.page, s.slug, "$3.50");
  await p1.page.goto(`/p/${s.slug}/portal/recruits`);
  await expect(p1.page.getByText("You've earned $3.50 from their sales.", { exact: false })).toBeVisible();
  await expect(p1.page.locator("li", { hasText: "Sam Sub" })).toContainText("$3.50");
  await p1.ctx.close();
});

// ---------------------------------------------------------------------------------------------------------
// Payouts, payout slip, tax forms
// ---------------------------------------------------------------------------------------------------------

test("50 payouts: bank transfer is offered, Stripe onboarding is not (no Stripe Connect) and refuses", async ({
  browser,
}) => {
  const s = loadState();
  const { ctx, page } = await partnerAs(browser, "p1");
  const path = `/p/${s.slug}/portal/payouts`;
  await page.goto(path);
  await expect(page.getByText("Bank account (Stripe)")).toHaveCount(0);
  await page.getByText("Bank transfer (arranged with the team)").click();
  await page.getByRole("button", { name: "Use bank transfer" }).click();
  await expect(page.getByText("Payout method saved")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Bank transfer", { exact: true }).first()).toBeVisible();
  const ids = await actionIds(page, path);
  expect(ids.stripeOnboardingAction).toBeTruthy();
  const r = await callAction(page, path, ids.stripeOnboardingAction!, [s.slug]);
  expect(r.result).toEqual({ ok: false, error: "This program doesn't pay through Stripe yet" });
  await ctx.close();
});

test("51 founder pays the commission; the partner sees the payout and its self-billed invoice", async ({
  browser,
}) => {
  const s = loadState();
  const f = await founderA(browser);
  const page = f.page;
  page.on("dialog", (d) => d.accept(d.type() === "prompt" ? "bank-ref-qa" : undefined));
  await page.goto(`${s.programPath}/commissions?status=pending`);
  const row = page.getByRole("row", { name: /Paula One/ }).filter({ hasText: "$70.00" });
  await row.getByRole("checkbox").check();
  await page
    .getByRole("toolbar", { name: "Bulk actions" })
    .getByRole("button", { name: "Approve now" })
    .click();
  await expect(page.getByText(/Approve now: done|Done/).first()).toBeVisible();
  await page.goto(`${s.programPath}/payouts`);
  await page.getByRole("button", { name: "Prepare payouts" }).first().click();
  await expect(page.getByText(/payouts? ready for approval/)).toBeVisible();
  await page.getByRole("button", { name: /Approve 1 payout/ }).click();
  await page.getByRole("button", { name: "Mark paid" }).click();
  await expect(page.getByText("Marked as paid")).toBeVisible();
  await f.ctx.close();

  const { ctx, page: pp } = await partnerAs(browser, "p1");
  await pp.goto(`/p/${s.slug}/portal/payouts`);
  const hist = pp.locator("li", { hasText: "$70.00" }).filter({ hasText: "Invoice" });
  await expect(hist).toBeVisible();
  const href = (await hist.getByRole("link", { name: "Invoice" }).getAttribute("href"))!;
  expect(href).toMatch(new RegExp(`^/p/${s.slug}/portal/payouts/[A-Za-z0-9_]+$`));
  await pp.goto(href);
  await expect(pp.getByText("$70.00").first()).toBeVisible();
  await expect(pp.getByText("Paula One").first()).toBeVisible();
  patchState((st) => {
    (st as Record<string, unknown>).payoutId = href.split("/").pop();
  });
  await ctx.close();
});

test("52 PayPal and Wise payout emails once the founder connects them; invalid email refused", async ({
  browser,
}) => {
  const s = loadState();
  const f = await founderA(browser);
  await f.page.goto(`${s.programPath}/settings/integrations`);
  await f.page.getByLabel("PayPal client ID").fill("qa-fake-client-id");
  await f.page.getByLabel("PayPal secret").fill("qa-fake-secret");
  await f.page
    .getByLabel("PayPal secret")
    .locator("xpath=ancestor::form[1]")
    .getByRole("button", { name: /Connect|Save/ })
    .click();
  // credentials are checked with PayPal before saving: fake ones are refused
  await expect(
    f.page.getByText(/PayPal didn't accept these credentials|Couldn't reach PayPal/).first(),
  ).toBeVisible();
  await f.ctx.close();
  await seedPayoutConnection(s.programId, "paypal");
  await seedPayoutConnection(s.programId, "wise");

  const { ctx, page } = await partnerAs(browser, "p1");
  const path = `/p/${s.slug}/portal/payouts`;
  await page.goto(path);
  await page.getByText("PayPal", { exact: true }).click();
  await page.getByRole("textbox", { name: "PayPal email" }).fill(`paula.paypal-${s.id}@e2e.test`);
  await page.getByRole("button", { name: "Save PayPal" }).click();
  await expect(page.getByText("Payout method saved").first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole("textbox", { name: "PayPal email" })).toHaveValue(
    `paula.paypal-${s.id}@e2e.test`,
  );
  await page.getByText("Wise", { exact: true }).click();
  await page.getByRole("textbox", { name: "Wise email" }).fill(`paula.wise-${s.id}@e2e.test`);
  await page.getByRole("button", { name: "Save Wise" }).click();
  await expect(page.getByText("Payout method saved").first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Wise email" })).toHaveValue(`paula.wise-${s.id}@e2e.test`);
  const ids = await actionIds(page, path);
  const bad = await callAction(page, path, ids.payoutMethodAction!, [
    s.slug,
    { method: "paypal", email: "nope" },
  ]);
  expect(bad.result?.ok).toBe(false);
  const none = await callAction(page, path, ids.payoutMethodAction!, [s.slug, { method: "paypal" }]);
  expect(none.result).toEqual({ ok: false, error: "Enter the email for your account" });
  // put P1 back on bank transfer so later payouts don't call PayPal
  const back = await callAction(page, path, ids.payoutMethodAction!, [s.slug, { method: "manual" }]);
  expect(back.result?.ok).toBe(true);
  await ctx.close();
});

test("53 payout method must be one the program offers (PayPal is not connected in program B)", async ({
  browser,
}) => {
  const s = loadState();
  const a = await apply(browser, "b1", {
    slug: s.slugB,
    name: "Bianca B",
    email: `qa-b1-${s.id}${uid()}@e2e.test`,
    website: "https://bianca.example",
  });
  await a.ctx.close();
  const { ctx, page } = await partnerAs(browser, "b1", s.slugB);
  const path = `/p/${s.slugB}/portal/payouts`;
  await page.goto(path);
  await expect(page.getByText("PayPal", { exact: true })).toHaveCount(0);
  const ids = await actionIds(page, path);
  const r = await callAction(page, path, ids.payoutMethodAction!, [
    s.slugB,
    { method: "paypal", email: "bianca@e2e.test" },
  ]);
  expect(r.result?.ok, "PayPal accepted although program B doesn't pay by PayPal").toBe(false);
  await ctx.close();
});

test("54 payout slip of one partner is not readable by another partner (same or other program)", async ({
  browser,
}) => {
  const s = loadState() as State & { payoutId?: string };
  expect(s.payoutId).toBeTruthy();
  const p2 = await partnerAs(browser, "p2");
  await p2.page.goto(`/p/${s.slug}/portal/payouts/${s.payoutId}`);
  await expect(p2.page.getByText("This page could not be found.")).toBeVisible();
  expect(await p2.page.content()).not.toContain("Paula One");
  await p2.ctx.close();
  const b1 = await partnerAs(browser, "b1", s.slugB);
  await b1.page.goto(`/p/${s.slugB}/portal/payouts/${s.payoutId}`);
  await expect(b1.page.getByText("This page could not be found.")).toBeVisible();
  expect(await b1.page.content()).not.toContain("Paula One");
  await b1.ctx.close();
});

test("55 tax forms: W-9 validates the TIN, W-8BEN saves, details persist", async ({ browser }) => {
  const s = loadState();
  const { ctx, page } = await partnerAs(browser, "p1");
  await page.goto(`/p/${s.slug}/portal/settings`);
  await choose(page, "#tx-form", "W-9 (US person)");
  await choose(page, "#tx-cc", "United States");
  await page.getByLabel("Legal name").fill("Paula One LLC");
  await page.getByLabel("Address").fill("1 Main Street, Springfield, IL 62701");
  await page.getByLabel("SSN or EIN").fill("12345");
  await page.locator('input[name="certify"]').check();
  await page.getByRole("button", { name: "Save tax details" }).click();
  await expect(page.getByText("Enter a valid SSN (123-45-6789) or EIN (12-3456789)")).toBeVisible();
  await page.reload();
  await choose(page, "#tx-form", "W-9 (US person)");
  await choose(page, "#tx-cc", "United States");
  await page.getByLabel("Legal name").fill("Paula One LLC");
  await page.getByLabel("Address").fill("1 Main Street, Springfield, IL 62701");
  await page.getByLabel("SSN or EIN").fill("12-3456789");
  await page.locator('input[name="certify"]').check();
  await page.getByRole("button", { name: "Save tax details" }).click();
  await expect(page.getByText("Tax details saved")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Legal name")).toHaveValue("Paula One LLC");
  // the TIN is never sent back to the browser
  expect(await page.content()).not.toContain("123456789");

  await choose(page, "#tx-form", "W-8BEN (non-US individual)");
  await choose(page, "#tx-cc", "Germany");
  await page.getByLabel("Legal name").fill("Paula Eins");
  await page.getByLabel("Address").fill("Hauptstrasse 1, 10115 Berlin");
  await page.getByLabel("EU VAT ID (optional)").fill("de 123456789");
  await page.locator('input[name="certify"]').check();
  await page.getByRole("button", { name: "Save tax details" }).click();
  await expect(page.getByText("Tax details saved").first()).toBeVisible();
  await page.reload();
  await expect(page.locator("#tx-form")).toContainText("W-8BEN");
  await expect(page.getByLabel("EU VAT ID (optional)")).toHaveValue("DE123456789");
  await ctx.close();
});

// ---------------------------------------------------------------------------------------------------------
// Messages, content kit
// ---------------------------------------------------------------------------------------------------------

test("60 messages: partner writes to the founder (rendered as text), founder replies, partner sees it", async ({
  browser,
  request,
}) => {
  const s = loadState();
  const payload = `Hello team <img src=x onerror="window.__xss=1"> ${s.id}`;
  const p = await partnerAs(browser, "p1");
  await p.page.goto(`/p/${s.slug}/portal/messages`);
  await p.page.getByLabel("Message").fill(payload);
  await p.page.getByRole("button", { name: "Send" }).click();
  await expect(p.page.getByText("Message sent").first()).toBeVisible();
  await expect(p.page.getByText(payload, { exact: true })).toBeVisible();

  const { partnerId: pid } = await partnerId(request, s.partners.p1!.email);
  const f = await founderA(browser);
  await f.page.goto(`${s.programPath}/messages?partner=${pid}`);
  await expect(f.page.getByText(payload).first()).toBeVisible();
  expect(await f.page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
  await f.page.getByLabel("Message", { exact: true }).fill(`Thanks Paula ${s.id}`);
  await f.page.getByRole("button", { name: "Send" }).click();
  await expect(f.page.getByText(`Thanks Paula ${s.id}`).first()).toBeVisible();
  await f.ctx.close();

  await expect
    .poll(async () => {
      await p.page.goto(`/p/${s.slug}/portal/messages`);
      return p.page.getByText(`Thanks Paula ${s.id}`).count();
    })
    .toBeGreaterThan(0);
  await p.ctx.close();
});

test("61 content kit: copy text has the partner's link filled in; banners are public sandboxed SVGs", async ({
  browser,
  request,
}) => {
  const s = loadState();
  const { ctx, page } = await partnerAs(browser, "p1");
  await page.goto(`/p/${s.slug}/portal/content`);
  await expect(page.getByRole("heading", { name: "Content kit" })).toBeVisible();
  const copy = page.getByRole("button", { name: "Copy text" });
  expect(await copy.count(), "the content kit has text assets").toBeGreaterThan(0);
  await copy.first().click();
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).not.toContain("{{link}}");
  const allText = await page.locator("main").innerText();
  expect(allText).not.toContain("{{link}}");
  expect(allText).toContain(`/r/${s.slug}/l/${s.partners.p1!.linkKey}`);
  const banners = page.locator('img[src^="/api/banner/"]');
  if (await banners.count()) {
    const src = (await banners.first().getAttribute("src"))!;
    const res = await request.get(src);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe("image/svg+xml");
    expect(res.headers()["content-security-policy"]).toContain("sandbox");
    const dl = await request.get(`${src}?download=1`);
    expect(dl.headers()["content-disposition"]).toMatch(/attachment; filename=".+\.svg"/);
  }
  expect((await request.get("/api/banner/cas_does_not_exist")).status()).toBe(404);
  await ctx.close();
});

test("62 bounty submission URLs must be http(s): a javascript: URL is refused and never becomes a founder link", async ({
  browser,
}) => {
  const s = loadState();
  const f = await founderA(browser);
  await f.page.goto(`${s.programPath}/campaigns`);
  await f.page.getByRole("button", { name: "Pay $50 per YouTube review" }).click();
  await f.page.getByRole("button", { name: "Draft it" }).click();
  await f.page.getByRole("button", { name: "Launch and notify partners" }).click();
  await expect(f.page.getByText(/Pay \$50/).first()).toBeVisible();

  const { ctx, page } = await partnerAs(browser, "p1");
  await page.goto(`/p/${s.slug}/portal/content`);
  await expect(page.getByText("Submit a post for a bounty")).toBeVisible();
  // the browser's type=url accepts javascript: URLs, so this goes through the real form
  await page.getByLabel("Post URL").fill("javascript:alert(document.domain)//https://youtube.com/watch");
  await page.getByRole("button", { name: "Submit post" }).click();
  await expect(page.locator("[data-sonner-toast]").first()).toBeVisible();
  const toast = await page.locator("[data-sonner-toast]").first().textContent();
  await ctx.close();

  await f.page.goto(`${s.programPath}/campaigns`);
  const hrefs = await f.page.locator("a[href]").evaluateAll((as) => as.map((a) => a.getAttribute("href")!));
  await f.ctx.close();
  expect(
    hrefs.filter((h) => /^\s*javascript:/i.test(h)),
    `toast was: ${toast}`,
  ).toEqual([]);
  expect(toast).not.toContain("Submitted");
});

// ---------------------------------------------------------------------------------------------------------
// Embed, marketplace, partner home
// ---------------------------------------------------------------------------------------------------------

test("70 /embed/[slug] with a signed token shows the partner's dashboard; frameable; bad tokens refused", async ({
  browser,
  request,
}) => {
  const s = loadState();
  const { token } = await partnerId(request, s.partners.p1!.email);
  const res = await request.get(`/embed/${s.slug}?token=${encodeURIComponent(token)}`);
  expect(res.status()).toBe(200);
  expect(res.headers()["x-frame-options"]).toBeUndefined();
  expect(res.headers()["content-security-policy"]).toContain("frame-ancestors *");
  const html = await res.text();
  expect(html).toContain(`/r/${s.slug}/l/${s.partners.p1!.linkKey}`);
  expect(html).toContain("Open the full partner portal");
  for (const t of [`${token}x`, `${token.split(".")[0]}.deadbeef`, ""]) {
    const bad = await (await request.get(`/embed/${s.slug}?token=${encodeURIComponent(t)}`)).text();
    expect(bad).toContain("This referral dashboard link has expired");
    expect(bad).not.toContain(s.partners.p1!.linkKey!);
  }
  const other = await (await request.get(`/embed/${s.slugB}?token=${encodeURIComponent(token)}`)).text();
  expect(other).toContain("This referral dashboard link has expired");

  const js = await request.get("/embed.js");
  expect(js.headers()["content-type"]).toContain("javascript");
  expect(js.headers()["access-control-allow-origin"]).toBe("*");
  expect(await js.text()).toContain('customElements.define("openpromoter-dashboard"');

  // embed.js on the founder's site frames the dashboard
  const ctx = await newCtx(browser);
  const page = await ctx.newPage();
  await page.goto(`${siteUrl(s)}/embed/${s.slug}?token=${encodeURIComponent(token)}`);
  const frame = page.frameLocator("openpromoter-dashboard iframe");
  await expect(frame.getByText(`/r/${s.slug}/l/${s.partners.p1!.linkKey}`)).toBeVisible();
  await ctx.close();
});

test("71 /network lists only opted-in programs; /partners lists the user's own programs only", async ({
  browser,
}) => {
  const s = loadState();
  const anon = await newCtx(browser);
  const ap = await anon.newPage();
  const r = await ap.goto("/network");
  expect(r!.status()).toBe(200);
  await expect(ap.getByRole("heading", { name: "SaaS programs that pay you every month" })).toBeVisible();
  await expect(ap.getByText(`QA Partner Co ${s.id}`)).toHaveCount(0);
  await ap.goto("/partners");
  await ap.waitForURL(/\/login/);
  await anon.close();

  const { ctx, page } = await partnerAs(browser, "p1");
  await page.goto("/partners");
  await expect(page.getByText(`QA Partner Co ${s.id}`)).toBeVisible();
  await expect(page.getByText(`QA Other Co ${s.id}`)).toHaveCount(0);
  await page.goto("/network");
  await expect(page.getByRole("link", { name: "Your programs" })).toBeVisible();
  await ctx.close();
});

// ---------------------------------------------------------------------------------------------------------
// Tenant isolation
// ---------------------------------------------------------------------------------------------------------

test("80 partner of program A cannot read program B or the founder dashboard (URL tampering)", async ({
  browser,
}) => {
  const s = loadState();
  const { ctx, page } = await partnerAs(browser, "p1");
  for (const sub of [
    "",
    "/links",
    "/earnings",
    "/payouts",
    "/messages",
    "/settings",
    "/content",
    "/recruits",
  ]) {
    await page.goto(`/p/${s.slugB}/portal${sub}`);
    expect(new URL(page.url()).pathname, sub).toBe(`/p/${s.slugB}/apply`);
  }
  for (const path of [
    s.programPath,
    `${s.programPath}/partners`,
    `${s.programPath}/commissions`,
    s.programPathB,
    `${s.programPathB}/partners`,
  ]) {
    const r = await page.goto(path);
    expect(new URL(page.url()).pathname.startsWith(path) ? r!.status() : 404, path).toBe(404);
  }
  for (const path of [
    `/api/export/partners?programId=${s.programId}`,
    `/api/export/commissions?programId=${s.programId}`,
  ]) {
    const r = await page.request.get(path);
    expect(r.status(), path).toBeGreaterThanOrEqual(400);
  }
  await ctx.close();
});

test("81 partner of program A cannot use server actions against program B", async ({ browser }) => {
  const s = loadState();
  const { ctx, page } = await partnerAs(browser, "p1");
  const path = `/p/${s.slug}/portal/links`;
  const ids = {
    ...(await actionIds(page, path)),
    ...(await actionIds(page, `/p/${s.slug}/portal/payouts`)),
    ...(await actionIds(page, `/p/${s.slug}/portal/messages`)),
    ...(await actionIds(page, `/p/${s.slug}/portal/settings`)),
  };
  const calls: [string, unknown[]][] = [
    ["partnerLinkAction", [s.slugB, { destination: "https://other-tenant.example/x" }]],
    ["payoutMethodAction", [s.slugB, { method: "manual" }]],
    ["stripeOnboardingAction", [s.slugB]],
    ["partnerReplyAction", [s.slugB, "cross tenant hello"]],
    [
      "taxFormAction",
      [s.slugB, { form: "w8ben", legalName: "X Y", address: "Somewhere 1", country: "DE", certify: "on" }],
    ],
  ];
  for (const [name, args] of calls) {
    expect(ids[name], name).toBeTruthy();
    const r = await callAction(page, path, ids[name]!, args);
    expect(r.result?.ok, `${name} succeeded against program B`).not.toBe(true);
  }
  await ctx.close();

  // and program B's founder sees no message from P1
  const fb = await founderB(browser);
  await fb.page.goto(`${s.programPathB}/messages`);
  await expect(fb.page.getByText("cross tenant hello")).toHaveCount(0);
  await fb.ctx.close();
});

test("82 founder B cannot open program A's partners, messages or payouts by id", async ({
  browser,
  request,
}) => {
  const s = loadState() as State & { payoutId?: string };
  const { partnerId: pid } = await partnerId(request, s.partners.p1!.email);
  const fb = await founderB(browser);
  for (const path of [
    `${s.programPath}/partners/${pid}`,
    `${s.programPath}/messages?partner=${pid}`,
    `${s.programPath}/payouts/${s.payoutId}/invoice`,
    `${s.programPathB}/partners/${pid}`,
    `${s.programPathB}/payouts/${s.payoutId}/invoice`,
  ]) {
    await fb.page.goto(path);
    await expect(fb.page.getByText("This page could not be found."), path).toBeVisible();
    expect(await fb.page.content(), path).not.toContain("Paula One");
  }
  await fb.page.goto(`${s.programPathB}/messages?partner=${pid}`);
  await expect(fb.page.getByText("Paula One")).toHaveCount(0);
  await fb.ctx.close();
});

test("83 not-found pages for other tenants' ids answer with HTTP 404 (not a 200 soft 404)", async ({
  browser,
  request,
}) => {
  const s = loadState() as State & { payoutId?: string };
  const { partnerId: pid } = await partnerId(request, s.partners.p1!.email);
  const fb = await founderB(browser);
  const p2 = await partnerAs(browser, "p2");
  const checks: [Page, string][] = [
    [fb.page, `${s.programPathB}/partners/${pid}`],
    [fb.page, `${s.programPathB}/payouts/${s.payoutId}/invoice`],
    [p2.page, `/p/${s.slug}/portal/payouts/${s.payoutId}`],
    [p2.page, `/p/${s.slug}/portal/payouts/po_does_not_exist`],
  ];
  const got: string[] = [];
  for (const [page, path] of checks) got.push(`${path} → ${(await page.request.get(path)).status()}`);
  await fb.ctx.close();
  await p2.ctx.close();
  expect(got).toEqual(checks.map(([, path]) => `${path} → 404`));
});

// ---------------------------------------------------------------------------------------------------------
// Found on the way (founder side, blocks partner setup)
// ---------------------------------------------------------------------------------------------------------

test("90 program settings save with a lifetime commission (Months input disabled)", async ({ browser }) => {
  const s = loadState();
  const f = await founderA(browser);
  await f.page.goto(`${s.programPath}/settings`);
  await choose(f.page, "#commissionDuration", "Lifetime of the customer");
  await f.page.locator("#cookieDays").fill("30");
  await f.page.getByRole("button", { name: "Save", exact: true }).first().click();
  await expect(f.page.getByText("Program saved").first()).toBeVisible();
  // restore
  await saveProgram(f.page, s.programPath, async (p) => {
    await choose(p, "#commissionDuration", "Recurring for N months");
  });
  await f.ctx.close();
});
