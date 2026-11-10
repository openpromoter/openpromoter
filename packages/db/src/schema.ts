import { sql } from "drizzle-orm";
import {
  boolean,
  customType,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/** Raw file bytes (founder creatives). ponytail: files live in Postgres, move to object storage past a few GB. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const created = () => ts("created_at").notNull().defaultNow();
const updated = () => ts("updated_at").notNull().defaultNow();

/* ------------------------------------------------------------------ auth (Better Auth) */

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  twoFactorEnabled: boolean("two_factor_enabled").default(false),
  createdAt: created(),
  updatedAt: updated(),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: ts("expires_at").notNull(),
    token: text("token").notNull().unique(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [index("session_user").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: ts("access_token_expires_at"),
    refreshTokenExpiresAt: ts("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: created(),
    updatedAt: updated(),
  },
  // social sign-in looks accounts up by provider and provider account id on every login
  (t) => [index("account_user").on(t.userId), index("account_provider").on(t.providerId, t.accountId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: ts("expires_at").notNull(),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [index("verification_identifier").on(t.identifier)],
);

export const twoFactor = pgTable("two_factor", {
  id: text("id").primaryKey(),
  secret: text("secret").notNull(),
  backupCodes: text("backup_codes").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  verified: boolean("verified").default(true),
  failedVerificationCount: integer("failed_verification_count").default(0),
  lockedUntil: ts("locked_until"),
});

/* ------------------------------------------------------------------ tenancy */

export type Role = "owner" | "admin" | "finance" | "viewer";

export const workspace = pgTable("workspace", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  plan: text("plan").notNull().default("free"),
  billingCustomerId: text("billing_customer_id"),
  billingSubscriptionId: text("billing_subscription_id"),
  /** Stripe status of the plan subscription (trialing, active, past_due, canceled, ...), set by the platform webhook. */
  billingStatus: text("billing_status"),
  /** When a scheduled cancellation ends the plan. */
  billingCancelAt: ts("billing_cancel_at"),
  /** Where the business is billed, for India GST: abroad (no GST), in_home (CGST+SGST) or in_other (IGST). */
  billingRegion: text("billing_region").$type<"abroad" | "in_home" | "in_other">(),
  trialEndsAt: ts("trial_ends_at"),
  /** AI spend this month in micro-dollars (Cloud cap); resets when aiMonth changes. */
  aiMonth: text("ai_month"),
  aiSpentMicros: integer("ai_spent_micros").notNull().default(0),
  createdAt: created(),
});

export const member = pgTable(
  "member",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").$type<Role>().notNull(),
    createdAt: created(),
  },
  // the primary key serves workspace lookups; member_user serves "my programs" on every page
  (t) => [primaryKey({ columns: [t.workspaceId, t.userId] }), index("member_user").on(t.userId)],
);

export const invitation = pgTable("invitation", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspace.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: text("role").$type<Role>().notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  invitedBy: text("invited_by").references(() => user.id, { onDelete: "set null" }),
  acceptedAt: ts("accepted_at"),
  expiresAt: ts("expires_at").notNull(),
  createdAt: created(),
});

export const apiKey = pgTable("api_key", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspace.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  prefix: text("prefix").notNull(),
  hash: text("hash").notNull().unique(),
  scopes: text("scopes").array().notNull(),
  createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
  lastUsedAt: ts("last_used_at"),
  revokedAt: ts("revoked_at"),
  createdAt: created(),
});

export const auditLog = pgTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    actorType: text("actor_type").$type<"user" | "api_key" | "system" | "ai" | "partner">().notNull(),
    actorId: text("actor_id"),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    data: jsonb("data").$type<Record<string, unknown>>(),
    createdAt: created(),
  },
  (t) => [index("audit_ws_created").on(t.workspaceId, t.createdAt), index("audit_created").on(t.createdAt)],
);

/* ------------------------------------------------------------------ billing connection */

export const billingConnection = pgTable(
  "billing_connection",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    provider: text("provider")
      .$type<"stripe" | "paddle" | "lemonsqueezy" | "polar" | "chargebee" | "paypal" | "wise">()
      .notNull(),
    mode: text("mode").$type<"oauth" | "api_key">().notNull(),
    accountId: text("account_id"),
    /** AES-GCM encrypted secret (API key or OAuth access token). */
    secretEnc: text("secret_enc"),
    webhookSecretEnc: text("webhook_secret_enc"),
    webhookEndpointId: text("webhook_endpoint_id"),
    livemode: boolean("livemode").notNull().default(false),
    lastEventAt: ts("last_event_at"),
    importedAt: ts("imported_at"),
    createdAt: created(),
  },
  (t) => [uniqueIndex("billing_conn_ws_provider").on(t.workspaceId, t.provider)],
);

/** Processed provider events, for idempotent webhook handling. */
export const processedEvent = pgTable(
  "processed_event",
  {
    provider: text("provider").notNull(),
    eventId: text("event_id").notNull(),
    workspaceId: text("workspace_id").notNull(),
    type: text("type").notNull(),
    processedAt: created(),
  },
  // scoped by workspace: API conversion ids are chosen by each tenant and must not collide across tenants
  (t) => [primaryKey({ columns: [t.workspaceId, t.provider, t.eventId] })],
);

/**
 * A charge or payment id that pays an invoice, from Stripe's invoice_payment.paid. Kept when it arrives
 * before the invoice's commission so refunds and disputes on that charge still map back.
 */
/**
 * A paid invoice with no partner yet. Stripe may deliver invoice.paid before the checkout session that
 * carries the click id; when a referral appears for the customer the payment is booked from here.
 * Kept for two days.
 */
export const parkedPayment = pgTable(
  "parked_payment",
  {
    workspaceId: text("workspace_id").notNull(),
    provider: text("provider").notNull(),
    paymentId: text("payment_id").notNull(),
    customerId: text("customer_id").notNull(),
    event: jsonb("event").$type<Record<string, unknown>>().notNull(),
    test: boolean("test").notNull().default(false),
    createdAt: created(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.provider, t.paymentId] }),
    index("parked_payment_customer").on(t.workspaceId, t.customerId),
  ],
);

export const chargeLink = pgTable(
  "charge_link",
  {
    workspaceId: text("workspace_id").notNull(),
    provider: text("provider").notNull(),
    paymentId: text("payment_id").notNull(),
    chargeId: text("charge_id").notNull(),
    createdAt: created(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.provider, t.chargeId] }),
    index("charge_link_payment").on(t.paymentId),
  ],
);

export const billingPrice = pgTable(
  "billing_price",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    externalId: text("external_id").notNull(),
    productName: text("product_name").notNull(),
    unitAmount: integer("unit_amount"),
    currency: text("currency").notNull(),
    interval: text("interval"),
    active: boolean("active").notNull().default(true),
  },
  (t) => [uniqueIndex("billing_price_ext").on(t.workspaceId, t.externalId)],
);

/** Paying customers imported from the billing provider (used by the recruiter and analytics). */
export const billingCustomer = pgTable(
  "billing_customer",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    externalId: text("external_id").notNull(),
    email: text("email"),
    name: text("name"),
    lifetimeValue: integer("lifetime_value").notNull().default(0),
    currency: text("currency").notNull().default("usd"),
    activeSubscription: boolean("active_subscription").notNull().default(false),
    customerSince: ts("customer_since"),
    metadata: jsonb("metadata").$type<Record<string, string>>(),
  },
  (t) => [uniqueIndex("billing_customer_ext").on(t.workspaceId, t.externalId)],
);

/* ------------------------------------------------------------------ programs */

export type CommissionType = "percent" | "fixed";
export type CommissionDuration = "once" | "months" | "lifetime";

export interface Brand {
  logoUrl?: string | null;
  color: string;
  accent?: string;
  headline?: string;
  description?: string;
  fontFamily?: string;
}

/** Marketplace categories a founder can pick for a listed program. */
export const PROGRAM_CATEGORIES = [
  "AI",
  "Analytics",
  "Developer tools",
  "Design",
  "E-commerce",
  "Education",
  "Finance",
  "Marketing",
  "Productivity",
  "Sales",
  "Security",
  "Other",
] as const;
export type ProgramCategory = (typeof PROGRAM_CATEGORIES)[number];

export interface ApplicationQuestion {
  id: string;
  label: string;
  type: "text" | "textarea" | "url" | "select" | "multi" | "checkbox";
  required: boolean;
  /** Choices for "select" (one) and "multi" (any number). */
  options?: string[];
}

export interface AutoApproveRules {
  enabled: boolean;
  /** Only auto approve when the fraud score at signup is below this. */
  maxRiskScore: number;
  requireWebsite: boolean;
  blockedCountries: string[];
  allowedEmailDomains: string[];
}

export interface DoubleSided {
  enabled: boolean;
  /** Discount for the referred customer, as a Stripe coupon id or a percent. */
  percentOff: number;
  durationMonths: number;
  stripeCouponId?: string | null;
}

/** A rate for one billing price or product. `id` is the provider's price or product id. */
export interface ProductRate {
  id: string;
  /** What the founder and partners see, e.g. "Pro, $49/month". */
  label: string;
  type: CommissionType;
  /** Basis points for percent, minor units of the program currency for fixed. */
  value: number;
}

export const program = pgTable(
  "program",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    websiteUrl: text("website_url").notNull(),
    currency: text("currency").notNull().default("usd"),
    commissionType: text("commission_type").$type<CommissionType>().notNull().default("percent"),
    /** Percent as basis points (3000 = 30%) or fixed amount in minor units. */
    commissionValue: integer("commission_value").notNull().default(3000),
    commissionDuration: text("commission_duration").$type<CommissionDuration>().notNull().default("months"),
    commissionMonths: integer("commission_months").notNull().default(12),
    /** After the first commissionMonths, keep paying this rate for life (same unit as commissionValue). null = stop. */
    commissionAfterValue: integer("commission_after_value"),
    /** Per-product rates; a payment for a listed price or product earns that rate instead of the tier or program rate. */
    productRates: jsonb("product_rates").$type<ProductRate[]>().notNull().default([]),
    cookieDays: integer("cookie_days").notNull().default(60),
    attributionModel: text("attribution_model")
      .$type<"first_click" | "last_click">()
      .notNull()
      .default("last_click"),
    holdDays: integer("hold_days").notNull().default(30),
    minPayout: integer("min_payout").notNull().default(5000),
    payoutSchedule: text("payout_schedule")
      .$type<"manual" | "monthly" | "weekly">()
      .notNull()
      .default("monthly"),
    payoutMethods: text("payout_methods")
      .array()
      .notNull()
      .default(sql`ARRAY['stripe','paypal','wise']::text[]`),
    leadCommission: integer("lead_commission").notNull().default(0),
    referralParam: text("referral_param").notNull().default("via"),
    visibility: text("visibility").$type<"public" | "private" | "invite_only">().notNull().default("public"),
    customDomain: text("custom_domain"),
    customDomainVerifiedAt: ts("custom_domain_verified_at"),
    brand: jsonb("brand").$type<Brand>().notNull(),
    applicationQuestions: jsonb("application_questions").$type<ApplicationQuestion[]>().notNull().default([]),
    autoApprove: jsonb("auto_approve").$type<AutoApproveRules>().notNull(),
    doubleSided: jsonb("double_sided").$type<DoubleSided>().notNull(),
    fraudHoldScore: integer("fraud_hold_score").notNull().default(70),
    terms: text("terms"),
    designRationale: jsonb("design_rationale").$type<Record<string, string>>(),
    installVerifiedAt: ts("install_verified_at"),
    autopilotEnabled: boolean("autopilot_enabled").notNull().default(true),
    autopilotMode: text("autopilot_mode").$type<"suggest" | "act">().notNull().default("suggest"),
    /** Opt-in listing in the partner marketplace (/network). */
    listedInNetwork: boolean("listed_in_network").notNull().default(false),
    /** Marketplace category (one of PROGRAM_CATEGORIES). */
    category: text("category").$type<ProgramCategory>(),
    /** Two-tier: a recruiter earns this share of each sub-partner commission (basis points, 0 = off). */
    overrideRate: integer("override_rate").notNull().default(0),
    /** Payout batches above this total (minor units) need a fresh 2FA code. */
    payoutTwoFactorAbove: integer("payout_two_factor_above").notNull().default(100000),
    /** Last self-billed invoice number handed out (OP-00001...). Bumped in the approval transaction. */
    payoutSeq: integer("payout_seq").notNull().default(0),
    createdAt: created(),
  },
  // one program per verified custom domain: a second tenant can't verify (and take over) a domain already in use
  (t) => [
    uniqueIndex("program_custom_domain_verified")
      .on(t.customDomain)
      .where(sql`custom_domain_verified_at is not null`),
  ],
);

export const partnerGroup = pgTable(
  "partner_group",
  {
    id: text("id").primaryKey(),
    programId: text("program_id")
      .notNull()
      .references(() => program.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    rank: integer("rank").notNull().default(0),
    commissionType: text("commission_type").$type<CommissionType>(),
    commissionValue: integer("commission_value"),
    /** Auto promote into this tier when the partner's attributed revenue (minor units) reaches this. */
    promoteAtRevenue: integer("promote_at_revenue"),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: created(),
  },
  // target of partner (group_id, program_id) → partner_group (id, program_id), added in SQL (0002):
  // a partner can only be put in a tier of its own program
  (t) => [uniqueIndex("partner_group_id_program").on(t.id, t.programId)],
);

/* ------------------------------------------------------------------ partners */

export type PartnerStatus = "pending" | "approved" | "rejected" | "paused" | "banned";

export const partner = pgTable(
  "partner",
  {
    id: text("id").primaryKey(),
    programId: text("program_id")
      .notNull()
      .references(() => program.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    email: text("email").notNull(),
    name: text("name").notNull(),
    website: text("website"),
    country: text("country"),
    status: text("status").$type<PartnerStatus>().notNull().default("pending"),
    groupId: text("group_id").references(() => partnerGroup.id, { onDelete: "set null" }),
    code: text("code").notNull(),
    answers: jsonb("answers").$type<Record<string, string>>().notNull().default({}),
    source: text("source")
      .$type<"application" | "invite" | "recruiter" | "import" | "api">()
      .notNull()
      .default("application"),
    payoutMethod: text("payout_method").$type<"stripe" | "paypal" | "wise" | "manual">(),
    paypalEmail: text("paypal_email"),
    wiseEmail: text("wise_email"),
    stripeAccountId: text("stripe_account_id"),
    stripePayoutsEnabled: boolean("stripe_payouts_enabled").notNull().default(false),
    taxFormType: text("tax_form_type").$type<"w9" | "w8ben" | "w8bene" | "none">(),
    taxFormStatus: text("tax_form_status")
      .$type<"missing" | "submitted" | "verified">()
      .notNull()
      .default("missing"),
    /** Encrypted tax identifier (only when collected in-app, not via Stripe). */
    taxIdEnc: text("tax_id_enc"),
    taxLegalName: text("tax_legal_name"),
    taxAddress: text("tax_address"),
    vatId: text("vat_id"),
    riskScore: integer("risk_score").notNull().default(0),
    /** Per-partner override of the commission rate (basis points, or minor units for fixed programs). */
    commissionOverride: integer("commission_override"),
    /** Two-tier: the partner whose recruit link brought this partner in. FK (recruited_by, program_id) →
     * partner (id, program_id) is added in SQL (0004), so a recruiter is always in the same program. */
    recruitedBy: text("recruited_by"),
    vatValid: boolean("vat_valid"),
    vatCheckedAt: ts("vat_checked_at"),
    signupIpHash: text("signup_ip_hash"),
    notes: text("notes"),
    lastActiveAt: ts("last_active_at"),
    approvedAt: ts("approved_at"),
    createdAt: created(),
  },
  (t) => [
    uniqueIndex("partner_program_email").on(t.programId, t.email),
    uniqueIndex("partner_program_code").on(t.programId, t.code),
    index("partner_ws").on(t.workspaceId),
    index("partner_email").on(t.email),
    index("partner_user").on(t.userId),
    // click path and attribution look codes up case-insensitively
    index("partner_program_lower_code").on(t.programId, sql`lower(${t.code})`),
    index("partner_program_status").on(t.programId, t.status),
    index("partner_recruited_by").on(t.recruitedBy).where(sql`recruited_by is not null`),
    uniqueIndex("partner_id_program").on(t.id, t.programId),
  ],
);

export const link = pgTable(
  "link",
  {
    id: text("id").primaryKey(),
    programId: text("program_id")
      .notNull()
      .references(() => program.id, { onDelete: "cascade" }),
    partnerId: text("partner_id")
      .notNull()
      .references(() => partner.id, { onDelete: "cascade" }),
    // unique per program: redirects look a key up under its program's slug
    key: text("key").notNull(),
    destination: text("destination").notNull(),
    subId: text("sub_id"),
    label: text("label"),
    createdAt: created(),
  },
  (t) => [index("link_partner").on(t.partnerId), uniqueIndex("link_program_key").on(t.programId, t.key)],
);

export const promoCode = pgTable(
  "promo_code",
  {
    id: text("id").primaryKey(),
    programId: text("program_id")
      .notNull()
      .references(() => program.id, { onDelete: "cascade" }),
    partnerId: text("partner_id")
      .notNull()
      .references(() => partner.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    externalId: text("external_id"),
    createdAt: created(),
  },
  (t) => [
    uniqueIndex("promo_program_code").on(t.programId, t.code),
    index("promo_program_lower_code").on(t.programId, sql`lower(${t.code})`),
  ],
);

/* ------------------------------------------------------------------ tracking */

export const click = pgTable(
  "click",
  {
    id: text("id").primaryKey(),
    programId: text("program_id")
      .notNull()
      .references(() => program.id, { onDelete: "cascade" }),
    partnerId: text("partner_id")
      .notNull()
      .references(() => partner.id, { onDelete: "cascade" }),
    linkId: text("link_id"),
    visitorId: text("visitor_id").notNull(),
    ipHash: text("ip_hash"),
    userAgent: text("user_agent"),
    referrer: text("referrer"),
    landingUrl: text("landing_url"),
    country: text("country"),
    subId: text("sub_id"),
    utm: jsonb("utm").$type<Record<string, string>>(),
    isBot: boolean("is_bot").notNull().default(false),
    createdAt: created(),
  },
  // the program/partner indexes also INCLUDE (is_bot[, partner_id]) in SQL so counts are index-only scans
  (t) => [
    index("click_program_created_cov").on(t.programId, t.createdAt),
    index("click_partner_created_cov").on(t.partnerId, t.createdAt),
    index("click_visitor_created").on(t.visitorId, t.createdAt),
    index("click_link_created").on(t.linkId, t.createdAt).where(sql`link_id is not null`),
  ],
);

/** Daily click counts per partner, kept exact by statement triggers on `click` (migration 0002). */
export const clickDaily = pgTable(
  "click_daily",
  {
    programId: text("program_id")
      .notNull()
      .references(() => program.id, { onDelete: "cascade" }),
    partnerId: text("partner_id")
      .notNull()
      .references(() => partner.id, { onDelete: "cascade" }),
    /** UTC day */
    day: date("day", { mode: "string" }).notNull(),
    /** human clicks (is_bot = false) */
    clicks: integer("clicks").notNull().default(0),
    bots: integer("bots").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.programId, t.day, t.partnerId] }),
    index("click_daily_partner").on(t.partnerId, t.day),
  ],
);

export type ReferralStatus = "lead" | "trialing" | "active" | "canceled" | "refunded";

export const referral = pgTable(
  "referral",
  {
    id: text("id").primaryKey(),
    programId: text("program_id")
      .notNull()
      .references(() => program.id, { onDelete: "cascade" }),
    partnerId: text("partner_id")
      .notNull()
      .references(() => partner.id, { onDelete: "cascade" }),
    clickId: text("click_id"),
    visitorId: text("visitor_id"),
    email: text("email"),
    name: text("name"),
    externalCustomerId: text("external_customer_id"),
    externalSubscriptionId: text("external_subscription_id"),
    via: text("via").$type<"link" | "coupon" | "metadata" | "manual" | "api">().notNull().default("link"),
    status: text("status").$type<ReferralStatus>().notNull().default("lead"),
    ipHash: text("ip_hash"),
    mrr: integer("mrr").notNull().default(0),
    revenue: integer("revenue").notNull().default(0),
    paidInvoices: integer("paid_invoices").notNull().default(0),
    /** Created from Stripe test-mode (or other sandbox) events. */
    test: boolean("test").notNull().default(false),
    convertedAt: ts("converted_at"),
    canceledAt: ts("canceled_at"),
    createdAt: created(),
  },
  (t) => [
    index("referral_program_created").on(t.programId, t.createdAt),
    // INCLUDE (revenue) in SQL: per-partner lifetime totals are index-only
    index("referral_partner_converted").on(t.partnerId, t.convertedAt),
    uniqueIndex("referral_program_customer").on(t.programId, t.externalCustomerId),
    index("referral_program_converted").on(t.programId, t.convertedAt).where(sql`converted_at is not null`),
    index("referral_program_status").on(t.programId, t.status),
    index("referral_program_lower_email").on(t.programId, sql`lower(${t.email})`),
    index("referral_click").on(t.clickId).where(sql`click_id is not null`),
  ],
);

/* ------------------------------------------------------------------ money */

export type CommissionStatus = "pending" | "approved" | "held" | "paid" | "reversed";

export const commission = pgTable(
  "commission",
  {
    id: text("id").primaryKey(),
    programId: text("program_id")
      .notNull()
      .references(() => program.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    partnerId: text("partner_id")
      .notNull()
      .references(() => partner.id, { onDelete: "cascade" }),
    referralId: text("referral_id").references(() => referral.id, { onDelete: "set null" }),
    kind: text("kind").$type<"sale" | "lead" | "bounty" | "bonus" | "adjustment" | "override">().notNull(),
    /** Override rows: the sub-partner commission this one was earned on. */
    parentId: text("parent_id"),
    /** Idempotency key, e.g. "stripe:in_123" or "bounty:cmp_1:prt_2". */
    sourceKey: text("source_key").notNull(),
    saleAmount: integer("sale_amount").notNull().default(0),
    amount: integer("amount").notNull(),
    currency: text("currency").notNull(),
    /**
     * Minor units of this row's currency × fxRate = minor units of the program's currency, for the founder's
     * reports. 1 when they match; from the provider's own figures or the ECB rate otherwise; null until known.
     */
    fxRate: doublePrecision("fx_rate"),
    status: text("status").$type<CommissionStatus>().notNull().default("pending"),
    holdUntil: ts("hold_until"),
    heldReason: text("held_reason"),
    campaignId: text("campaign_id"),
    payoutId: text("payout_id"),
    externalChargeId: text("external_charge_id"),
    description: text("description"),
    test: boolean("test").notNull().default(false),
    createdAt: created(),
    updatedAt: updated(),
  },
  // the created/status indexes also INCLUDE the money columns in SQL so dashboard sums are index-only
  (t) => [
    // text_pattern_ops so `source_key like 'refund:<id>:%'` uses the index under any collation
    uniqueIndex("commission_program_source_key").on(t.programId, t.sourceKey.op("text_pattern_ops")),
    index("commission_program_created_cov").on(t.programId, t.createdAt),
    index("commission_ws_created").on(t.workspaceId, t.createdAt),
    index("commission_partner_created").on(t.partnerId, t.createdAt),
    index("commission_program_status").on(t.programId, t.status),
    index("commission_charge").on(t.externalChargeId),
    index("commission_pending_hold").on(t.holdUntil).where(sql`status = 'pending'`),
    index("commission_payout").on(t.payoutId).where(sql`payout_id is not null`),
    index("commission_parent").on(t.parentId).where(sql`parent_id is not null`),
    // rows still waiting for an exchange rate (the worker fills them)
    index("commission_fx_unknown").on(t.createdAt).where(sql`fx_rate is null`),
  ],
);

export type PayoutStatus = "awaiting_approval" | "processing" | "paid" | "failed" | "canceled";

export const payout = pgTable(
  "payout",
  {
    id: text("id").primaryKey(),
    programId: text("program_id")
      .notNull()
      .references(() => program.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    partnerId: text("partner_id")
      .notNull()
      .references(() => partner.id, { onDelete: "cascade" }),
    amount: integer("amount").notNull(),
    currency: text("currency").notNull(),
    method: text("method").$type<"stripe" | "paypal" | "wise" | "manual">().notNull(),
    status: text("status").$type<PayoutStatus>().notNull().default("awaiting_approval"),
    externalId: text("external_id"),
    failureReason: text("failure_reason"),
    requestedBy: text("requested_by"),
    approvedBy: text("approved_by"),
    approvedAt: ts("approved_at"),
    paidAt: ts("paid_at"),
    periodStart: ts("period_start"),
    periodEnd: ts("period_end"),
    invoiceNumber: text("invoice_number"),
    /** Pays test-mode commissions only. Always manual, so no money moves. */
    test: boolean("test").notNull().default(false),
    createdAt: created(),
  },
  (t) => [
    // INCLUDE (amount) in SQL
    index("payout_program_status_paid").on(t.programId, t.status, t.paidAt),
    index("payout_partner").on(t.partnerId),
  ],
);

/* ------------------------------------------------------------------ growth */

export interface CampaignRule {
  kind: "boost" | "bounty" | "contest";
  /** boost: multiply commission (e.g. 2 = double). */
  multiplier?: number;
  /** boost: only invoices for these intervals (month/year). */
  intervals?: string[];
  /** bounty trigger and fixed reward (minor units). */
  trigger?: "signup" | "first_sale" | "revenue_milestone" | "post";
  reward?: number;
  milestone?: number;
  /** contest: prizes (minor units) by rank, metric to rank by. */
  prizes?: number[];
  metric?: "revenue" | "referrals" | "clicks";
  groupIds?: string[];
}

export const campaign = pgTable("campaign", {
  id: text("id").primaryKey(),
  programId: text("program_id")
    .notNull()
    .references(() => program.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  rule: jsonb("rule").$type<CampaignRule>().notNull(),
  status: text("status").$type<"draft" | "active" | "ended">().notNull().default("draft"),
  startsAt: ts("starts_at").notNull(),
  endsAt: ts("ends_at"),
  prompt: text("prompt"),
  settledAt: ts("settled_at"),
  createdAt: created(),
});

export const bountySubmission = pgTable("bounty_submission", {
  id: text("id").primaryKey(),
  campaignId: text("campaign_id")
    .notNull()
    .references(() => campaign.id, { onDelete: "cascade" }),
  partnerId: text("partner_id")
    .notNull()
    .references(() => partner.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  note: text("note"),
  status: text("status").$type<"pending" | "approved" | "rejected">().notNull().default("pending"),
  createdAt: created(),
});

/** Every AI or automation action, with what it changed and how to undo it. */
export const agentAction = pgTable(
  "agent_action",
  {
    id: text("id").primaryKey(),
    programId: text("program_id")
      .notNull()
      .references(() => program.id, { onDelete: "cascade" }),
    source: text("source")
      .$type<"autopilot" | "recruiter" | "fraud" | "designer" | "campaign" | "assistant">()
      .notNull(),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    detail: text("detail").notNull(),
    status: text("status")
      .$type<"suggested" | "applied" | "undone" | "dismissed">()
      .notNull()
      .default("suggested"),
    targetType: text("target_type"),
    targetId: text("target_id"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    undo: jsonb("undo").$type<Record<string, unknown>>(),
    impact: integer("impact"),
    runId: text("run_id"),
    appliedAt: ts("applied_at"),
    createdAt: created(),
  },
  (t) => [
    index("agent_action_program").on(t.programId, t.createdAt),
    index("agent_action_program_status").on(t.programId, t.status),
  ],
);

export const prospect = pgTable(
  "prospect",
  {
    id: text("id").primaryKey(),
    programId: text("program_id")
      .notNull()
      .references(() => program.id, { onDelete: "cascade" }),
    source: text("source").$type<"customer" | "creator" | "manual">().notNull(),
    name: text("name").notNull(),
    email: text("email"),
    url: text("url"),
    reason: text("reason").notNull(),
    score: integer("score").notNull().default(50),
    inviteSubject: text("invite_subject"),
    inviteBody: text("invite_body"),
    status: text("status")
      .$type<"new" | "approved" | "sent" | "followed_up" | "joined" | "dismissed">()
      .notNull()
      .default("new"),
    sentAt: ts("sent_at"),
    followUpAt: ts("follow_up_at"),
    createdAt: created(),
  },
  (t) => [uniqueIndex("prospect_program_email").on(t.programId, t.email)],
);

export const contentAsset = pgTable("content_asset", {
  id: text("id").primaryKey(),
  programId: text("program_id")
    .notNull()
    .references(() => program.id, { onDelete: "cascade" }),
  kind: text("kind").$type<"swipe" | "social" | "email" | "comparison" | "banner">().notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  meta: jsonb("meta").$type<Record<string, unknown>>(),
  generatedBy: text("generated_by").$type<"ai" | "template" | "user">().notNull().default("template"),
  sourceHash: text("source_hash"),
  createdAt: created(),
});

export const resource = pgTable("resource", {
  id: text("id").primaryKey(),
  programId: text("program_id")
    .notNull()
    .references(() => program.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  url: text("url").notNull(),
  description: text("description"),
  /** Uploaded file, served at /api/resources/<id>; null for plain links. */
  fileName: text("file_name"),
  fileType: text("file_type"),
  fileData: bytea("file_data"),
  createdAt: created(),
});

export const message = pgTable(
  "message",
  {
    id: text("id").primaryKey(),
    programId: text("program_id")
      .notNull()
      .references(() => program.id, { onDelete: "cascade" }),
    /** Null partnerId = announcement to all partners. */
    partnerId: text("partner_id").references(() => partner.id, { onDelete: "cascade" }),
    fromPartner: boolean("from_partner").notNull().default(false),
    authorId: text("author_id"),
    subject: text("subject"),
    body: text("body").notNull(),
    readAt: ts("read_at"),
    createdAt: created(),
  },
  (t) => [index("message_program_partner").on(t.programId, t.partnerId, t.createdAt)],
);

export const fraudFlag = pgTable(
  "fraud_flag",
  {
    id: text("id").primaryKey(),
    programId: text("program_id")
      .notNull()
      .references(() => program.id, { onDelete: "cascade" }),
    partnerId: text("partner_id")
      .notNull()
      .references(() => partner.id, { onDelete: "cascade" }),
    referralId: text("referral_id"),
    signal: text("signal").notNull(),
    score: integer("score").notNull(),
    detail: text("detail").notNull(),
    resolution: text("resolution").$type<"open" | "dismissed" | "confirmed">().notNull().default("open"),
    createdAt: created(),
  },
  (t) => [
    uniqueIndex("fraud_flag_unique").on(t.partnerId, t.signal, t.referralId),
    index("fraud_flag_program_resolution").on(t.programId, t.resolution),
  ],
);

/* ------------------------------------------------------------------ platform */

export const webhookEndpoint = pgTable("webhook_endpoint", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspace.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  kind: text("kind").$type<"webhook" | "slack" | "discord">().notNull().default("webhook"),
  secret: text("secret").notNull(),
  events: text("events").array().notNull(),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: created(),
});

export const webhookDelivery = pgTable(
  "webhook_delivery",
  {
    id: text("id").primaryKey(),
    endpointId: text("endpoint_id")
      .notNull()
      .references(() => webhookEndpoint.id, { onDelete: "cascade" }),
    event: text("event").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: text("status").$type<"pending" | "succeeded" | "failed">().notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    responseStatus: integer("response_status"),
    lastError: text("last_error"),
    createdAt: created(),
  },
  (t) => [
    index("delivery_endpoint").on(t.endpointId, t.createdAt),
    index("delivery_failed").on(t.createdAt).where(sql`status = 'failed'`),
  ],
);

export const reportSubscription = pgTable("report_subscription", {
  id: text("id").primaryKey(),
  programId: text("program_id")
    .notNull()
    .references(() => program.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  frequency: text("frequency").$type<"weekly" | "monthly">().notNull().default("weekly"),
  lastSentAt: ts("last_sent_at"),
  createdAt: created(),
});

export const savedView = pgTable("saved_view", {
  id: text("id").primaryKey(),
  programId: text("program_id")
    .notNull()
    .references(() => program.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  table: text("table").notNull(),
  name: text("name").notNull(),
  query: text("query").notNull(),
  createdAt: created(),
});

/** Postgres-backed job queue (SELECT ... FOR UPDATE SKIP LOCKED). */
export const job = pgTable(
  "job",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    runAt: ts("run_at").notNull().defaultNow(),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(8),
    lockedAt: ts("locked_at"),
    doneAt: ts("done_at"),
    /** Dead letter: set when the last attempt failed. Kept for inspection, never retried automatically. */
    failedAt: ts("failed_at"),
    lastError: text("last_error"),
    dedupeKey: text("dedupe_key").unique(),
    createdAt: created(),
  },
  (t) => [
    index("job_due").on(t.runAt).where(sql`done_at is null and failed_at is null`),
    index("job_done").on(t.doneAt).where(sql`done_at is not null`),
    index("job_failed").on(t.failedAt).where(sql`failed_at is not null`),
  ],
);

/** Shared fixed-window rate limit counters (UNLOGGED in SQL: losing them on a crash is fine). Keys are hashed. */
export const rateLimit = pgTable(
  "rate_limit",
  {
    key: text("key").primaryKey(),
    count: integer("count").notNull(),
    resetAt: ts("reset_at").notNull(),
  },
  (t) => [index("rate_limit_reset").on(t.resetAt)],
);

export const kvStore = pgTable("kv", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<Record<string, unknown>>().notNull(),
  updatedAt: updated(),
});

/** Outgoing events, kept for the API/CLI event stream (`openpromoter listen`). */
export const eventLog = pgTable(
  "event_log",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
    createdAt: created(),
  },
  (t) => [index("event_log_ws").on(t.workspaceId, t.id)],
);

/**
 * Every email the app sent, for support ("I never got the reset email"): who, what, when and what the
 * mail provider reported back (Amazon SES delivery, bounce and complaint notices). Bodies are never stored,
 * since sign-in and reset emails carry live links. Kept 30 days (pruneJobs).
 */
export const emailLog = pgTable(
  "email_log",
  {
    id: text("id").primaryKey(),
    to: text("to").notNull(),
    subject: text("subject").notNull(),
    programId: text("program_id").references(() => program.id, { onDelete: "set null" }),
    /** The provider's message id (SES: the id in its SMTP "250 Ok" reply), to match its notices. */
    messageId: text("message_id"),
    status: text("status")
      .$type<"sent" | "delivered" | "bounced" | "complained" | "failed" | "not_sent">()
      .notNull(),
    detail: text("detail"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("email_log_created").on(t.createdAt),
    index("email_log_to_created").on(t.to, t.createdAt),
    index("email_log_message").on(t.messageId).where(sql`message_id is not null`),
  ],
);
