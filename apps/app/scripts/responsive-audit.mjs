// Responsive audit: loads pages at many widths and reports layout problems a person would notice.
// node scripts/responsive-audit.mjs <site|app> <outDir> [onlyPathSubstring]
// site: every page of the marketing site (SITE_BASE, default http://localhost:3001)
// app: founder dashboard (demo founder), public program pages and a fresh partner's portal (APP_BASE, default :3000)
// Per page and width: sideways scroll, elements past the screen edge, clipped text, small tap targets on phones,
// text under 12px on phones, console errors. Screenshots at 375, 768 and 1280 go to <outDir>/shots.
import { mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "@playwright/test";

const [mode, out, only] = process.argv.slice(2);
const WIDTHS = [320, 360, 375, 390, 414, 768, 834, 1024, 1280, 1440, 1920];
const SHOT_AT = new Set([375, 768, 1280]);
const SITE = process.env.SITE_BASE ?? "http://localhost:3001";
const APP = process.env.APP_BASE ?? "http://localhost:3000";
mkdirSync(join(out, "shots"), { recursive: true });

function sitePaths() {
  const root = resolve(process.cwd(), "../../../openpromoter-site/apps/www/out");
  const walk = (d) =>
    readdirSync(d).flatMap((f) => {
      const p = join(d, f);
      if (statSync(p).isDirectory()) return walk(p);
      return f === "index.html" ? [`${p.slice(root.length).replace(/index\.html$/, "")}`] : [];
    });
  return [...walk(root).sort(), "/missing-page-404/"];
}

/** Everything a phone user would trip over, measured in the page. */
const MEASURE = (vw) => {
  const vis = (e) => {
    const s = getComputedStyle(e);
    const r = e.getBoundingClientRect();
    return (
      s.visibility !== "hidden" && s.display !== "none" && r.width > 0 && r.height > 0 && s.opacity !== "0"
    );
  };
  const name = (e) =>
    `${e.tagName.toLowerCase()}${e.id ? `#${e.id}` : ""}${typeof e.className === "string" && e.className ? `.${e.className.trim().split(/\s+/).slice(0, 3).join(".")}` : ""} "${(e.innerText || e.getAttribute("aria-label") || e.getAttribute("alt") || "").trim().slice(0, 40)}"`;
  // inside a scroll box, a clip or a dialog that is closed: not a page-level overflow
  const contained = (e) => {
    for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (/(auto|scroll|hidden|clip)/.test(s.overflowX)) return true;
    }
    return false;
  };
  const doc = document.documentElement;
  const sideways = doc.scrollWidth - doc.clientWidth;
  const past = [];
  for (const e of document.body.querySelectorAll("*")) {
    if (!vis(e) || contained(e)) continue;
    const r = e.getBoundingClientRect();
    if (r.right > vw + 1 || r.left < -1)
      past.push(`${name(e)} [${Math.round(r.left)}..${Math.round(r.right)}]`);
    if (past.length > 6) break;
  }
  const clipped = [...document.querySelectorAll(".truncate, .line-clamp-1, .line-clamp-2, .text-ellipsis")]
    .filter((e) => vis(e) && (e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1))
    .map(name)
    .slice(0, 8);
  const small = [];
  const tiny = [];
  if (vw <= 480) {
    for (const e of document.querySelectorAll(
      "a, button, input, select, textarea, [role=button], [role=tab], summary",
    )) {
      if (!vis(e)) continue;
      // inline links inside running text are exempt, as WCAG 2.5.8 allows
      if (
        e.tagName === "A" &&
        e.closest("p, li, td, figcaption, dd") &&
        getComputedStyle(e).display === "inline"
      )
        continue;
      const r = e.getBoundingClientRect();
      if (
        (r.height < 24 || r.width < 24) &&
        !e.classList.contains("sr-only") &&
        r.width > 2 &&
        !String(e.className).includes("after:-inset")
      )
        small.push(`${name(e)} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      if (!n.textContent.trim() || !n.parentElement || !vis(n.parentElement)) continue;
      const fs = parseFloat(getComputedStyle(n.parentElement).fontSize);
      if (fs < 11.5) tiny.push(`${Math.round(fs * 10) / 10}px "${n.textContent.trim().slice(0, 30)}"`);
    }
  }
  return {
    sideways,
    past,
    clipped,
    small: small.slice(0, 10),
    smallCount: small.length,
    tiny: [...new Set(tiny)].slice(0, 8),
    tinyCount: tiny.length,
  };
};

const browser = await chromium.launch();
const results = [];

async function audit(ctx, label, url, prep) {
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 140)));
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 140)));
  for (const w of WIDTHS) {
    await page.setViewportSize({ width: w, height: w < 768 ? 812 : 900 });
    try {
      await page.goto(url, { waitUntil: "load", timeout: 45_000 });
      await page.waitForTimeout(mode === "site" ? 250 : 700);
      if (prep) await prep(page);
    } catch (e) {
      results.push({ label, w, fail: String(e).slice(0, 120) });
      continue;
    }
    const m = await page.evaluate(MEASURE, w);
    results.push({ label, w, ...m });
    if (SHOT_AT.has(w)) {
      const f = `${label.replace(/[^\w]+/g, "_").replace(/^_|_$/g, "") || "home"}-${w}.png`;
      await page.screenshot({ path: join(out, "shots", f), fullPage: true }).catch(() => {});
    }
  }
  if (errors.length) results.push({ label, w: 0, consoleErrors: [...new Set(errors)].slice(0, 5) });
  await page.close();
}

if (mode === "site") {
  const ctx = await browser.newContext();
  for (const p of sitePaths()) if (!only || p.includes(only)) await audit(ctx, p, `${SITE}${p}`);
} else {
  const P = "/app/prg_1Qqz8HTpJ413SyAK";
  const founder = await browser.newContext();
  {
    const p = await founder.newPage();
    await p.goto(`${APP}/login`);
    await p.getByLabel("Email").fill("demo@openpromoter.test");
    await p.getByLabel("Password", { exact: true }).fill("openpromoter-demo");
    await p.getByRole("button", { name: "Sign in" }).click();
    await p.waitForURL(/\/app/);
    await p.close();
  }
  const founderPages = [
    "",
    "/partners",
    "/partners/prt_8HjCmiTymXeMMHcR",
    "/customers",
    "/commissions",
    "/commissions?view=board",
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
    "/settings/account",
    "/settings/application",
    "/settings/audit",
    "/settings/billing",
    "/settings/branding",
    "/settings/developers",
    "/settings/import",
    "/settings/install",
    "/settings/integrations",
    "/settings/programs",
    "/settings/team",
  ];
  for (const f of founderPages)
    if (!only || `app${f}`.includes(only)) await audit(founder, `app${f || "/dashboard"}`, `${APP}${P}${f}`);
  if (!only || "onboarding".includes(only)) await audit(founder, "onboarding", `${APP}/onboarding`);
  const anon = await browser.newContext();
  for (const f of [
    "/login",
    "/signup",
    "/forgot",
    "/p/acme-analytics",
    "/p/acme-analytics/apply",
    "/partners",
    "/network",
  ])
    if (!only || f.includes(only)) await audit(anon, `public${f}`, `${APP}${f}`);
  // a fresh partner on the demo program, for the portal
  if (!only || "portal".includes(only)) {
    const partner = await browser.newContext();
    const p = await partner.newPage();
    await p.goto(`${APP}/p/acme-analytics/apply`);
    await p.getByLabel("Full name").fill("Rae Audit");
    await p.getByLabel("Email").fill(`rae-${Date.now()}@partners.example`);
    await p.getByLabel("Password", { exact: true }).fill("audit-password-123");
    for (const t of await p.locator("textarea").all()) await t.fill("A newsletter for SaaS founders.");
    await p.getByRole("checkbox").first().check();
    await p.getByRole("button", { name: /^(Join and get my link|Send application)$/ }).click();
    await p.waitForURL(/\/portal/);
    await p.close();
    for (const f of [
      "",
      "/links",
      "/earnings",
      "/payouts",
      "/content",
      "/messages",
      "/recruits",
      "/settings",
    ])
      await audit(partner, `portal${f || "/home"}`, `${APP}/p/acme-analytics/portal${f}`);
  }
}
await browser.close();
writeFileSync(join(out, `${mode}.json`), JSON.stringify(results, null, 1));

// summary: one line per problem kind, the widths where it happens
const issues = results.filter(
  (r) =>
    r.fail ||
    r.sideways > 0 ||
    r.past?.length ||
    r.clipped?.length ||
    r.smallCount ||
    r.tinyCount ||
    r.consoleErrors,
);
const byPage = {};
for (const r of issues) {
  byPage[r.label] = byPage[r.label] ?? [];
  byPage[r.label].push(r);
}
for (const [label, rs] of Object.entries(byPage)) {
  console.log(`\n== ${label}`);
  for (const r of rs) {
    if (r.fail) console.log(`  ${r.w}: LOAD FAIL ${r.fail}`);
    if (r.consoleErrors) console.log(`  console: ${r.consoleErrors.join(" | ")}`);
    if (r.sideways > 0)
      console.log(`  ${r.w}: sideways scroll ${r.sideways}px; past edge: ${r.past.join(" ; ")}`);
    else if (r.past?.length) console.log(`  ${r.w}: past edge: ${r.past.join(" ; ")}`);
    if (r.clipped?.length) console.log(`  ${r.w}: clipped: ${r.clipped.join(" ; ")}`);
    if (r.smallCount)
      console.log(`  ${r.w}: ${r.smallCount} small targets: ${r.small.slice(0, 4).join(" ; ")}`);
    if (r.tinyCount) console.log(`  ${r.w}: ${r.tinyCount} tiny text: ${r.tiny.slice(0, 4).join(" ; ")}`);
  }
}
console.log(`\n${results.length} checks, ${Object.keys(byPage).length} pages with findings`);
