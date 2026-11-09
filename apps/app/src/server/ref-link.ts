import { subdomainOrigin } from "@/lib/subdomain";
import { env } from "./env";

type LinkProgram = { slug: string; customDomain: string | null; customDomainVerifiedAt: Date | null };

/**
 * Where the program lives on its own host: the founder's verified custom domain (https://partners.acme.com),
 * else its free subdomain (https://acme.openpromoter.com) when those are on, else null (the app's /p/slug).
 */
export const domainOrigin = (p: LinkProgram) =>
  p.customDomain && p.customDomainVerifiedAt ? `https://${p.customDomain}` : subdomainOrigin(p.slug);

/** A partner's tracked link. On a verified custom domain it is the short branded form: partners.acme.com/maya1. */
export const linkUrl = (p: LinkProgram, key: string) => {
  const d = domainOrigin(p);
  return d ? `${d}/${key}` : `${env.APP_URL}/r/${p.slug}/l/${key}`;
};

/** A partner's code link (/r/slug/code), served from the custom domain when there is one. */
export const codeUrl = (p: LinkProgram, code: string) =>
  `${domainOrigin(p) ?? env.APP_URL}/r/${p.slug}/${code}`;

/** A program page (program, /apply, /portal...): at the root of its verified domain, else /p/slug on the app host. */
export const programUrl = (p: LinkProgram, path = "") => {
  const d = domainOrigin(p);
  return d ? `${d}${path || "/"}` : `${env.APP_URL}/p/${p.slug}${path}`;
};
