/**
 * Free program subdomains: acme.openpromoter.com serves the program whose slug is "acme", for founders without
 * a custom domain. On only when PROGRAM_SUBDOMAINS names the parent domain (a wildcard DNS record must point
 * there first). No server imports: proxy.ts uses this too.
 */

/** Names a program can never take as its subdomain: our own hosts and the obvious impersonation bait. */
export const RESERVED_SUBDOMAINS = new Set(
  (
    "www app api admin dashboard docs doc help support status blog mail email smtp imap pop mx ns ns1 ns2 " +
    "ftp cdn static assets img images media files auth login signup account accounts billing pay payments " +
    "checkout secure security domains proxy-fallback mta-sts autodiscover autoconfig dev staging test demo " +
    "partners partner affiliates affiliate portal go link links r p openpromoter"
  ).split(" "),
);

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export const subdomainRoot = () =>
  process.env.PROGRAM_SUBDOMAINS?.trim().toLowerCase().replace(/^\.+/, "") || null;

/** A slug that can be used as a subdomain label at all. */
export const subdomainable = (slug: string) => LABEL.test(slug) && !RESERVED_SUBDOMAINS.has(slug);

/** "acme" for acme.openpromoter.com (port ignored), null for any other host. */
export function subdomainSlug(host: string): string | null {
  const root = subdomainRoot();
  const name = host.split(":")[0]!.toLowerCase();
  if (!root || !name.endsWith(`.${root}`)) return null;
  const label = name.slice(0, -root.length - 1);
  return subdomainable(label) ? label : null;
}

/** https://acme.openpromoter.com, with the app's own scheme and port (http://acme.localhost:3000 locally). */
export function subdomainOrigin(slug: string): string | null {
  const root = subdomainRoot();
  if (!root || !subdomainable(slug)) return null;
  const u = new URL(process.env.APP_URL ?? "http://localhost:3000");
  u.hostname = `${slug}.${root}`;
  return u.origin;
}
