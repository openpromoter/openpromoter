import { eventLog, webhookDelivery, webhookEndpoint } from "@openpromoter/db";
import { and, eq, sql } from "drizzle-orm";
import { hmacHex } from "@/lib/crypto";
import { createId } from "@/lib/id";
import { formatMoney } from "@/lib/money";
import { db } from "./db";
import { isHosted } from "./env";
import { enqueue } from "./jobs";
import { safeFetch } from "./safe-fetch";

export const EVENT_TYPES = [
  "partner.applied",
  "partner.approved",
  "referral.created",
  "commission.created",
  "commission.reversed",
  "payout.paid",
  "fraud.flagged",
  "autopilot.action",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** Fan out an event to every subscribed endpoint; delivery runs in the job queue with retries. */
export async function emitEvent(workspaceId: string, event: string, data: Record<string, unknown>) {
  // ids sort by time, so the API/CLI stream can page with ?after=
  await db()
    .insert(eventLog)
    .values({
      id: `evt_${Date.now().toString(36).padStart(9, "0")}${createId("job").slice(4, 12)}`,
      workspaceId,
      type: event,
      data,
    });
  const endpoints = await db()
    .select()
    .from(webhookEndpoint)
    .where(
      and(
        eq(webhookEndpoint.workspaceId, workspaceId),
        eq(webhookEndpoint.enabled, true),
        sql`(${event} = any(${webhookEndpoint.events}) or '*' = any(${webhookEndpoint.events}))`,
      ),
    );
  for (const ep of endpoints) {
    const id = createId("whd");
    const payload = { id, type: event, created: Math.floor(Date.now() / 1000), data };
    await db().insert(webhookDelivery).values({ id, endpointId: ep.id, event, payload });
    // 14 tries with 30 s doubling backoff (capped at 6 h) spread over about a day, as the docs say
    await enqueue("webhook.deliver", { deliveryId: id }, { maxAttempts: 14 });
  }
  return endpoints.length;
}

/** Signature: OpenPromoter-Signature: t=<unix>,v1=<hex hmac-sha256(secret, `${t}.${body}`)> */
export function signPayload(secret: string, body: string, t = Math.floor(Date.now() / 1000)) {
  return `t=${t},v1=${hmacHex(secret, `${t}.${body}`)}`;
}

function chatText(event: string, data: Record<string, any>): string {
  const money = typeof data.amount === "number" ? formatMoney(data.amount, data.currency ?? "usd") : "";
  switch (event) {
    case "commission.created":
      return `💸 New commission ${money} (${data.status})`;
    case "payout.paid":
      return `✅ Payout sent: ${money} via ${data.method}`;
    case "partner.applied":
      return `👋 New partner application: ${data.name ?? data.email ?? ""}`;
    case "partner.approved":
      return `🤝 Partner approved: ${data.name ?? data.email ?? ""}`;
    case "fraud.flagged":
      return `🛡️ Fraud check flagged a partner (score ${data.score}): ${data.detail ?? ""}`;
    case "referral.created":
      return `🎯 New referral via ${data.via}`;
    case "commission.reversed":
      return "↩️ A commission was reversed after a refund";
    default:
      return `${event}: ${data.title ?? ""}`;
  }
}

export async function deliver(deliveryId: string) {
  const [row] = await db()
    .select({ d: webhookDelivery, ep: webhookEndpoint })
    .from(webhookDelivery)
    .innerJoin(webhookEndpoint, eq(webhookEndpoint.id, webhookDelivery.endpointId))
    .where(eq(webhookDelivery.id, deliveryId));
  if (!row || row.d.status === "succeeded") return;
  const { d, ep } = row;
  const body =
    ep.kind === "slack"
      ? JSON.stringify({ text: chatText(d.event, d.payload.data as Record<string, unknown>) })
      : ep.kind === "discord"
        ? JSON.stringify({ content: chatText(d.event, d.payload.data as Record<string, unknown>) })
        : JSON.stringify(d.payload);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "OpenPromoter-Webhooks/1",
  };
  if (ep.kind === "webhook") {
    headers["OpenPromoter-Signature"] = signPayload(ep.secret, body);
    headers["OpenPromoter-Event"] = d.event;
    headers["OpenPromoter-Delivery"] = d.id;
  }
  let status = 0;
  let error: string | null = null;
  try {
    if (isHosted()) {
      // cloud: tenants' URLs are untrusted, so the address is checked at connect time (no DNS rebinding)
      const res = await safeFetch(ep.url, {
        method: "POST",
        headers,
        body,
        timeoutMs: 10_000,
        maxBytes: 64_000,
        maxRedirects: 0,
      });
      status = res.status;
    } else {
      const res = await fetch(ep.url, {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(10_000),
        redirect: "manual",
      });
      status = res.status;
    }
    if (status < 200 || status >= 300) error = `HTTP ${status}`;
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  const attempts = d.attempts + 1;
  await db()
    .update(webhookDelivery)
    .set({
      attempts,
      responseStatus: status || null,
      lastError: error,
      status: error ? (attempts >= 8 ? "failed" : "pending") : "succeeded",
    })
    .where(eq(webhookDelivery.id, d.id));
  if (error) throw new Error(error); // job queue retries with backoff
}
