// Social images from the website's own hero (grid, lit blue cells, brand band) so they match the site.
// node scripts/og-image.mjs <out.png> <width> <height>   (site dev server on SITE_BASE, default :3001)
import { chromium } from "@playwright/test";
const [out, w = "1200", h = "630"] = process.argv.slice(2);
const SITE = process.env.SITE_BASE ?? "http://localhost:3001";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: +w, height: +h }, colorScheme: "light" });
await p.goto(`${SITE}/privacy/`, { waitUntil: "networkidle" });
await p.evaluate(() => {
  const logo = document.querySelector("header a[href='/'] svg")?.outerHTML ?? "";
  document.querySelector("header")?.remove();
  for (const el of document.querySelectorAll("[data-pagehead] ~ *, main > section:not([data-pagehead])")) el.remove();
  const hero = document.querySelector("[data-pagehead]");
  document.body.replaceChildren(hero);
  document.body.style.background = "var(--bg)";
  const eb = hero.querySelector(".eyebrow");
  eb.innerHTML = '<span class="font-mono" style="font-size:17px">[ open source · 0% of payouts ]</span>';
  const h1 = hero.querySelector("h1");
  h1.innerHTML = 'Open-source affiliate software <span class="text-accent">for SaaS</span>';
  h1.style.cssText = "font-size:76px;line-height:80px;max-width:980px";
  const lead = h1.nextElementSibling;
  lead.textContent = "Stripe tracking, partner payouts and fraud checks. Self-host free.";
  lead.style.cssText = "font-size:24px;line-height:34px;max-width:800px;margin-top:26px";
  const card = hero.querySelector(".hero-card");
  card.style.height = `${innerHeight - 36}px`;
  hero.style.paddingBottom = "0";
  card.querySelector(".container-x").style.cssText = `padding-top:${Math.round(innerHeight * 0.29)}px;padding-bottom:0`;
  const brand = document.createElement("div");
  brand.className = "absolute flex items-center gap-2.5 text-fg";
  brand.style.cssText = "top:48px;left:50%;transform:translateX(-50%);font-size:28px;font-weight:500;letter-spacing:-0.02em";
  brand.innerHTML = logo.replace("<svg", '<svg style="width:40px;height:40px"') + "OpenPromoter";
  card.append(brand);
});
await p.waitForTimeout(300);
await p.screenshot({ path: out });
await b.close();
