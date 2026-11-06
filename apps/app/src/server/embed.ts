import { hmacHex, safeEqual } from "@/lib/crypto";

const key = () => `${process.env.ENCRYPTION_KEY ?? process.env.BETTER_AUTH_SECRET}:embed`;

/** Short-lived token your backend mints so a signed-in customer sees their partner dashboard in your app. */
export function signEmbedToken(partnerId: string, ttlSeconds = 3600): string {
  const body = Buffer.from(
    JSON.stringify({ p: partnerId, exp: Math.floor(Date.now() / 1000) + ttlSeconds }),
  ).toString("base64url");
  return `${body}.${hmacHex(key(), body)}`;
}

export function verifyEmbedToken(token: string | null | undefined): string | null {
  const [body, sig] = (token ?? "").split(".");
  if (!body || !sig || !safeEqual(hmacHex(key(), body), sig)) return null;
  try {
    const v = JSON.parse(Buffer.from(body, "base64url").toString()) as { p: string; exp: number };
    return v.exp > Date.now() / 1000 ? v.p : null;
  } catch {
    return null;
  }
}
