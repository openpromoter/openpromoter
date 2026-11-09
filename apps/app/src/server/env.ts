import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().optional(),
  APP_URL: z.string().default("http://localhost:3000"),
  /** Cloud edition: enables plans, limits and Stripe Connect OAuth. */
  HOSTED_MODE: z.enum(["true", "false"]).default("false"),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  /** OpenAI-compatible base URL for local models (Ollama, LM Studio). */
  OPENAI_BASE_URL: z.string().optional(),
  AI_PROVIDER: z.enum(["anthropic", "openai", "none"]).optional(),
  AI_MODEL: z.string().optional(),
  SMTP_URL: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default("OpenPromoter <hello@localhost>"),
  STRIPE_CONNECT_CLIENT_ID: z.string().optional(),
  /** OpenPromoter's own Stripe account (cloud billing + Connect OAuth). */
  PLATFORM_STRIPE_SECRET_KEY: z.string().optional(),
  PLATFORM_STRIPE_WEBHOOK_SECRET: z.string().optional(),
  /** Customer portal configuration (bpc_...) for plan billing. Unset: the account's default portal. */
  PLATFORM_STRIPE_PORTAL_CONFIG: z.string().optional(),
  /**
   * India GST on Cloud plans (Stripe Tax isn't available to Indian accounts): exclusive tax rate ids.
   * Buyers in GST_HOME_STATE pay CGST + SGST, other Indian states IGST, buyers abroad none (export under LUT).
   * Unset: no GST is added. Read in gst.ts.
   */
  GST_TAX_RATE_CGST: z.string().optional(),
  GST_TAX_RATE_SGST: z.string().optional(),
  GST_TAX_RATE_IGST: z.string().optional(),
  GST_HOME_STATE: z.string().default("UP"),
  /** Connect webhook on the platform account ("events on connected accounts"): sales of founders who used Connect with Stripe. */
  STRIPE_CONNECT_WEBHOOK_SECRET: z.string().optional(),
  /** Cloudflare for SaaS: issues HTTPS certificates for founders' custom domains (read in custom-hostnames.ts). */
  /** Comma-separated emails that may open /admin (Cloud owner view). */
  ADMIN_EMAILS: z.string().optional(),
  CLOUDFLARE_API_TOKEN: z.string().optional(),
  CLOUDFLARE_ZONE_ID: z.string().optional(),
  /** Free program subdomains: acme.<this> serves program "acme". Needs a wildcard DNS record first. */
  PROGRAM_SUBDOMAINS: z.string().optional(),
  /** Hostname founders CNAME to (defaults to the APP_URL host). */
  CUSTOM_DOMAIN_TARGET: z.string().optional(),
  /** Cloudflare Turnstile on sign-up, sign-in, password reset and partner applications (read in captcha.ts). */
  TURNSTILE_SITE_KEY: z.string().optional(),
  TURNSTILE_SECRET_KEY: z.string().optional(),
  RUN_WORKER: z.enum(["true", "false"]).default("true"),
  /** Connections per process (read in db.ts). */
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(500).optional(),
  /** postgres (default, shared by replicas) or memory (single instance). Read in ratelimit.ts. */
  RATE_LIMIT_STORE: z.enum(["postgres", "memory"]).optional(),
  /** Header holding the client IP set by your proxy/CDN (e.g. cf-connecting-ip). Read in ratelimit.ts. */
  TRUSTED_IP_HEADER: z.string().optional(),
});

export const env = schema.parse(process.env);
export const isHosted = () => env.HOSTED_MODE === "true";
