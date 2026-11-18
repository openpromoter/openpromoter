import { BlockList, isIP } from "node:net";

/** Cloudflare's published edge ranges (https://www.cloudflare.com/ips/). */
export const CLOUDFLARE_RANGES = [
  "173.245.48.0/20",
  "103.21.244.0/22",
  "103.22.200.0/22",
  "103.31.4.0/22",
  "141.101.64.0/18",
  "108.162.192.0/18",
  "190.93.240.0/20",
  "188.114.96.0/20",
  "197.234.240.0/22",
  "198.41.128.0/17",
  "162.158.0.0/15",
  "104.16.0.0/13",
  "104.24.0.0/14",
  "172.64.0.0/13",
  "131.0.72.0/22",
  "2400:cb00::/32",
  "2606:4700::/32",
  "2803:f800::/32",
  "2405:b500::/32",
  "2405:8100::/32",
  "2a06:98c0::/29",
  "2c0f:f248::/32",
];

let cached: { key: string; list: BlockList } | null = null;

function proxyRanges(trusted: string): BlockList {
  const raw = process.env.TRUSTED_PROXY_CIDRS?.trim();
  const key = `${trusted}|${raw ?? ""}`;
  if (cached?.key === key) return cached.list;
  const list = new BlockList();
  const cidrs = raw
    ? raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : trusted === "cf-connecting-ip"
      ? CLOUDFLARE_RANGES
      : [];
  for (const c of cidrs) {
    // a typo must never trust everyone (/0, "10.0.0.0/") or throw on every request (/33): skip the entry
    const [addr, bits, extra] = c.split("/");
    const v = isIP(addr ?? "");
    if (!v || extra !== undefined) continue;
    const type = v === 6 ? "ipv6" : "ipv4";
    if (bits === undefined) {
      list.addAddress(addr!, type);
      continue;
    }
    const prefix = /^\d{1,3}$/.test(bits) ? Number(bits) : Number.NaN;
    if (!(prefix >= 1 && prefix <= (v === 6 ? 128 : 32))) continue;
    try {
      list.addSubnet(addr!, prefix, type);
    } catch {
      // unreachable after the checks above; never let a bad entry take requests down
    }
  }
  cached = { key, list };
  return list;
}

const first = (v: string | null | undefined) => v?.split(",")[0]?.trim() || null;

function inRanges(ip: string, list: BlockList): boolean {
  const addr = ip.replace(/^::ffff:/i, "");
  const v = isIP(addr);
  return v !== 0 && list.check(addr, v === 6 ? "ipv6" : "ipv4");
}

/**
 * Client IP for rate limits and fraud signals.
 *
 * - PEER_IP_HEADER names a header the platform's edge overwrites with the connecting address (Railway sets
 *   x-real-ip). With it, TRUSTED_IP_HEADER is only believed when that peer is a trusted proxy: Cloudflare's
 *   ranges for cf-connecting-ip, or TRUSTED_PROXY_CIDRS. A client reaching the origin directly gets its own
 *   address, whatever it puts in cf-connecting-ip.
 * - With only TRUSTED_IP_HEADER, that header is read as-is (the app must not be reachable around the proxy).
 * - Otherwise the right-most X-Forwarded-For entry, the one written by the proxy in front of the app.
 */
export function clientIp(req: Request | { headers: Headers }): string | null {
  const h = req.headers;
  const trusted = process.env.TRUSTED_IP_HEADER?.trim().toLowerCase();
  const peerHeader = process.env.PEER_IP_HEADER?.trim().toLowerCase();
  if (peerHeader) {
    const peer = first(h.get(peerHeader));
    if (trusted && peer) {
      const claimed = first(h.get(trusted));
      if (claimed && isIP(claimed) && inRanges(peer, proxyRanges(trusted))) return claimed;
    }
    return peer;
  }
  if (trusted) return first(h.get(trusted));
  const xff = h
    .get("x-forwarded-for")
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return xff?.at(-1) ?? h.get("x-real-ip") ?? null;
}

/** Request header the proxy sets to the resolved client IP, for Better Auth's rate limiter. */
export const CLIENT_IP_HEADER = "x-op-client-ip";
