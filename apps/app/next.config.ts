import type { NextConfig } from "next";

/**
 * Security headers. They live here rather than in src/: importing app source from next.config sends the
 * Turbopack dev server into an "HMR hash mismatch" reload loop. Dashboard pages get a CSP and same-origin
 * framing; /embed/* stays frameable by any site (customers embed the partner dashboard in their apps).
 */
type Header = { key: string; value: string };

export function contentSecurityPolicy(opts: { dev: boolean; https: boolean; frameAncestors: string }) {
  return [
    "default-src 'self'",
    // Next.js inlines its bootstrap scripts and the theme script in app/layout.tsx; a nonce CSP needs a
    // per-request nonce from proxy.ts and a layout change, so inline stays allowed for now
    `script-src 'self' 'unsafe-inline'${opts.dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    // program logos and partner avatars are arbitrary https images
    // http logos only on plain-http self-hosted installs; an https app would block them as mixed content
    `img-src 'self' data: blob: https:${opts.https ? "" : " http:"}`,
    "font-src 'self' data:",
    `connect-src 'self'${opts.dev ? " ws: wss:" : ""}`,
    "frame-src 'self'",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    `frame-ancestors ${opts.frameAncestors}`,
    ...(opts.https ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

export function securityHeaders(opts: { appUrl: string; dev: boolean }) {
  const https = opts.appUrl.startsWith("https://");
  const common: Header[] = [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
    },
    // only over https (browsers ignore it on http); no includeSubDomains: self-hosters' other subdomains may be http
    ...(https ? [{ key: "Strict-Transport-Security", value: "max-age=31536000" }] : []),
  ];
  return [
    { source: "/:path*", headers: common },
    {
      // pages: everything except /embed/*, the public scripts and API routes
      source: "/((?!embed/|embed\\.js|op\\.js|api/).*)",
      headers: [
        {
          key: "Content-Security-Policy",
          value: contentSecurityPolicy({ ...opts, https, frameAncestors: "'self'" }),
        },
        { key: "X-Frame-Options", value: "SAMEORIGIN" },
        { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
      ],
    },
    {
      source: "/embed/:path*",
      headers: [
        {
          key: "Content-Security-Policy",
          value: contentSecurityPolicy({ ...opts, https, frameAncestors: "*" }),
        },
      ],
    },
    { source: "/api/:path*", headers: [{ key: "Content-Security-Policy", value: "frame-ancestors 'none'" }] },
    // user-influenced SVGs (banner headline, QR target): no script, no plugins, even if opened directly
    ...["/api/banner/:path*", "/api/qr", "/api/resources/:path*"].map((source) => ({
      source,
      headers: [
        { key: "Content-Security-Policy", value: "default-src 'none'; style-src 'unsafe-inline'; sandbox" },
      ],
    })),
  ];
}

const config: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: new URL("../../", import.meta.url).pathname,
  transpilePackages: ["@openpromoter/ui", "@openpromoter/emails", "@openpromoter/db"],
  poweredByHeader: false,
  devIndicators: false,
  serverExternalPackages: ["@electric-sql/pglite"],
  // founders upload creatives (up to 10 MB each) through a server action
  experimental: { serverActions: { bodySizeLimit: "11mb" } },
  // Cache-Control for /op.js and /embed.js is set by their route handlers (ETag + versioned URLs)
  async headers() {
    return securityHeaders({
      appUrl: process.env.APP_URL ?? "http://localhost:3000",
      dev: process.env.NODE_ENV !== "production",
    });
  },
};

export default config;
