# Security

Please report vulnerabilities privately to **security@openpromoter.com** (or a GitHub security advisory on this repo). We aim to reply within 3 business days. Please don't open public issues for security reports.

## How OpenPromoter protects your data

- **Tenant isolation**: every dashboard route, server action and API call resolves the program through a membership check (`apps/app/src/server/access.ts`); API keys are bound to one workspace. The database also enforces it where a write path could slip: a partner's tier must belong to the partner's program (composite foreign key), webhook idempotency keys are scoped per workspace, and a verified custom domain can belong to only one program. Covered by tests.
- **Roles**: owner, admin, finance, viewer. Money actions need `money.write`; approving payouts also needs a signed-in person (never an API key, MCP or AI), and batches over the program threshold need a fresh 2FA code.
- **Webhooks in**: Stripe, Paddle, Lemon Squeezy, Polar signatures (and Chargebee basic auth) are verified on the raw body with timing-safe comparison; Stripe, Paddle and Polar timestamps must be within 5 minutes (non-numeric timestamps are rejected); bodies over 2 MB are refused before verification; processing is idempotent per workspace and event id, which also covers replays for Lemon Squeezy and Chargebee (their signatures carry no timestamp).
- **Webhooks out**: `OpenPromoter-Signature: t=…,v1=HMAC-SHA256(secret, "t.body")`, retried with backoff.
- **Secrets**: only from environment variables; provider keys and partner tax IDs are encrypted at rest (AES-256-GCM with `ENCRYPTION_KEY`); IP addresses are stored as salted hashes; logs never contain emails, keys or bodies.
- **Input**: every API and action input is validated with zod; CSV exports are protected against formula injection and streamed page by page.
- **SSRF**: server-side fetches of user URLs (brand extraction; outgoing webhooks on the cloud edition) go through `server/safe-fetch.ts`: http(s) only, every resolved address checked against private, loopback, link-local, CGNAT and multicast ranges at connect time (no DNS rebinding), redirects re-checked hop by hop, bodies and time capped.
- **Short links** only redirect to the program's website or to a link destination checked against it when the link was created; anything that isn't http(s) falls back to the website.
- **Headers** (`apps/app/next.config.ts`): Content-Security-Policy (`object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'self'`), HSTS when `APP_URL` is https, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `X-Frame-Options`. Only `/embed/*` (the embeddable partner dashboard) can be framed by other sites; generated SVGs are served with a sandbox CSP.
- **Rate limits** on tracking, the API and sign-in are shared by all replicas through Postgres (`RATE_LIMIT_STORE`). Client IPs come from the last `X-Forwarded-For` hop, or from `TRUSTED_IP_HEADER` (e.g. `cf-connecting-ip`) when set; other client-supplied headers are ignored.
- **Auth**: Better Auth with rate-limited sign-in, TOTP 2FA, httpOnly session cookies (Secure on https); server actions are origin-checked by Next.js. Taking over a partner record someone else created (an invite, import or API call) requires a verified email. The Stripe Connect OAuth `state` is signed and expires after an hour.
- **Audit log** of every money, permission and AI action.
