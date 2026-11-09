import { headers } from "next/headers";
import { subdomainSlug } from "@/lib/subdomain";

type BaseProgram = { slug: string; customDomain: string | null; customDomainVerifiedAt: Date | null };

/**
 * Path prefix for a program's public pages. On the founder's own verified domain the program lives at the
 * root (partners.acme.com/apply), so the prefix is empty; on the app's host it is /p/acme.
 */
export async function programBase(p: BaseProgram) {
  const h = (await headers()).get("host") ?? "";
  const host = h.split(":")[0]?.toLowerCase();
  const own = (p.customDomainVerifiedAt && p.customDomain === host) || subdomainSlug(h) === p.slug;
  return own ? "" : `/p/${p.slug}`;
}

/** base + path, with "/" for the program home on its own domain. */
export const at = (base: string, path = "") => `${base}${path}` || "/";
