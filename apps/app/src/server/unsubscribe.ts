import { partner, reportSubscription } from "@openpromoter/db";
import { eq } from "drizzle-orm";
import { hmacHex, safeEqual } from "@/lib/crypto";
import { db } from "./db";
import { env } from "./env";

/**
 * One-click unsubscribe (RFC 8058) for the optional emails: commission notices and program messages to
 * partners, and the founder's report. A signed token names the email type and the row, so no sign-in is
 * needed and a token can't be forged or pointed at another person. Approvals, payouts and account emails
 * are transactional and always send.
 */
export type UnsubscribeKind = "commissions" | "messages" | "report";
const CODE: Record<UnsubscribeKind, string> = { commissions: "c", messages: "m", report: "r" };

const secret = () => {
  const s = process.env.ENCRYPTION_KEY ?? process.env.BETTER_AUTH_SECRET;
  if (!s) throw new Error("ENCRYPTION_KEY is not set");
  return `unsubscribe:${s}`;
};

export function unsubscribeToken(kind: UnsubscribeKind, id: string) {
  const payload = `${CODE[kind]}.${id}`;
  return `${payload}.${hmacHex(secret(), payload).slice(0, 32)}`;
}

export const unsubscribeUrl = (kind: UnsubscribeKind, id: string) =>
  `${env.APP_URL}/api/unsubscribe?t=${encodeURIComponent(unsubscribeToken(kind, id))}`;

export function readToken(token: string): { kind: UnsubscribeKind; id: string } | null {
  const [code, id, sig] = token.split(".");
  if (!code || !id || !sig) return null;
  if (!safeEqual(sig, hmacHex(secret(), `${code}.${id}`).slice(0, 32))) return null;
  const kind = (Object.keys(CODE) as UnsubscribeKind[]).find((k) => CODE[k] === code);
  return kind ? { kind, id } : null;
}

/** Turns the email type off. Returns what was turned off, for the confirmation page, or null. */
export async function applyUnsubscribe(token: string): Promise<string | null> {
  const t = readToken(token);
  if (!t) return null;
  if (t.kind === "report") {
    await db().delete(reportSubscription).where(eq(reportSubscription.id, t.id));
    return "the program report";
  }
  const set = t.kind === "commissions" ? { emailCommissions: false } : { emailMessages: false };
  const rows = await db().update(partner).set(set).where(eq(partner.id, t.id)).returning({ id: partner.id });
  if (!rows.length) return null;
  return t.kind === "commissions" ? "commission emails" : "program messages";
}
