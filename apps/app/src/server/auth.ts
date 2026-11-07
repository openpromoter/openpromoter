import { account, member, session, twoFactor, user, verification, workspace } from "@openpromoter/db";
import { type BetterAuthPlugin, betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { deleteSessionCookie } from "better-auth/cookies";
import { nextCookies } from "better-auth/next-js";
import { captcha, twoFactor as twoFactorPlugin } from "better-auth/plugins";
import { and, eq, ne } from "drizzle-orm";
import { headers } from "next/headers";
import { PRODUCT } from "@/lib/config";
import { captchaSiteKey, isAppHost } from "./captcha";
import { db } from "./db";
import { sendNotice } from "./email";
import { env } from "./env";
import { limit } from "./ratelimit";

/**
 * Google and GitHub sign-in, each switched on by its two env vars, so self-hosters only see the
 * buttons they configured. Callback URLs: {APP_URL}/api/auth/callback/google and /github.
 */
const SOCIAL = {
  google: [process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET],
  github: [process.env.GITHUB_CLIENT_ID, process.env.GITHUB_CLIENT_SECRET],
} as const;
export type SocialProvider = keyof typeof SOCIAL;
export const socialProviders = (Object.keys(SOCIAL) as SocialProvider[]).filter(
  (p) => SOCIAL[p][0] && SOCIAL[p][1],
);

/** Turnstile on email sign-up, sign-in and password reset, on the app's own host only (captcha.ts says why). */
function turnstile(): BetterAuthPlugin[] {
  if (!captchaSiteKey) return [];
  const plugin = captcha({ provider: "cloudflare-turnstile", secretKey: env.TURNSTILE_SECRET_KEY! });
  return [
    {
      ...plugin,
      onRequest: async (req, ctx) => (isAppHost(req.headers) ? plugin.onRequest(req, ctx) : undefined),
    },
  ];
}

export const auth = betterAuth({
  appName: PRODUCT.name,
  baseURL: env.APP_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db(), {
    provider: "pg",
    schema: { user, session, account, verification, twoFactor },
  }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    sendResetPassword: async ({ user: u, url }) => {
      await sendNotice(u.email, `Reset your ${PRODUCT.name} password`, {
        brandName: PRODUCT.name,
        preview: "Reset your password",
        title: "Reset your password",
        paragraphs: [
          "Someone asked to reset the password for this account. If that was you, use the button below. The link expires in one hour.",
        ],
        cta: { label: "Reset password", href: url },
      });
    },
  },
  // sign-in works unverified; claiming an existing partner record requires a verified email (partners.ts)
  emailVerification: {
    sendOnSignUp: false,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user: u, url }) => {
      await sendNotice(u.email, `Confirm your email for ${PRODUCT.name}`, {
        brandName: PRODUCT.name,
        preview: "Confirm your email",
        title: "Confirm your email",
        paragraphs: [
          "Use the button below to confirm this address. If you didn't ask for this, you can ignore this email.",
        ],
        cta: { label: "Confirm email", href: url },
      });
    },
  },
  socialProviders: Object.fromEntries(
    socialProviders.map((p) => [
      p,
      { clientId: SOCIAL[p][0] as string, clientSecret: SOCIAL[p][1] as string },
    ]),
  ),
  // Linking a Google or GitHub login to an existing account needs the provider to say the email is
  // verified (better-auth's default, no trusted providers), so nobody can claim an account by email.
  user: {
    deleteUser: {
      enabled: true,
      // never leave a live program without an owner: refuse while teammates depend on this owner,
      // and delete workspaces this user owns alone
      beforeDelete: async (u) => {
        const owned = await db()
          .select({ ws: member.workspaceId })
          .from(member)
          .where(and(eq(member.userId, u.id), eq(member.role, "owner")));
        for (const { ws } of owned) {
          const others = await db()
            .select({ role: member.role })
            .from(member)
            .where(and(eq(member.workspaceId, ws), ne(member.userId, u.id)));
          if (others.some((o) => o.role === "owner")) continue;
          if (others.length)
            throw new APIError("BAD_REQUEST", {
              message: "Make another teammate an owner before deleting your account.",
            });
          await db().delete(workspace).where(eq(workspace.id, ws));
        }
      },
    },
  },
  session: { cookieCache: { enabled: true, maxAge: 300 } },
  rateLimit: {
    enabled: true,
    window: 60,
    max: 30,
    // shared across replicas (Postgres by default, see ratelimit.ts)
    customStorage: {
      consume: async (key, rule) => {
        const r = await limit(`auth:${key}`, rule.max, rule.window * 1000);
        return {
          allowed: r.ok,
          retryAfter: r.ok ? null : Math.max(1, Math.ceil((r.reset - Date.now()) / 1000)),
        };
      },
    },
  },
  advanced: {
    database: { generateId: () => crypto.randomUUID() },
    ...(process.env.TRUSTED_IP_HEADER
      ? { ipAddress: { ipAddressHeaders: [process.env.TRUSTED_IP_HEADER.toLowerCase()] } }
      : {}),
  },
  hooks: {
    // better-auth's two-factor check only runs on email sign-in. An account with two-factor on must
    // not get in through Google or GitHub without its code, so that session is dropped here.
    after: createAuthMiddleware(async (ctx) => {
      if (!ctx.path.startsWith("/callback/") && ctx.path !== "/sign-in/social") return;
      const s = ctx.context.newSession;
      if (!(s?.user as { twoFactorEnabled?: boolean } | undefined)?.twoFactorEnabled) return;
      await ctx.context.internalAdapter.deleteSession(s!.session.token);
      deleteSessionCookie(ctx);
      throw ctx.redirect(`${env.APP_URL}/login?error=two_factor_required`);
    }),
  },
  plugins: [twoFactorPlugin({ issuer: PRODUCT.name }), ...turnstile(), nextCookies()],
});

export async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}
