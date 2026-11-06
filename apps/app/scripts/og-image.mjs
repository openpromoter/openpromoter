// Share images in the style of the blog feature images: the site's own BlogCover, re-titled and sized.
// node scripts/og-image.mjs <out.png> <width> <height> [tag] [title]   (site dev server on SITE_BASE, default :3001)
import { chromium } from "@playwright/test";

const [out, w = "1200", h = "630", tag = "Open source", title = "Open-source affiliate software for SaaS"] =
  process.argv.slice(2);
const SITE = process.env.SITE_BASE ?? "http://localhost:3001";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: +w + 200, height: +h + 200 }, colorScheme: "light" });
await p.goto(`${SITE}/blog/`, { waitUntil: "networkidle" });
await p.evaluate(
  ({ w, h, tag, title }) => {
    const cover = document.querySelector(".cover-grid").parentElement;
    const [tagEl, titleEl] = cover.querySelectorAll("p");
    tagEl.textContent = tag;
    titleEl.textContent = title;
    Object.assign(cover.style, { width: `${w}px`, height: `${h}px`, aspectRatio: "auto", borderRadius: "0" });
    document.body.replaceChildren(cover);
    document.body.style.margin = "0";
  },
  { w: +w, h: +h, tag, title },
);
await p.waitForTimeout(300);
await p.locator(".cover-grid").locator("xpath=..").screenshot({ path: out });
await b.close();
