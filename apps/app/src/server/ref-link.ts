import { env } from "./env";

type LinkProgram = { slug: string; customDomain: string | null; customDomainVerifiedAt: Date | null };

/** The founder's verified custom domain as an origin (https://partners.acme.com), or null. */
export const domainOrigin = (p: LinkProgram) =>
  p.customDomain && p.customDomainVerifiedAt ? `https://${p.customDomain}` : null;

/** A partner's tracked link. On a verified custom domain it is the short branded form: partners.acme.com/maya1. */
export const linkUrl = (p: LinkProgram, key: string) => {
  const d = domainOrigin(p);
  return d ? `${d}/${key}` : `${env.APP_URL}/r/${p.slug}/l/${key}`;
};

/** A partner's code link (/r/slug/code), served from the custom domain when there is one. */
export const codeUrl = (p: LinkProgram, code: string) =>
  `${domainOrigin(p) ?? env.APP_URL}/r/${p.slug}/${code}`;
