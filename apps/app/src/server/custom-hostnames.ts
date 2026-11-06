import { env } from "@/server/env";

/**
 * Cloudflare for SaaS custom hostnames: Cloudflare issues and renews the TLS certificate for each
 * founder's domain (partners.acme.com). Off unless CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID are set;
 * self-hosters keep plain CNAME checks and their own proxy's certificates.
 */
export const cloudflareOn = () => !!(env.CLOUDFLARE_API_TOKEN && env.CLOUDFLARE_ZONE_ID);

/** What founders point their CNAME at. */
export const cnameTarget = () => env.CUSTOM_DOMAIN_TARGET || new URL(env.APP_URL).hostname;

type Hostname = { id: string; hostname: string; status: string; ssl?: { status?: string } };

async function cf<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/zones/${env.CLOUDFLARE_ZONE_ID}/custom_hostnames${path}`,
    {
      ...init,
      headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(15_000),
    },
  ).catch(() => null);
  const body = (await res?.json().catch(() => null)) as {
    success?: boolean;
    result?: T;
    errors?: { message?: string }[];
  } | null;
  if (!res?.ok || !body?.success) {
    // Cloudflare's own message (e.g. "Duplicate custom hostname found") is safe to show; the token never is.
    const msg = body?.errors?.[0]?.message;
    throw new Error(msg ? `Cloudflare: ${msg}` : "Couldn't reach Cloudflare. Try again in a minute.");
  }
  return body.result as T;
}

export async function findHostname(hostname: string): Promise<Hostname | null> {
  const list = await cf<Hostname[]>(`?hostname=${encodeURIComponent(hostname)}`);
  return list.find((h) => h.hostname === hostname) ?? null;
}

export async function addHostname(hostname: string): Promise<Hostname> {
  return (
    (await findHostname(hostname)) ??
    cf<Hostname>("", {
      method: "POST",
      body: JSON.stringify({ hostname, ssl: { method: "http", type: "dv" } }),
    })
  );
}

export async function removeHostname(hostname: string): Promise<void> {
  const h = await findHostname(hostname);
  if (h) await cf(`/${h.id}`, { method: "DELETE" });
}

/** null when the domain serves HTTPS, otherwise a line telling the founder what Cloudflare is waiting on. */
export async function hostnameProblem(hostname: string): Promise<string | null> {
  const h = await findHostname(hostname);
  if (!h) return "This domain isn't registered yet. Save it again.";
  if (h.status === "active" && h.ssl?.status === "active") return null;
  if (h.status !== "active")
    return `Waiting for DNS. Add a CNAME from ${hostname} to ${cnameTarget()}. DNS can take a few minutes.`;
  return "DNS is set. Cloudflare is issuing the certificate. This usually takes a few minutes.";
}
