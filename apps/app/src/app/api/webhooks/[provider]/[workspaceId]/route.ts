import { billingConnection } from "@openpromoter/db";
import { and, eq, isNull, lt, or } from "drizzle-orm";
import { decrypt } from "@/lib/crypto";
import { normalizeChargebee, verifyChargebee } from "@/server/billing/chargebee";
import { normalizeLemonSqueezy, verifyLemonSqueezy } from "@/server/billing/lemonsqueezy";
import { normalizePaddle, verifyPaddle } from "@/server/billing/paddle";
import { normalizePolar, verifyPolar } from "@/server/billing/polar";
import { normalizeStripe, stripeClient, verifyStripe } from "@/server/billing/stripe";
import { type ParsedWebhook, type Provider, WebhookSignatureError } from "@/server/billing/types";
import { db } from "@/server/db";
import { ingest } from "@/server/ingest";

export const runtime = "nodejs";

const PROVIDERS = new Set<Provider>(["stripe", "paddle", "lemonsqueezy", "polar", "chargebee"]);
const MAX_BODY = 2_000_000;

/** The raw body (signatures are over the exact bytes), or null past `max` bytes. */
async function readCapped(req: Request, max: number): Promise<string | null> {
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

export async function POST(
  req: Request,
  { params }: { params: Promise<{ provider: string; workspaceId: string }> },
) {
  const { provider, workspaceId } = await params;
  if (!PROVIDERS.has(provider as Provider))
    return Response.json({ error: "Unknown provider" }, { status: 404 });
  const [conn] = await db()
    .select()
    .from(billingConnection)
    .where(
      and(
        eq(billingConnection.workspaceId, workspaceId),
        eq(billingConnection.provider, provider as "stripe"),
      ),
    );
  if (!conn?.webhookSecretEnc) return Response.json({ error: "Not configured" }, { status: 404 });
  // provider events are well under this; the cap stops a forged request from buffering an unbounded body
  const raw = await readCapped(req, MAX_BODY);
  if (raw === null) return Response.json({ error: "Payload too large" }, { status: 413 });
  const secret = decrypt(conn.webhookSecretEnc);
  let parsed: ParsedWebhook;
  try {
    if (provider === "stripe") {
      const evt = await verifyStripe(raw, req.headers.get("stripe-signature"), secret);
      const api = conn.secretEnc ? stripeClient(decrypt(conn.secretEnc)) : null;
      // lookups are best effort: a restricted key without the permission must not make every event fail
      const soft =
        <A, R>(fn: (a: A) => Promise<R>, empty: R) =>
        (a: A) =>
          fn(a).catch(() => empty);
      parsed = await normalizeStripe(evt, {
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
    } else if (provider === "paddle")
      parsed = normalizePaddle(verifyPaddle(raw, req.headers.get("paddle-signature"), secret), conn.livemode);
    else if (provider === "chargebee")
      parsed = normalizeChargebee(
        verifyChargebee(raw, req.headers.get("authorization"), secret),
        conn.livemode,
      );
    else if (provider === "lemonsqueezy")
      parsed = normalizeLemonSqueezy(verifyLemonSqueezy(raw, req.headers.get("x-signature"), secret));
    else
      parsed = normalizePolar(
        verifyPolar(
          raw,
          {
            id: req.headers.get("webhook-id"),
            timestamp: req.headers.get("webhook-timestamp"),
            signature: req.headers.get("webhook-signature"),
          },
          secret,
        ),
        conn.livemode,
      );
  } catch (err) {
    if (err instanceof WebhookSignatureError)
      return Response.json({ error: "Invalid signature" }, { status: 400 });
    throw err;
  }
  const result = await ingest(workspaceId, provider as Provider, parsed);
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
