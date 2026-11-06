import { billingConnection } from "@openpromoter/db";
import { and, eq } from "drizzle-orm";
import { verifyStripe } from "@/server/billing/stripe";
import { WebhookSignatureError } from "@/server/billing/types";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { ingestAndAck, parseStripe, readCapped } from "@/server/webhook-ingest";

export const runtime = "nodejs";

/**
 * One Connect webhook on the platform account carries the events of every founder who connected with
 * "Connect with Stripe". Stripe doesn't let a platform create webhooks on a connected account, so the
 * event's `account` picks the workspace.
 */
export async function POST(req: Request) {
  if (!env.STRIPE_CONNECT_WEBHOOK_SECRET) return Response.json({ error: "Not configured" }, { status: 404 });
  const raw = await readCapped(req);
  if (raw === null) return Response.json({ error: "Payload too large" }, { status: 413 });
  let evt: Awaited<ReturnType<typeof verifyStripe>>;
  try {
    evt = await verifyStripe(raw, req.headers.get("stripe-signature"), env.STRIPE_CONNECT_WEBHOOK_SECRET);
  } catch (err) {
    if (err instanceof WebhookSignatureError)
      return Response.json({ error: "Invalid signature" }, { status: 400 });
    throw err;
  }
  if (!evt.account) return Response.json({ received: true, ignored: "not a connected account event" });
  const [conn] = await db()
    .select()
    .from(billingConnection)
    .where(
      and(
        eq(billingConnection.provider, "stripe"),
        eq(billingConnection.mode, "oauth"),
        eq(billingConnection.accountId, evt.account),
      ),
    );
  // an account that disconnected, or a Connect account of another product on the same platform
  if (!conn) return Response.json({ received: true, ignored: "unknown account" });
  return ingestAndAck(conn, "stripe", await parseStripe(conn, evt));
}
