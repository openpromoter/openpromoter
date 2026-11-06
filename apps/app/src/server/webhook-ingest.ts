import { billingConnection } from "@openpromoter/db";
import { and, eq, isNull, lt, or } from "drizzle-orm";
import type Stripe from "stripe";
import { decrypt } from "@/lib/crypto";
import { normalizeStripe, stripeClient } from "./billing/stripe";
import type { ParsedWebhook, Provider } from "./billing/types";
import { db } from "./db";
import { ingest } from "./ingest";

type Conn = typeof billingConnection.$inferSelect;

export const MAX_WEBHOOK_BODY = 2_000_000;

/** The raw body (signatures are over the exact bytes), or null past `max` bytes. */
export async function readCapped(req: Request, max = MAX_WEBHOOK_BODY): Promise<string | null> {
  if (Number(req.headers.get("content-length") ?? 0) > max) return null;
  const reader = req.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Normalizes a verified Stripe event, using the connection's key for the lookups an event can't carry. */
export function parseStripe(conn: Conn, evt: Stripe.Event) {
  const api = conn.secretEnc ? stripeClient(decrypt(conn.secretEnc)) : null;
  // lookups are best effort: a restricted key without the permission must not make every event fail
  const soft =
    <A, R>(fn: (a: A) => Promise<R>, empty: R) =>
    (a: A) =>
      fn(a).catch(() => empty);
  return normalizeStripe(evt, {
    promoCode: api
      ? soft(async (id: string) => (await api.promotionCodes.retrieve(id)).code, null)
      : undefined,
    invoiceCharges: api
      ? soft(async (id: string) => {
          const list = await api.invoicePayments.list({ invoice: id, limit: 5 });
          return list.data
            .flatMap((p) => [
              typeof p.payment?.charge === "string" ? p.payment.charge : null,
              typeof p.payment?.payment_intent === "string" ? p.payment.payment_intent : null,
            ])
            .filter((x): x is string => !!x);
        }, [] as string[])
      : undefined,
    invoicePromo: api
      ? soft(
          async (id: string) => {
            const inv = await api.invoices.retrieve(id, { expand: ["discounts"] });
            for (const d of inv.discounts ?? [])
              if (typeof d === "object" && "promotion_code" in d && d.promotion_code)
                return typeof d.promotion_code === "string" ? d.promotion_code : d.promotion_code.id;
            return null;
          },
          null as string | null,
        )
      : undefined,
  });
}

/** Ingests a parsed event for the connection's workspace and builds the provider's response. */
export async function ingestAndAck(conn: Conn, provider: Provider, parsed: ParsedWebhook) {
  const result = await ingest(conn.workspaceId, provider, parsed);
  // nothing was consumed; the provider retries (Stripe for up to three days) once a program exists
  if (result.effects[0] === "no program")
    return Response.json({ error: "Create a program first" }, { status: 503 });
  // at most one write a minute: a burst of events doesn't turn into a hot-row update per event
  await db()
    .update(billingConnection)
    .set({ lastEventAt: new Date() })
    .where(
      and(
        eq(billingConnection.id, conn.id),
        or(
          isNull(billingConnection.lastEventAt),
          lt(billingConnection.lastEventAt, new Date(Date.now() - 60_000)),
        ),
      ),
    );
  return Response.json({ received: true, duplicate: result.duplicate });
}
