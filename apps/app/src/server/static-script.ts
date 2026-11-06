import { createHash } from "node:crypto";

/**
 * Serves a generated script with caching that still lets fixes reach every site:
 * - `/op.js` (what install snippets embed): 1h fresh, then served stale for up to a week while revalidating,
 *   with an ETag so revalidation is a 304.
 * - `/op.js?v=<hash>` (the current version): immutable for a year. Any other `v` gets the short policy.
 */
export function scriptResponse(req: Request, body: string) {
  const etag = `"${createHash("sha256").update(body).digest("base64url").slice(0, 16)}"`;
  const v = new URL(req.url).searchParams.get("v");
  const headers = {
    "Content-Type": "application/javascript; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Cross-Origin-Resource-Policy": "cross-origin",
    "X-Content-Type-Options": "nosniff",
    ETag: etag,
    "Cache-Control":
      v && `"${v}"` === etag
        ? "public, max-age=31536000, immutable"
        : "public, max-age=3600, stale-while-revalidate=604800",
  };
  if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  return new Response(body, { headers });
}
