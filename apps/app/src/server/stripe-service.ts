import { billingConnection, billingCustomer, billingPrice, partner, program } from "@openpromoter/db";
import { and, eq, sql } from "drizzle-orm";
import type Stripe from "stripe";
import { decrypt, encrypt, hmacHex, safeEqual } from "@/lib/crypto";
import { createId } from "@/lib/id";
import { type Actor, audit } from "./audit";
import { STRIPE_EVENTS, stripeClient } from "./billing/stripe";
import { db } from "./db";
import { env } from "./env";
import { resolveReferral } from "./ingest";

export async function stripeFor(workspaceId: string) {
  const [c] = await db()
    .select()
    .from(billingConnection)
    .where(and(eq(billingConnection.workspaceId, workspaceId), eq(billingConnection.provider, "stripe")));
  if (!c?.secretEnc) return null;
  return { conn: c, stripe: stripeClient(decrypt(c.secretEnc)) };
}

export const webhookUrl = (provider: string, workspaceId: string) =>
  `${env.APP_URL}/api/webhooks/${provider}/${workspaceId}`;

/**
 * Self-host: connect with a restricted key. We verify it, then try to register our
 * webhook endpoint. Stripe rejects non-public URLs, so on localhost the founder runs
 * `stripe listen` and pastes the signing secret instead.
 */
export async function connectStripeKey(
  workspaceId: string,
  key: string,
  actor: Actor,
  webhookSecret?: string | null,
) {
  if (!/^(sk|rk)_(test|live)_/.test(key))
    throw new Error("That doesn't look like a Stripe secret or restricted key");
  const stripe = stripeClient(key);
  await stripe.customers.list({ limit: 1 });
  const livemode = key.includes("_live_");
  let ep: Endpoint = { endpointId: null, secret: null, error: null };
  if (!webhookSecret) ep = await registerEndpoint(stripe, workspaceId);
  const secret = webhookSecret ?? ep.secret;
  const values = {
    mode: "api_key" as const,
    secretEnc: encrypt(key),
    livemode,
    // a reconnect that can't create an endpoint keeps the secret that already works
    ...(secret ? { webhookSecretEnc: encrypt(secret), webhookEndpointId: ep.endpointId } : {}),
  };
  const webhookError = ep.error;
  await db()
    .insert(billingConnection)
    .values({ id: createId("bcn"), workspaceId, provider: "stripe", ...values })
    .onConflictDoUpdate({ target: [billingConnection.workspaceId, billingConnection.provider], set: values });
  await audit(
    workspaceId,
    actor,
    "billing.connect",
    { type: "billing_connection", id: "stripe" },
    { livemode, webhook: !!secret },
  );
  return { livemode, webhookConfigured: !!secret, webhookError };
}

/**
 * Create the webhook endpoint on the connected account and delete the one it replaces, so an old endpoint
 * with a stale secret doesn't keep failing deliveries.
 */
type Endpoint = { endpointId: string | null; secret: string | null; error: string | null };
async function registerEndpoint(
  stripe: ReturnType<typeof stripeClient>,
  workspaceId: string,
): Promise<Endpoint> {
  const [old] = await db()
    .select({ id: billingConnection.webhookEndpointId })
    .from(billingConnection)
    .where(and(eq(billingConnection.workspaceId, workspaceId), eq(billingConnection.provider, "stripe")));
  try {
    const ep = await stripe.webhookEndpoints.create({
      url: webhookUrl("stripe", workspaceId),
      enabled_events: STRIPE_EVENTS,
      description: "OpenPromoter attribution",
    });
    if (old?.id && old.id !== ep.id) await stripe.webhookEndpoints.del(old.id).catch(() => {});
    return { endpointId: ep.id, secret: ep.secret ?? null, error: null };
  } catch (err) {
    return { endpointId: null, secret: null, error: (err as Error).message };
  }
}

export async function setWebhookSecret(
  workspaceId: string,
  provider: "stripe" | "paddle" | "lemonsqueezy" | "polar" | "chargebee",
  secret: string,
  actor: Actor,
  apiKey?: string | null,
  livemode?: boolean,
) {
  const values = {
    webhookSecretEnc: encrypt(secret),
    ...(apiKey ? { secretEnc: encrypt(apiKey) } : {}),
    ...(livemode === undefined ? {} : { livemode }),
  };
  await db()
    .insert(billingConnection)
    .values({ id: createId("bcn"), workspaceId, provider, mode: "api_key", ...values })
    .onConflictDoUpdate({ target: [billingConnection.workspaceId, billingConnection.provider], set: values });
  await audit(workspaceId, actor, "billing.webhook_secret", { type: "billing_connection", id: provider });
}

const OAUTH_STATE_TTL = 3600;
const stateKey = () => `${process.env.ENCRYPTION_KEY ?? process.env.BETTER_AUTH_SECRET}:stripe-oauth`;

/** `<payload>.<unix ts>.<hmac>`: the callback only accepts states this server issued in the last hour (OAuth CSRF). */
export function signOAuthState(payload: string, now = Date.now()) {
  const body = `${payload}.${Math.floor(now / 1000)}`;
  return `${body}.${hmacHex(stateKey(), body)}`;
}

export function verifyOAuthState(state: string, now = Date.now()): string | null {
  const i = state.lastIndexOf(".");
  const j = state.lastIndexOf(".", i - 1);
  if (i < 0 || j < 0) return null;
  const body = state.slice(0, i);
  if (!safeEqual(hmacHex(stateKey(), body), state.slice(i + 1))) return null;
  const ts = Number(state.slice(j + 1, i));
  if (!Number.isFinite(ts) || now / 1000 - ts > OAUTH_STATE_TTL || ts - now / 1000 > 60) return null;
  return state.slice(0, j);
}

/** Cloud: Stripe Connect OAuth (standard accounts). `state` is signed here and checked by the callback. */
export function stripeOAuthUrl(state: string) {
  if (!env.STRIPE_CONNECT_CLIENT_ID) return null;
  const u = new URL("https://connect.stripe.com/oauth/authorize");
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", env.STRIPE_CONNECT_CLIENT_ID);
  u.searchParams.set("scope", "read_write");
  u.searchParams.set("state", signOAuthState(state));
  u.searchParams.set("redirect_uri", `${env.APP_URL}/api/stripe/oauth/callback`);
  return u.toString();
}

export async function completeStripeOAuth(workspaceId: string, code: string, actor: Actor) {
  if (!env.PLATFORM_STRIPE_SECRET_KEY) throw new Error("PLATFORM_STRIPE_SECRET_KEY is not set");
  const platform = stripeClient(env.PLATFORM_STRIPE_SECRET_KEY);
  const res = await platform.oauth.token({ grant_type: "authorization_code", code });
  // the access token acts as the account's secret key, so the endpoint lives on their account
  const ep = res.access_token
    ? await registerEndpoint(stripeClient(res.access_token), workspaceId)
    : { endpointId: null, secret: null, error: "Stripe returned no access token" };
  const values = {
    mode: "oauth" as const,
    accountId: res.stripe_user_id ?? null,
    secretEnc: res.access_token ? encrypt(res.access_token) : null,
    livemode: !!res.livemode,
    ...(ep.secret ? { webhookSecretEnc: encrypt(ep.secret), webhookEndpointId: ep.endpointId } : {}),
  };
  await db()
    .insert(billingConnection)
    .values({ id: createId("bcn"), workspaceId, provider: "stripe", ...values })
    .onConflictDoUpdate({ target: [billingConnection.workspaceId, billingConnection.provider], set: values });
  await audit(
    workspaceId,
    actor,
    "billing.connect_oauth",
    { type: "billing_connection", id: "stripe" },
    { webhook: !!ep.secret, webhookError: ep.error },
  );
  return { webhookError: ep.secret ? null : ep.error };
}

/** Import products, prices, customers and subscriptions; back-fill referrals from customer metadata. */
export async function importStripe(workspaceId: string) {
  const s = await stripeFor(workspaceId);
  if (!s) throw new Error("Stripe is not connected");
  const { stripe } = s;
  let prices = 0;
  for await (const p of stripe.prices.list({ limit: 100, expand: ["data.product"] })) {
    const product = p.product as Stripe.Product | string;
    const name = typeof product === "string" ? product : product.deleted ? "Deleted product" : product.name;
    await db()
      .insert(billingPrice)
      .values({
        id: createId("bpr"),
        workspaceId,
        provider: "stripe",
        externalId: p.id,
        productName: name,
        unitAmount: p.unit_amount,
        currency: p.currency,
        interval: p.recurring?.interval ?? null,
        active: p.active,
      })
      .onConflictDoUpdate({
        target: [billingPrice.workspaceId, billingPrice.externalId],
        set: { productName: name, unitAmount: p.unit_amount, active: p.active },
      });
    if (++prices >= 500) break;
  }

  const ltv = new Map<string, number>();
  let invoices = 0;
  for await (const inv of stripe.invoices.list({ limit: 100, status: "paid" })) {
    const cid = typeof inv.customer === "string" ? inv.customer : inv.customer?.id;
    if (cid) ltv.set(cid, (ltv.get(cid) ?? 0) + (inv.amount_paid ?? 0));
    if (++invoices >= 5000) break;
  }
  const active = new Set<string>();
  for await (const sub of stripe.subscriptions.list({ limit: 100, status: "active" })) {
    active.add(typeof sub.customer === "string" ? sub.customer : sub.customer.id);
    if (active.size >= 5000) break;
  }

  const programs = await db().select().from(program).where(eq(program.workspaceId, workspaceId));
  let customers = 0;
  let backfilled = 0;
  for await (const c of stripe.customers.list({ limit: 100 })) {
    if (c.deleted) continue;
    const values = {
      email: c.email ?? null,
      name: c.name ?? null,
      lifetimeValue: ltv.get(c.id) ?? 0,
      currency: c.currency ?? "usd",
      activeSubscription: active.has(c.id),
      customerSince: new Date(c.created * 1000),
      metadata: (c.metadata ?? {}) as Record<string, string>,
    };
    await db()
      .insert(billingCustomer)
      .values({ id: createId("bcu"), workspaceId, provider: "stripe", externalId: c.id, ...values })
      .onConflictDoUpdate({ target: [billingCustomer.workspaceId, billingCustomer.externalId], set: values });
    if (programs.length && (c.metadata?.op_ref || c.metadata?.op_click || c.metadata?.via)) {
      const r = await resolveReferral(
        db(),
        programs,
        c.id,
        { metadata: c.metadata as Record<string, string>, email: c.email },
        { email: c.email ?? null, name: c.name ?? null },
      );
      if (r) backfilled++;
    }
    if (++customers >= 10_000) break;
  }
  await db()
    .update(billingConnection)
    .set({ importedAt: new Date() })
    .where(eq(billingConnection.id, s.conn.id));
  return { prices, customers, invoices, activeSubscriptions: active.size, backfilled };
}

/** Partner payouts: Express account under the founder's Stripe (founder is the Connect platform). */
export async function partnerOnboardingLink(programId: string, partnerId: string, returnPath: string) {
  const [row] = await db()
    .select({ p: partner, prog: program })
    .from(partner)
    .innerJoin(program, eq(program.id, partner.programId))
    .where(and(eq(partner.id, partnerId), eq(partner.programId, programId)));
  if (!row) throw new Error("Partner not found");
  const s = await stripeFor(row.prog.workspaceId);
  if (!s) throw new Error("This program doesn't pay through Stripe yet");
  let accountId = row.p.stripeAccountId;
  if (!accountId) {
    const platform = await s.stripe.accounts.retrieveCurrent();
    const country = (row.p.country ?? platform.country ?? "US").toUpperCase();
    const acct = await s.stripe.accounts
      .create({
        type: "express",
        country,
        email: row.p.email,
        capabilities: { transfers: { requested: true } },
        // partners outside the platform's country can only receive transfers under the recipient agreement
        ...(country !== platform.country ? { tos_acceptance: { service_agreement: "recipient" } } : {}),
        business_profile: {
          url: row.p.website ?? undefined,
          product_description: `Affiliate partner of ${row.prog.name}`,
        },
        metadata: { openpromoter_partner: row.p.id },
      })
      .catch((e: Error) => {
        // Stripe accounts registered in some countries (India among them) can't be a Connect platform that
        // sends transfers. Say so plainly, not with Stripe's risk-control wording.
        if (/loss-liable/i.test(e.message))
          throw new Error(
            "This Stripe account can't pay partners through Stripe Connect. Stripe doesn't allow it for accounts registered in some countries, India among them. Pay these partners with Wise or manually.",
          );
        throw e;
      });
    accountId = acct.id;
    await db()
      .update(partner)
      .set({ stripeAccountId: acct.id, payoutMethod: "stripe" })
      .where(eq(partner.id, partnerId));
  }
  const link = await s.stripe.accountLinks.create({
    account: accountId,
    type: "account_onboarding",
    refresh_url: `${env.APP_URL}${returnPath}?stripe=refresh`,
    return_url: `${env.APP_URL}${returnPath}?stripe=return`,
  });
  return link.url;
}

export async function refreshPartnerStripe(partnerId: string) {
  const [row] = await db()
    .select({ p: partner, prog: program })
    .from(partner)
    .innerJoin(program, eq(program.id, partner.programId))
    .where(eq(partner.id, partnerId));
  if (!row?.p.stripeAccountId) return false;
  const s = await stripeFor(row.prog.workspaceId);
  if (!s) return false;
  const acct = await s.stripe.accounts.retrieve(row.p.stripeAccountId);
  const ready = acct.capabilities?.transfers === "active";
  await db()
    .update(partner)
    .set({
      stripePayoutsEnabled: ready,
      ...(ready
        ? {
            taxFormStatus: sql`case when ${partner.taxFormStatus} = 'missing' then 'submitted' else ${partner.taxFormStatus} end`,
          }
        : {}),
    })
    .where(eq(partner.id, partnerId));
  return ready;
}
