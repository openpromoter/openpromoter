import { type LookupAddress, lookup } from "node:dns";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP } from "node:net";

/** Addresses a server-side fetch of a user-supplied URL must never reach (RFC 6890 special-purpose ranges). */
const blocked = new BlockList();
for (const [net, bits] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  blocked.addSubnet(net, bits, "ipv4");
for (const [net, bits] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const)
  blocked.addSubnet(net, bits, "ipv6");

/** IPv4-mapped IPv6 (::ffff:127.0.0.1, ::ffff:7f00:1) is matched against the IPv4 ranges by BlockList itself. */
export function isPrivateAddress(ip: string): boolean {
  const addr = ip.replace(/^\[|\]$/g, "");
  const v = isIP(addr);
  if (v === 0) return true;
  return blocked.check(addr, v === 4 ? "ipv4" : "ipv6");
}

const devLoopback = (host: string) =>
  process.env.NODE_ENV !== "production" && ["localhost", "127.0.0.1", "[::1]", "::1"].includes(host);

/** Resolves every address and refuses the connection if any is private, so DNS rebinding can't slip through. */
function guardedLookup(
  hostname: string,
  options: { all?: boolean; family?: number },
  cb: (err: Error | null, address: string | LookupAddress[], family?: number) => void,
) {
  lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return cb(err, []);
    const list = addresses as LookupAddress[];
    if (!devLoopback(hostname) && (list.length === 0 || list.some((a) => isPrivateAddress(a.address))))
      return cb(new Error(`${hostname} resolves to a private network address`), []);
    if (options.all) cb(null, list);
    else cb(null, list[0]!.address, list[0]!.family);
  });
}

export class SsrfError extends Error {}

export interface SafeResponse {
  status: number;
  url: string;
  headers: http.IncomingHttpHeaders;
  text: string;
}

/**
 * fetch() replacement for user-supplied URLs: http(s) only, every hop's DNS answer checked at connect time,
 * redirects re-checked hop by hop, body capped at `maxBytes`, whole request bounded by `timeoutMs`.
 */
export async function safeFetch(
  raw: string,
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    timeoutMs?: number;
    maxBytes?: number;
    maxRedirects?: number;
  } = {},
): Promise<SafeResponse> {
  const { maxRedirects = 3, maxBytes = 1_000_000, timeoutMs = 8000 } = init;
  const deadline = Date.now() + timeoutMs;
  let url = new URL(raw);
  let method = init.method ?? "GET";
  let body = init.body;
  for (let hop = 0; ; hop++) {
    if (url.protocol !== "http:" && url.protocol !== "https:")
      throw new SsrfError("Only http(s) URLs are allowed");
    if (url.username || url.password) throw new SsrfError("URLs with credentials are not allowed");
    const host = url.hostname;
    if (isIP(host.replace(/^\[|\]$/g, "")) && isPrivateAddress(host) && !devLoopback(host))
      throw new SsrfError("That address is on a private network");
    const res = await request(
      url,
      method,
      init.headers ?? {},
      body,
      maxBytes,
      Math.max(1, deadline - Date.now()),
    );
    const location = res.headers.location;
    if (res.status >= 300 && res.status < 400 && location && hop < maxRedirects) {
      url = new URL(location, url);
      if (res.status !== 307 && res.status !== 308) {
        method = "GET";
        body = undefined;
      }
      continue;
    }
    return res;
  }
}

function request(
  url: URL,
  method: string,
  headers: Record<string, string>,
  body: string | undefined,
  maxBytes: number,
  timeoutMs: number,
): Promise<SafeResponse> {
  const mod = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = mod.request(
      url,
      {
        method,
        headers: { ...headers, ...(body ? { "Content-Length": String(Buffer.byteLength(body)) } : {}) },
        lookup: guardedLookup as never,
        // no pooled sockets: every request resolves and checks its address
        agent: false,
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > maxBytes) {
            chunks.push(c.subarray(0, Math.max(0, c.length - (size - maxBytes))));
            res.destroy();
            return;
          }
          chunks.push(c);
        });
        const done = () =>
          resolve({
            status: res.statusCode ?? 0,
            url: url.toString(),
            headers: res.headers,
            text: Buffer.concat(chunks).toString("utf8"),
          });
        res.on("end", done);
        res.on("close", done);
        res.on("error", reject);
      },
    );
    const timer = setTimeout(() => req.destroy(new Error("Request timed out")), timeoutMs);
    req.on("close", () => clearTimeout(timer));
    req.on("timeout", () => req.destroy(new Error("Request timed out")));
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}
