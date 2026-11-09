import { headers } from "next/headers";

type BaseProgram = { slug: string; customDomain: string | null; customDomainVerifiedAt: Date | null };

/**
 * Path prefix for a program's public pages. On the founder's own verified domain the program lives at the
 * root (partners.acme.com/apply), so the prefix is empty; on the app's host it is /p/acme.
 */
export async function programBase(p: BaseProgram) {
  const host = (await headers()).get("host")?.split(":")[0]?.toLowerCase();
  return p.customDomainVerifiedAt && p.customDomain === host ? "" : `/p/${p.slug}`;
}

/** base + path, with "/" for the program home on its own domain. */
export const at = (base: string, path = "") => `${base}${path}` || "/";
