// Blog infographics in the OpenPromoter "ledger" style, rendered at 1800 px wide: white page, brand row on top,
// content in white tiles with hairline borders on a cool grey panel, square badges, Inter 500, ledger blue.
// node scripts/blog-images/infographic.mjs <spec.json> [more.json...]
// Spec: { out, eyebrow, title (wrap the keyword in *stars*), kind: steps|rows|cards|flow, items, head?, source? }
// Writes <out>.webp (quality 90) next to the path given in `out`.
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";

// the private site repo sits next to this one; SITE_DIR overrides it. Spec `out` paths are relative to its public/.
const SITE_DIR = process.env.SITE_DIR ?? resolve(process.cwd(), "../../../openpromoter-site");
const PUBLIC = `${SITE_DIR}/apps/www/public`;
const SITE = `${SITE_DIR}/node_modules/.pnpm`;
const INTER = `${SITE}/@fontsource-variable+inter@5.3.0/node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2`;
const MONO = `${SITE}/@fontsource+ibm-plex-mono@5.3.0/node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2`;
const BLUE = "#2442F5";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const kw = (s) => esc(s).replace(/\*(.+?)\*/g, `<span class="kw">$1</span>`);
const LOGO = `<svg viewBox="6 0 52 52" width="44" height="44"><path d="M32 16C32 12 33 9.5 35 7.6" fill="none" stroke="#16171A" stroke-width="3.2" stroke-linecap="round"/><circle cx="36" cy="6.6" r="5.4" fill="${BLUE}"/><rect x="12" y="15" width="40" height="37" rx="17" fill="#16171A"/><rect x="23" y="27.5" width="6" height="10" rx="3" fill="#fff"/><rect x="35" y="27.5" width="6" height="10" rx="3" fill="#fff"/></svg>`;

const CSS = `
@font-face{font-family:Inter;src:url("file://${INTER}") format("woff2");font-weight:100 900}
@font-face{font-family:Mono;src:url("file://${MONO}") format("woff2");font-weight:500}
*{box-sizing:border-box;margin:0}
body{background:#fff;font-family:Inter;color:#16171A;-webkit-font-smoothing:antialiased}
#c{width:1800px;padding:88px 96px 80px;background:#fff}
.top{display:flex;align-items:center;justify-content:space-between}
.brand{display:flex;align-items:center;gap:14px;font-size:34px;font-weight:500;letter-spacing:-.02em}
.eb{font-family:Mono;font-size:26px;line-height:34px;color:${BLUE};background:#EEF1FF;padding:8px 16px;border-radius:8px;text-transform:uppercase;letter-spacing:.06em}
h1{margin-top:56px;font-size:72px;line-height:84px;font-weight:500;letter-spacing:-.035em;max-width:1560px;text-wrap:balance}
.kw{color:${BLUE}}
.lead{margin-top:20px;font-size:34px;line-height:48px;color:#5F6066;max-width:1400px}
.panel{margin-top:56px;background:#F4F6FA;border-radius:32px;padding:20px}
.grid{display:grid;gap:20px}
.card{background:#fff;border:2px solid #E5E8EE;border-radius:20px;padding:44px}
.n{display:inline-grid;place-items:center;width:64px;height:64px;border-radius:12px;background:${BLUE};color:#fff;font-family:Mono;font-size:28px}
.t{font-size:40px;line-height:50px;font-weight:500;letter-spacing:-.02em}
.d{font-size:32px;line-height:46px;color:#5F6066}
.steps{grid-template-columns:repeat(3,1fr)}
.steps .card{display:grid;grid-template-rows:subgrid;grid-row:span 3;gap:20px}
.rows .card{padding:8px 44px}
.row{display:grid;grid-template-columns:var(--cols);gap:40px;align-items:baseline;padding:30px 0;border-top:2px dashed #DDE1E8;font-size:34px;line-height:46px}
.row:first-child{border-top:0}
.row.h{font-family:Mono;font-size:24px;letter-spacing:.06em;text-transform:uppercase;color:#5F6066;padding:28px 0 18px}
.row b{font-weight:500}
.row .hi{color:${BLUE};font-weight:500}
.row .m{color:#5F6066}
.cards{grid-template-columns:repeat(var(--n),1fr)}
.cards .card{display:grid;grid-template-rows:subgrid;grid-row:span 4;gap:18px}
.cards .card.hi{background:${BLUE};border-color:${BLUE};color:#fff}
.cards .card.hi .ln{color:rgba(255,255,255,.78)}
.v{font-size:88px;line-height:96px;font-weight:500;letter-spacing:-.04em;font-feature-settings:"tnum"}
.ln{font-size:32px;line-height:46px;color:#5F6066}
.ln div+div{margin-top:6px}
.flow{grid-template-columns:repeat(var(--n),1fr);gap:56px}
.flow .st{position:relative}
.flow .st:not(:last-child)::after{content:"";position:absolute;right:-50px;top:50%;width:44px;height:2px;background:#C5CBD6}
.flow .st:not(:last-child)::before{content:"";position:absolute;right:-50px;top:calc(50% - 7px);width:12px;height:12px;border-top:2px solid #C5CBD6;border-right:2px solid #C5CBD6;transform:rotate(45deg)}
.flow .card{height:100%;display:flex;flex-direction:column;gap:16px;padding:40px 36px}.flow .t{font-size:38px;line-height:48px}
.tag{display:inline-block;font-size:26px;line-height:34px;padding:4px 14px;border-radius:8px;font-weight:500;width:fit-content}
.tag.g{background:#E3F6E8;color:#1F7A3A}.tag.b{background:#EEF1FF;color:${BLUE}}.tag.a{background:#FFF1DB;color:#9A5B00}.tag.r{background:#FDE7E7;color:#B42318}
.hi .tag{background:rgba(255,255,255,.18);color:#fff}
.notes{margin-top:20px;display:grid;grid-template-columns:repeat(var(--nn),1fr);gap:20px}
.foot{margin-top:40px;font-size:28px;line-height:40px;color:#5F6066}
.foot:empty{display:none}
`;

function body(s) {
  const it = s.items;
  if (s.kind === "steps")
    return `<div class="grid steps">${it
      .map(
        (x, i) =>
          `<div class="card"><div class="n">${String(i + 1).padStart(2, "0")}</div><div class="t">${kw(x.t)}</div><div class="d">${esc(x.d)}</div></div>`,
      )
      .join("")}</div>`;
  if (s.kind === "rows") {
    const cols = s.cols ?? "1fr 1fr";
    const head = s.head
      ? `<div class="row h">${s.head.map((h) => `<div>${esc(h)}</div>`).join("")}</div>`
      : "";
    return `<div class="grid rows" style="--cols:${cols}"><div class="card">${head}${it
      .map(
        (r) =>
          `<div class="row">${r.map((c, j) => `<div class="${j === 0 ? "" : c.startsWith?.("!") ? "hi" : j === r.length - 1 && s.mutedLast ? "m" : ""}">${j === 0 ? `<b>${kw(c)}</b>` : kw(String(c).replace(/^!/, ""))}</div>`).join("")}</div>`,
      )
      .join("")}</div></div>`;
  }
  if (s.kind === "cards")
    return `<div class="grid cards" style="--n:${it.length}">${it
      .map(
        (x) =>
          `<div class="card${x.hi ? " hi" : ""}"><div class="t">${kw(x.t)}</div><div class="v">${esc(x.v)}</div><div class="ln">${(x.lines ?? []).map((l) => `<div>${kw(l)}</div>`).join("")}</div><div>${x.tag ? `<span class="tag ${x.tone ?? "b"}">${esc(x.tag)}</span>` : ""}</div></div>`,
      )
      .join("")}</div>`;
  if (s.kind === "flow") {
    const notes = s.notes
      ? `<div class="notes" style="--nn:${s.notes.length}">${s.notes.map((n) => `<div class="card"><div class="t">${kw(n.t)}</div><div class="d" style="margin-top:12px">${esc(n.d)}</div></div>`).join("")}</div>`
      : "";
    return `<div class="grid flow" style="--n:${it.length}">${it
      .map(
        (x) =>
          `<div class="st"><div class="card">${x.tag ? `<span class="tag ${x.tone ?? "b"}">${esc(x.tag)}</span>` : ""}<div class="t">${kw(x.t)}</div><div class="d">${esc(x.d)}</div></div></div>`,
      )
      .join("")}</div>${notes}`;
  }
  throw new Error(`unknown kind ${s.kind}`);
}

const html = (s) =>
  `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body><div id="c">` +
  `<div class="top"><span class="brand">${LOGO}OpenPromoter</span><span class="eb">${esc(s.eyebrow)}</span></div>` +
  `<h1>${kw(s.title)}</h1>${s.lead ? `<p class="lead">${esc(s.lead)}</p>` : ""}` +
  `<div class="panel">${body(s)}</div>` +
  `<div class="foot">${s.source ? esc(s.source) : ""}</div></div></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1800, height: 1000 } });
for (const f of process.argv.slice(2)) {
  for (const s of [].concat(JSON.parse(readFileSync(f, "utf8")))) {
    s.out = s.out.startsWith("/") ? s.out : `${PUBLIC}/${s.out}`;
    // a file:// page may load the local font files; about:blank may not
    const tmp = `${s.out}.html`;
    writeFileSync(tmp, html(s));
    await page.goto(`file://${tmp}`, { waitUntil: "load" });
    rmSync(tmp);
    await page.evaluate(() => document.fonts.ready);
    const png = `${s.out}.png`;
    await page.locator("#c").screenshot({ path: png });
    execFileSync("python3", [
      "-c",
      `from PIL import Image; Image.open("${png}").save("${s.out}.webp", quality=90, method=6)`,
    ]);
    rmSync(png);
    console.log(`${s.out}.webp`);
  }
}
await browser.close();
