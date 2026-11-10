import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { isPrivateAddress, safeFetch } from "../safe-fetch";

export interface SiteFacts {
  url: string;
  name: string;
  title: string | null;
  description: string | null;
  headline: string | null;
  logoUrl: string | null;
  color: string;
  text: string;
}

/**
 * Blocks URLs that resolve to private networks (SSRF) when they are saved. Self-hosters can use localhost in dev.
 * Fetches themselves go through safeFetch, which re-checks at connect time (DNS rebinding) and on redirects.
 */
export async function assertPublicUrl(raw: string): Promise<URL> {
  const u = new URL(raw);
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("Only http(s) URLs are allowed");
  if (process.env.NODE_ENV !== "production" && (u.hostname === "localhost" || u.hostname === "127.0.0.1"))
    return u;
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const ips = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
  if (ips.length === 0 || ips.some(isPrivateAddress)) throw new Error("That address is on a private network");
  return u;
}

const meta = (html: string, key: string) => {
  const re = new RegExp(`<meta[^>]+(?:name|property)=["']${key}["'][^>]*>`, "i");
  const tag = html.match(re)?.[0];
  return tag?.match(/content=["']([^"']*)["']/i)?.[1]?.trim() || null;
};

const decode = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");

function luminance(hex: string) {
  const n = Number.parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function saturation(hex: string) {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

/** Most frequent saturated colour in the page, preferring theme-color. */
export function pickBrandColor(html: string, fallback = "#0B7A60"): string {
  const theme = meta(html, "theme-color");
  if (theme && /^#[0-9a-f]{6}$/i.test(theme) && saturation(theme) > 0.25) return theme.toUpperCase();
  const counts = new Map<string, number>();
  for (const m of html.matchAll(/#([0-9a-f]{6})\b/gi)) {
    const hex = `#${m[1]!.toUpperCase()}`;
    const l = luminance(hex);
    if (saturation(hex) < 0.35 || l > 0.85 || l < 0.02) continue;
    counts.set(hex, (counts.get(hex) ?? 0) + 1);
  }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return best?.[0] ?? fallback;
}

export function parseSite(url: string, html: string): SiteFacts {
  const title = decode(html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() ?? "") || null;
  const ogTitle = meta(html, "og:site_name") ?? meta(html, "application-name");
  const description = meta(html, "description") ?? meta(html, "og:description");
  const h1 =
    html
      .match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]
      ?.replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim() ?? null;
  const logo = pickLogo(html, meta(html, "og:logo"));
  const abs = (p: string | null) => {
    if (!p) return null;
    try {
      return new URL(p, url).toString();
    } catch {
      return null;
    }
  };
  const host = new URL(url).hostname.replace(/^www\./, "");
  const name = decode(ogTitle ?? title?.split(/[|\-–—:]/)[0]?.trim() ?? host.split(".")[0] ?? host);
  const text = html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 4000);
  return {
    url,
    name: name.slice(0, 60),
    title,
    description: description ? decode(description) : null,
    headline: h1 ? decode(h1).slice(0, 140) : null,
    logoUrl: abs(logo),
    color: pickBrandColor(html),
    text: decode(text),
  };
}

export async function fetchSite(rawUrl: string): Promise<SiteFacts> {
  const url = rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`;
  const host = new URL(url).hostname.replace(/^www\./, "");
  const fallback: SiteFacts = {
    url,
    name: host.split(".")[0] ?? host,
    title: null,
    description: null,
    headline: null,
    logoUrl: null,
    color: "#0B7A60",
    text: "",
  };
  try {
    // private or unreachable sites still get a program, just without pulled-in branding
    await assertPublicUrl(url);
    // redirects are followed by safeFetch one hop at a time, each re-checked against private networks
    const res = await safeFetch(url, {
      headers: { "User-Agent": "OpenPromoterBot/1.0 (+https://openpromoter.com)", Accept: "text/html" },
      timeoutMs: 8000,
      maxBytes: 500_000,
    });
    return parseSite(res.url || url, res.text);
  } catch {
    return fallback;
  }
}

/** Contrast-safe text colour on top of a brand colour (DESIGN.md partner portal rule). */
export function onColor(hex: string) {
  return luminance(hex) > 0.36 ? "#0B0D0D" : "#FFFFFF";
}

/** Darken a colour until it reaches 4.5:1 on white, for links/text on light surfaces. */
export function readableOnWhite(hex: string): string {
  let n = Number.parseInt(hex.slice(1), 16);
  for (let i = 0; i < 20; i++) {
    const h = `#${n.toString(16).padStart(6, "0")}`;
    if (1.05 / (luminance(h) + 0.05) >= 4.5) return h.toUpperCase();
    const r = Math.floor(((n >> 16) & 255) * 0.9);
    const g = Math.floor(((n >> 8) & 255) * 0.9);
    const b = Math.floor((n & 255) * 0.9);
    n = (r << 16) | (g << 8) | b;
  }
  return "#15191A";
}

/** Email clients can't show SVG (Gmail, Outlook) or .ico, so only PNG, JPG, GIF and WebP qualify. */
export const emailSafeImage = (href: string) => !/^data:/i.test(href) && !/\.(svg|ico)(\?|#|$)/i.test(href);

/**
 * The logo for the program's emails and portal: the site's large app icon first (apple-touch-icon, 180px), then
 * og:logo, then the biggest other icon. Never the social banner (og:image), which is a wide picture, not a logo.
 */
export function pickLogo(html: string, ogLogo: string | null): string | null {
  const attr = (tag: string, name: string) =>
    new RegExp(`\\b${name}=["']([^"']+)["']`, "i").exec(tag)?.[1] ?? null;
  const icons = [...html.matchAll(/<link\b[^>]*>/gi)]
    .map(([t]) => ({
      rel: (attr(t, "rel") ?? "").toLowerCase(),
      href: attr(t, "href"),
      sizes: attr(t, "sizes"),
    }))
    .filter(
      (l): l is { rel: string; href: string; sizes: string | null } => !!l.href && l.rel.includes("icon"),
    )
    .filter((l) => emailSafeImage(l.href));
  const size = (l: { sizes: string | null }) => Number(/(\d+)x\d+/i.exec(l.sizes ?? "")?.[1] ?? 0);
  const apple = icons.filter((l) => l.rel.includes("apple-touch-icon")).sort((a, b) => size(b) - size(a))[0];
  if (apple) return apple.href;
  if (ogLogo && emailSafeImage(ogLogo)) return ogLogo;
  return icons.sort((a, b) => size(b) - size(a))[0]?.href ?? null;
}
