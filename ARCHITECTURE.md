# OpenPromoter architecture

## Stack (versions confirmed on npm, 2026-11-03)

| Layer | Choice | Why |
|---|---|---|
| Monorepo | pnpm 10 + Turborepo 2.11 | Standard for TS open source, cached builds |
| App | Next.js 16.4 (App Router, React 19.3), TypeScript 5.9 strict | One deployable for dashboard, partner portal, REST API, tracking and worker |
| DB | PostgreSQL 16 + Drizzle ORM 0.45 (`postgres` driver) | SQL-first, typed, plain migrations in `packages/db/drizzle` |
| Tests DB | PGlite 0.4 (in-process Postgres) | Unit/integration tests run the real migrations with no Docker |
| Auth | Better Auth 1.7 (email + password, 2FA/TOTP plugin) | Self-hostable, owns its tables in our DB |
| UI | Tailwind CSS 4.3 + Radix (via `radix-ui`) + own shadcn-style kit in `packages/ui`, lucide icons, Recharts 3, cmdk, sonner | Matches DESIGN.md tokens |
| Jobs | Postgres queue (`job` table, `FOR UPDATE SKIP LOCKED`) + kv-locked scheduler, run in-process. At-least-once; retries with exponential backoff and jitter; after `max_attempts` a job moves to the dead letter state (`failed_at`), kept 30 days. Finished jobs are pruned after 7 days | No Redis to self-host |
| Email | React Email 1.0 templates (`packages/emails`), Resend API or SMTP (nodemailer); Mailpit in docker compose | |
| AI | `apps/app/src/server/ai/provider.ts`: Anthropic SDK (default `claude-opus-5-5`, structured outputs, server-side refusal fallback) or any OpenAI-compatible endpoint (OpenAI, Ollama, LM Studio) | Every AI feature has a non-AI fallback |
| Billing | Stripe SDK 23 + adapters for Paddle, Lemon Squeezy, Polar | One normalized `BillingEvent` type |


## Layout

```
apps/app            Next.js: /app (founder dashboard), /p/[slug] (public page, apply, partner portal),
                    /api/v1 (REST), /api/track + /op.js (tracking), /api/webhooks/* (billing), /r/* (short links)
  src/server        domain logic (no React): ingest, commission, attribution, fraud, ledger, payouts,
                    campaigns, analytics, partners, events, jobs, worker, ai/*
  src/app           routes and pages
  tests             Vitest (PGlite) unit + integration tests
  e2e               Playwright tests
packages/db         Drizzle schema + SQL migrations
packages/ui         design-system components + tokens (styles.css)
packages/emails     React Email templates
packages/sdk        `openpromoter` npm package (REST client, webhook verification, browser helper)
packages/mcp        `openpromoter-mcp` MCP server (stdio)
packages/cli        `openpromoter` CLI
skills/openpromoter agent skill for Claude Code / Cursor
```

## Data model (packages/db/src/schema.ts)

Tenancy: `workspace` ← `member(role)` → `user`. A workspace owns `program`s; everything else hangs off a program and carries `program_id` (money tables also carry `workspace_id`).

- Tracking: `link`, `promo_code`, `click` (visitor id, hashed IP, UTM, sub-id, bot flag), `referral` (lead → trialing → active → canceled/refunded; external customer/subscription ids; MRR; revenue).
- Two-tier: `partner.recruited_by` (FK to a partner of the same program) and `program.override_rate` (basis points, 0 = off). An `override` commission row points at the sub-partner's sale through `parent_id`; refunds, disputes, holds and reversals of the sale reach it there (`salesForCharge` in ingest, `followOverrides` in ledger).
- Marketplace: `program.listed_in_network` + `program.category`; `/network` lists public opted-in programs (`server/marketplace.ts`).
- Money: `commission` is an append-mostly ledger. Unique `(program_id, source_key)` makes every write idempotent (`stripe:in_…`, `lead:ref_…`, `bounty:…`, `refund:<commission>:<refund>`). States: pending → approved (after `hold_days`) → paid, plus held and reversed. Refunds after payout create a negative approved row (clawback) that nets out of the next payout. `payout` rows are created `awaiting_approval` and only a signed-in human can approve.
- Growth: `campaign` (boost | bounty | contest rule JSON), `bounty_submission`, `agent_action` (every AI/automation action with payload + undo), `prospect` (recruiter), `content_asset`, `resource`, `message`.
- Safety: `fraud_flag`, `audit_log`, `processed_event` (webhook idempotency on provider + event id), `api_key` (sha256 hash + scopes).
- Platform: `billing_connection` (AES-256-GCM encrypted secrets), `billing_price`, `billing_customer`, `webhook_endpoint`, `webhook_delivery`, `report_subscription`, `saved_view`, `job`, `kv`.

## Flows

**Click.** `/r/<program>/<code>` or a short link `/r/<program>/l/<key>` (or a custom domain mapped to the program) records a click and 302s to the founder's site with `?op_click=…`. The redirect costs one lookup (program + partner/link in one query, run in parallel with the shared rate limit); the click id is generated up front and the row is inserted after the response is sent (Next `after()`), so a crash in that window can lose a click but never delays a visitor. `click_daily` (program, UTC day, partner → human clicks, bots) is kept exact by statement-level triggers on `click`; dashboards read whole days from it and only the partial first and last day from raw rows. On the founder's site, `op.js` (one script tag) records `?via=` clicks itself, stores `op_click`/`op_visitor` in a first-party cookie for `cookie_days` (respecting first/last-click and consent mode), and decorates Stripe Payment Links, Pricing Tables and Checkout buttons with `client_reference_id`.

**Signup (lead).** `openpromoter.signup({ email })` in the browser, or `POST /api/v1/leads` from the server, creates a `referral` in `lead` state.

**Payment.** Stripe → `POST /api/webhooks/stripe/<workspace>` → signature check (`Stripe-Signature`, 5-minute tolerance) → `normalizeStripe` → `ingest()` in one transaction: insert into `processed_event` (duplicate → stop), resolve the referral (coupon → click id → partner code → visitor clicks in window → lead email), compute the commission (`commission.ts`: plan from tier/program, once/months/lifetime window, best live boost), insert with hold date, auto-hold on fraud score, enqueue side effects (bounties, tier promotion, outgoing webhooks, emails) in the same transaction (outbox). Refunds, disputes and subscription changes adjust the ledger. Out-of-order delivery is safe: every handler looks up by external ids and is idempotent.

**Payout.** Scheduler (monthly/weekly) or a click creates `awaiting_approval` payouts for partners whose approved balance ≥ minimum. A human approves → commissions are locked to the payout in a transaction → provider call with idempotency key (Stripe Transfer to the partner's Express account, PayPal Payouts `sender_batch_id`, Wise `customerTransactionId`) → paid, or failed with commissions released. Manual payouts are marked paid with a reference. CSV export for accounting.

**AI.** Designer (pricing → plan + rationale), brand extraction (site → colour/logo/copy), recruiter (paying customers ranked by tenure/LTV/active; creators via Claude web search), Autopilot (weekly suggestions: re-engage idle, promote tier, pause risky, boost campaign, approve applications, prepare payouts; "act" mode applies only safe kinds; each action has undo), campaign builder (sentence → rule), content kit (site → copy + SVG banners, refreshed when the site hash changes), assistant (question → one of 9 data tools → answer with links). AI never approves payouts.

## Security

- Tenant isolation: every route resolves the program through `requireProgram(user, programId, permission)` which checks membership; API keys are scoped to one workspace and checked the same way. Tests in `tests/access.test.ts`.
- Roles: owner, admin, finance, viewer (`server/access.ts`). Money writes need `money.write`; payout approval also requires a user session (not an API key, not AI).
- Webhooks in: signature verification for Stripe, Paddle, Lemon Squeezy, Polar; idempotent processing. Webhooks out: `OpenPromoter-Signature: t=…,v1=HMAC-SHA256(secret, "t.body")`, retries with exponential backoff (8 attempts).
- Secrets only from env; provider secrets encrypted at rest (AES-256-GCM, `ENCRYPTION_KEY`); IPs stored as salted hashes; no PII in logs.
- zod validation on every API input; rate limits on tracking and API; Better Auth rate limits on auth; Next.js server actions are origin-checked (CSRF); cookie-authenticated API routes check `Origin`.
- SSRF guard on server-side fetches of user URLs (brand extraction, webhooks).
- Audit log on every money and permission action.

## Editions

`HOSTED_MODE=true` enables cloud plans (Stripe Billing on OpenPromoter's own account), usage limits by attributed revenue, a trial and Stripe Connect OAuth. Self-host has the same features with no limits.

## Running several replicas

- **Database pool**: `DATABASE_POOL_MAX` connections per process (default 10). Keep replicas × pool under Postgres `max_connections` (docker compose sets 200).
- **Rate limits**: counters live in an UNLOGGED Postgres table (`rate_limit`, hashed keys), shared by every replica, including Better Auth's sign-in limits. `RATE_LIMIT_STORE=memory` keeps them per process for a single instance. A Redis store can implement the same `RateLimiter` interface in `server/ratelimit.ts` if Postgres write volume ever matters.
- **Custom-domain cache**: per process, but a trigger bumps `kv['domains:version']` on any domain or slug change and every replica checks it at most every 5 s, so changes propagate within seconds.
- **Jobs and schedule**: any number of workers can run `runDueJobs` (SKIP LOCKED); each scheduled task is claimed once per period through an atomic upsert on `kv`; each process runs one tick at a time. Heavy fan-out (daily fraud rescoring) is split into jobs of 200 partners.
- **Migrations** run at container start; start one replica first when upgrading (index builds in 0002 lock the click table for about a minute per 10M clicks).

## Performance notes (10M clicks, 1M referrals, 1M commissions, 10k partners in one program)

Measured on the docker compose Postgres, 2026-11-04. The dashboard home's queries (two overviews, the timeseries and top partners) went from about 5 s to about 0.15 s: clicks come from `click_daily`, money and referral counts from covering indexes, top partners from one grouped scan instead of six correlated subqueries per partner. Remaining full scans are by design and bounded by the program's size: the commissions/customers status totals and exact counts on the list pages, and traffic sources on the analytics page (raw clicks in the range).
