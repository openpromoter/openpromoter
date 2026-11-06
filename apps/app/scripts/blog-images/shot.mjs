// Blog screenshots of the local app at 2x, cropped to one panel, with optional blue boxes.
// node scripts/blog-images/shot.mjs <spec.json>
// Spec item: { out, path, card?: "Heading text" | css?: "selector", pad?: 24, width?: 1280, scroll?: true,
//              boxes?: ["label:Cookie window" | "text:Exact text" | "css:selector"], dark?: false, as?: "founder"|"partner"|"anon" }
// Writes <out>.webp at quality 90. Signs in with the seeded demo founder (local test data only).
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";

const BASE = process.env.APP_BASE ?? "http://localhost:3000";
// spec `out` paths are relative to the site's public/ (the private site repo next to this one)
const PUBLIC = `${process.env.SITE_DIR ?? resolve(process.cwd(), "../../../openpromoter-site")}/apps/www/public`;
const DEMO = { email: "demo@openpromoter.test", password: "openpromoter-demo" };

const browser = await chromium.launch();
const founder = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
{
  const p = await founder.newPage();
  await p.goto(`${BASE}/login`);
  await p.getByLabel("Email").fill(DEMO.email);
  await p.getByLabel("Password", { exact: true }).fill(DEMO.password);
  await p.getByRole("button", { name: "Sign in" }).click();
  await p.waitForURL(/\/app/);
  await p.close();
}

for (const s of JSON.parse(readFileSync(process.argv[2], "utf8"))) {
  s.out = s.out.startsWith("/") ? s.out : `${PUBLIC}/${s.out}`;
  const ctx =
    s.as === "anon" || s.as === "partner"
      ? await browser.newContext({
          viewport: { width: s.width ?? 1280, height: 900 },
          deviceScaleFactor: 2,
          colorScheme: s.dark ? "dark" : "light",
        })
      : founder;
  const page = await ctx.newPage();
  await page.setViewportSize({ width: s.width ?? 1280, height: s.height ?? 2600 });
  await page.emulateMedia({ colorScheme: s.dark ? "dark" : "light" });
  if (s.apply) {
    // a throwaway partner on the local demo program, for portal screens
    await page.goto(`${BASE}/p/${s.apply}/apply`);
    await page.getByLabel("Full name").fill("Sam Rivera");
    await page.getByLabel("Email").fill(`sam-${Date.now()}@partners.example`);
    await page.getByLabel("Password", { exact: true }).fill("blog-shot-password-1");
    await page.getByLabel("Website or main channel").fill("https://samrivera.example");
    for (const t of await page.locator("textarea").all())
      await t.fill("A weekly newsletter for SaaS founders.");
    await page.getByRole("checkbox").first().check();
    await page.getByRole("button", { name: /^(Join and get my link|Send application)$/ }).click();
    await page.waitForURL(/\/portal/);
  }
  await page.goto(`${BASE}${s.path}`, { waitUntil: "networkidle" });
  if (s.click) await page.getByText(s.click, { exact: true }).first().click();
  // the app's sticky top bar would sit on top of a cropped card
  await page.addStyleTag({ content: ".app-shell header.sticky{display:none!important}" });
  await page.waitForTimeout(400);
  // the panel to crop: a card found by its heading, or any selector
  const target = s.card
    ? page
        .locator(
          `xpath=//*[normalize-space(text())="${s.card}" and not(ancestor::nav) and not(ancestor::aside)]`,
        )
        .first()
        .locator("xpath=ancestor::*[contains(@class,'rounded')][1]")
    : s.css
      ? page.locator(s.css).first()
      : page.locator("main").first();
  await target.scrollIntoViewIfNeeded();
  // boxes: 3px brand outline with 6px clear space, so it never touches the text it marks
  for (const b of s.boxes ?? []) {
    const [kind, ...rest] = b.split(":");
    const v = rest.join(":");
    const el =
      kind === "label"
        ? page.locator(`label:text-is("${v}")`).first().locator("xpath=..")
        : kind === "text"
          ? page.getByText(v, { exact: true }).first()
          : page.locator(v).first();
    const r = await el.boundingBox();
    if (!r) throw new Error(`box not found: ${b}`);
    await page.evaluate(
      ({ r, sx, sy }) => {
        const d = document.createElement("div");
        d.dataset.shotBox = "";
        Object.assign(d.style, {
          position: "fixed",
          left: `${r.x + sx - 8}px`,
          top: `${r.y + sy - 8}px`,
          width: `${r.width + 16}px`,
          height: `${r.height + 16}px`,
          border: "3px solid #2442F5",
          borderRadius: "10px",
          boxShadow: "0 0 0 4px rgb(36 66 245 / 0.15)",
          zIndex: "2147483647",
          pointerEvents: "none",
        });
        document.body.append(d);
      },
      { r, sx: 0, sy: 0 },
    );
  }
  const r = await target.boundingBox();
  const pad = s.pad ?? 24;
  const png = `${s.out}.png`;
  await page.screenshot({
    path: png,
    clip: {
      x: Math.max(0, r.x - pad),
      y: Math.max(0, r.y - pad),
      width: r.width + pad * 2,
      height: Math.min(r.height + pad * 2, s.maxHeight ?? 4000),
    },
  });
  execFileSync("python3", [
    "-c",
    `from PIL import Image; im=Image.open("${png}"); im=im.resize((1800, round(im.height*1800/im.width)), Image.LANCZOS) if im.width>1800 else im; im.save("${s.out}.webp", quality=90, method=6)`,
  ]);
  rmSync(png);
  console.log(`${s.out}.webp`);
  await page.close();
  if (ctx !== founder) await ctx.close();
}
await browser.close();
