import { program } from "@openpromoter/db";
import { and, eq, isNotNull } from "drizzle-orm";
import { subdomainSlug } from "@/lib/subdomain";
import { isAppHost } from "./captcha";
import { db } from "./db";

/**
 * The program a partner is signing in to, so sign-in can wear its brand: the one named in `next`
 * (/p/acme/portal) or, on a founder's verified custom domain, the program behind that domain.
 * null on the app's own sign-in for founders.
 */
export async function partnerProgram(next: string, h: Headers) {
  const slug = /^\/p\/([\w-]{1,80})(?:\/|$)/.exec(next)?.[1];
  if (slug) return (await db().select().from(program).where(eq(program.slug, slug)))[0] ?? null;
  if (isAppHost(h)) return null;
  const sub = subdomainSlug(h.get("host") ?? "");
  if (sub) return (await db().select().from(program).where(eq(program.slug, sub)))[0] ?? null;
  const host = h.get("host")?.split(":")[0]?.toLowerCase() ?? "";
  if (!/^[a-z0-9.-]{1,253}$/.test(host)) return null;
  const [p] = await db()
    .select()
    .from(program)
    .where(and(eq(program.customDomain, host), isNotNull(program.customDomainVerifiedAt)));
  return p ?? null;
}
