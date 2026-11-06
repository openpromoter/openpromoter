// Dev helper: node scripts/cap-page.mjs <url> <out.png> [width=1440] [selector] [scale=1] [dark]
import { chromium } from "@playwright/test";

const [url, out, w = "1440", sel, scale = "1", dark] = process.argv.slice(2);
const b = await chromium.launch();
const p = await b.newPage({
  viewport: { width: +w, height: 900 },
  deviceScaleFactor: +scale,
  colorScheme: dark ? "dark" : "light",
});
await p.goto(url, { waitUntil: "networkidle" });
if (sel && sel !== "-") await p.locator(sel).first().screenshot({ path: out });
else await p.screenshot({ path: out, fullPage: true });
await b.close();
