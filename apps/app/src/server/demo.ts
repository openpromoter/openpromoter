import { user } from "@openpromoter/db";
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { DEMO } from "@/lib/demo-accounts";
import { subdomainSlug } from "@/lib/subdomain";
import { db } from "./db";

/**
 * The public demo (PUBLIC_DEMO=true): anyone can open the seeded Acme Analytics workspace as its founder
 * or as one of its partners, read-only. The demo accounts have no password; the only way in is the demo
 * button, which signs the visitor in for a day. Nightly the whole workspace is rebuilt (worker.ts).
 */
export const demoOn = () => process.env.PUBLIC_DEMO === "true";

const DEMO_EMAILS = () => [DEMO.email, DEMO.partnerEmail];
export const isDemoUser = (u: { email?: string | null } | null | undefined) =>
  !!u?.email && demoOn() && DEMO_EMAILS().includes(u.email.toLowerCase());

export const DEMO_READ_ONLY =
  "This is the demo. Changes aren't saved. Start free to set up your own program.";
export const DEMO_SLUG = DEMO.slug;

/** Account changes better-auth handles itself: refused for the demo accounts (everything else is in safe()). */
const ACCOUNT_CHANGES =
  /^\/(update-user|change-email|change-password|set-password|delete-user|two-factor\/|link-social|unlink-account|revoke-|send-verification-email|request-password-reset|reset-password)/;

export function demoPlugin(): BetterAuthPlugin {
  return {
    id: "openpromoter-demo",
    endpoints: {
      demoSignIn: createAuthEndpoint(
        "/demo/sign-in",
        { method: "GET", query: z.object({ as: z.enum(["founder", "partner"]).optional() }) },
        async (ctx) => {
          if (!demoOn()) throw new APIError("NOT_FOUND");
          const email = ctx.query.as === "partner" ? DEMO.partnerEmail : DEMO.email;
          const [u] = await db().select().from(user).where(eq(user.email, email));
          if (!u)
            throw new APIError("NOT_FOUND", { message: "The demo is being rebuilt. Try again in a minute." });
          // a day, not the usual week: thousands of visitors shouldn't leave thousands of live sessions
          const session = await ctx.context.internalAdapter.createSession(u.id, true);
          await setSessionCookie(ctx, { session, user: u as never }, true);
          // the partner side opens on the program's own host when there is one (its free subdomain)
          const host = ctx.request?.headers.get("host") ?? "";
          const own = subdomainSlug(host) === DEMO.slug;
          throw ctx.redirect(
            ctx.query.as === "partner" ? (own ? "/portal" : `/p/${DEMO.slug}/portal`) : "/app",
          );
        },
      ),
    },
    hooks: {
      before: [
        {
          matcher: (ctx) => demoOn() && ACCOUNT_CHANGES.test(ctx.path ?? ""),
          handler: createAuthMiddleware(async (ctx) => {
            const s = await getSessionFromCtx(ctx).catch(() => null);
            if (isDemoUser(s?.user)) throw new APIError("FORBIDDEN", { message: DEMO_READ_ONLY });
          }),
        },
      ],
    },
    rateLimit: [{ pathMatcher: (p) => p.startsWith("/demo/"), window: 60, max: 10 }],
  };
}
