import { billingConnection } from "@openpromoter/db";
import { and, eq } from "drizzle-orm";
import { decrypt } from "@/lib/crypto";
import { normalizeChargebee, verifyChargebee } from "@/server/billing/chargebee";
import { normalizeLemonSqueezy, verifyLemonSqueezy } from "@/server/billing/lemonsqueezy";
import { normalizePaddle, verifyPaddle } from "@/server/billing/paddle";
import { normalizePolar, verifyPolar } from "@/server/billing/polar";
import { verifyStripe } from "@/server/billing/stripe";
import { type ParsedWebhook, type Provider, WebhookSignatureError } from "@/server/billing/types";
import { db } from "@/server/db";
import { ingestAndAck, parseStripe, readCapped } from "@/server/webhook-ingest";

export const runtime = "nodejs";

const PROVIDERS = new Set<Provider>(["stripe", "paddle", "lemonsqueezy", "polar", "chargebee"]);

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
  const raw = await readCapped(req);
  if (raw === null) return Response.json({ error: "Payload too large" }, { status: 413 });
  const secret = decrypt(conn.webhookSecretEnc);
  let parsed: ParsedWebhook;
  try {
    if (provider === "stripe") {
      const evt = await verifyStripe(raw, req.headers.get("stripe-signature"), secret);
      parsed = await parseStripe(conn, evt);
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
  return ingestAndAck(conn, provider as Provider, parsed);
}
