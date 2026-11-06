import { billingConnection, commission, partner, payout, program } from "@openpromoter/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { decrypt, sha256 } from "@/lib/crypto";
import { createId } from "@/lib/id";
import { toMajor } from "@/lib/money";
import { nec1099Threshold } from "@/lib/tax";
import { type Actor, audit } from "./audit";
import { stripeClient } from "./billing/stripe";
import { db } from "./db";
import { enqueue } from "./jobs";
import { payableBalances, unpaidApproved } from "./ledger";

type Payout = typeof payout.$inferSelect;
type Partner = typeof partner.$inferSelect;
export type PayoutMethod = Payout["method"];

export class PayoutError extends Error {}

/**
 * Step 1: create payouts for everyone owed at least the minimum. They wait for a human.
 * AI, API keys and MCP can call this; only a signed-in owner/admin/finance user can approve.
 */
export async function createPayoutBatch(
  programId: string,
  actor: Actor,
  partnerIds?: string[],
): Promise<Payout[]> {
  // one batch at a time per program: two clicks or an API call racing the scheduler can't double the queue
  const { prog, created } = await db().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${programId}))`);
    const [prog] = await tx.select().from(program).where(eq(program.id, programId));
    if (!prog) throw new PayoutError("Program not found");
    const owed = (await payableBalances(programId, tx)).filter(
      (b) => !partnerIds || partnerIds.includes(b.partnerId),
    );
    if (owed.length === 0) return { prog, created: [] as Payout[] };
    const partners = await tx
      .select()
      .from(partner)
      .where(
        inArray(
          partner.id,
          owed.map((o) => o.partnerId),
        ),
      );
    const byId = new Map(partners.map((p) => [p.id, p]));
    const created: Payout[] = [];
    for (const b of owed) {
      const p = byId.get(b.partnerId);
      if (!p || p.status === "banned") continue;
      const [row] = await tx
        .insert(payout)
        .values({
          id: createId("pay"),
          programId,
          workspaceId: prog.workspaceId,
          partnerId: p.id,
          amount: b.approved,
          currency: b.currency,
          test: b.test,
          // a test payout never reaches Stripe, PayPal or Wise: it is marked paid by hand
          method: b.test ? "manual" : (p.payoutMethod ?? "manual"),
          status: "awaiting_approval",
          requestedBy: `${actor.type}:${actor.id ?? "system"}`,
        })
        .returning();
      if (row) created.push(row);
    }
    return { prog, created };
  });
  if (created.length)
    await audit(prog.workspaceId, actor, "payout.batch_created", undefined, {
      count: created.length,
      total: created.reduce((a, p) => a + p.amount, 0),
    });
  return created;
}

/** Step 2 (human only): approve and send. Commissions are locked to the payout before money moves. */
export async function approvePayouts(
  programId: string,
  ids: string[],
  actor: Actor,
  opts: { limit?: number } = {},
): Promise<{ id: string; status: string; error?: string }[]> {
  if (actor.type !== "user") throw new PayoutError("Only a signed-in team member can approve payouts");
  let spent = 0;
  const rows = await db()
    .select()
    .from(payout)
    .where(
      and(eq(payout.programId, programId), inArray(payout.id, ids), eq(payout.status, "awaiting_approval")),
    );
  const results: { id: string; status: string; error?: string }[] = [];
  for (const po of rows) {
    const locked = await db().transaction(async (tx) => {
      const claimed = await tx
        .update(payout)
        .set({ status: "processing", approvedBy: actor.id, approvedAt: new Date() })
        .where(and(eq(payout.id, po.id), eq(payout.status, "awaiting_approval")))
        .returning();
      if (!claimed[0]) return null;
      const lines = await tx
        .update(commission)
        .set({ payoutId: po.id, updatedAt: new Date() })
        .where(unpaidApproved(programId, po.partnerId, po.currency, po.test))
        .returning({ amount: commission.amount });
      const total = lines.reduce((a, l) => a + l.amount, 0);
      if (total <= 0) {
        await tx.update(commission).set({ payoutId: null }).where(eq(commission.payoutId, po.id));
        await tx
          .update(payout)
          .set({ status: "canceled", failureReason: "Nothing left to pay" })
          .where(eq(payout.id, po.id));
        return null;
      }
      // without two-factor the caller passes a limit; amounts can grow between batch and approval
      if (opts.limit !== undefined && spent + total > opts.limit) throw new PayoutError("2FA_CODE_REQUIRED");
      spent += total;
      // a row lock on the program makes the number unique and gap-free across concurrent approvals
      const [seq] = await tx
        .update(program)
        .set({ payoutSeq: sql`${program.payoutSeq} + 1` })
        .where(eq(program.id, programId))
        .returning({ n: program.payoutSeq });
      const [updated] = await tx
        .update(payout)
        .set({ amount: total, invoiceNumber: `OP-${String(seq?.n ?? 1).padStart(5, "0")}` })
        .where(eq(payout.id, po.id))
        .returning();
      return updated!;
    });
    if (!locked) {
      results.push({ id: po.id, status: "canceled" });
      continue;
    }
    await audit(
      locked.workspaceId,
      actor,
      "payout.approve",
      { type: "payout", id: locked.id },
      { amount: locked.amount, currency: locked.currency, method: locked.method },
    );
    results.push(await sendPayout(locked));
  }
  return results;
}

/** Mark a manual payout as paid outside OpenPromoter (bank transfer, etc). */
export async function markPaid(programId: string, id: string, actor: Actor, reference?: string) {
  if (actor.type !== "user") throw new PayoutError("Only a signed-in team member can mark payouts paid");
  const [po] = await db()
    .select()
    .from(payout)
    .where(and(eq(payout.id, id), eq(payout.programId, programId)));
  if (po?.status !== "processing") throw new PayoutError("Payout is not processing");
  await settle(po, reference ?? "manual");
  await audit(po.workspaceId, actor, "payout.mark_paid", { type: "payout", id }, { reference });
}

export async function cancelPayout(programId: string, id: string, actor: Actor) {
  const [po] = await db()
    .update(payout)
    .set({ status: "canceled" })
    .where(and(eq(payout.id, id), eq(payout.programId, programId), eq(payout.status, "awaiting_approval")))
    .returning();
  if (po) await audit(po.workspaceId, actor, "payout.cancel", { type: "payout", id });
  return !!po;
}

async function settle(po: Payout, externalId: string) {
  await db().transaction(async (tx) => {
    const [won] = await tx
      .update(payout)
      .set({ status: "paid", paidAt: new Date(), externalId, failureReason: null })
      .where(and(eq(payout.id, po.id), eq(payout.status, "processing")))
      .returning({ id: payout.id });
    if (!won) return; // settled or failed by another run
    await tx
      .update(commission)
      .set({ status: "paid", updatedAt: new Date() })
      .where(and(eq(commission.payoutId, po.id), eq(commission.status, "approved")));
    await enqueue(
      "events.emit",
      {
        workspaceId: po.workspaceId,
        event: "payout.paid",
        data: {
          id: po.id,
          partnerId: po.partnerId,
          amount: po.amount,
          currency: po.currency,
          method: po.method,
        },
      },
      {},
      tx,
    );
    await enqueue("notify.payout", { payoutId: po.id }, {}, tx);
  });
}

async function fail(po: Payout, reason: string) {
  await db().transaction(async (tx) => {
    const [lost] = await tx
      .update(payout)
      .set({ status: "failed", failureReason: reason.slice(0, 500) })
      .where(and(eq(payout.id, po.id), eq(payout.status, "processing")))
      .returning({ id: payout.id });
    if (!lost) return;
    await tx
      .update(commission)
      .set({ payoutId: null, updatedAt: new Date() })
      .where(eq(commission.payoutId, po.id));
  });
}

async function connection(workspaceId: string, provider: "stripe" | "paypal" | "wise") {
  const [c] = await db()
    .select()
    .from(billingConnection)
    .where(and(eq(billingConnection.workspaceId, workspaceId), eq(billingConnection.provider, provider)));
  if (!c?.secretEnc) throw new PayoutError(`${provider} is not connected`);
  return { ...c, secret: decrypt(c.secretEnc) };
}

/** US partners paid outside Stripe need a W-9 with a TIN before crossing the 1099-NEC threshold. */
async function assertTaxReady(po: Payout, p: Partner) {
  if (po.method === "stripe") return; // Stripe Connect collects tax details during onboarding
  const us =
    (p.country ?? "US").toUpperCase() === "US" && p.taxFormType !== "w8ben" && p.taxFormType !== "w8bene";
  if (!us || p.taxIdEnc || po.currency.toLowerCase() !== "usd") return;
  const year = new Date().getUTCFullYear();
  const [row] = await db()
    .select({ n: sql<number>`coalesce(sum(${payout.amount}),0)::int` })
    .from(payout)
    .where(
      and(
        eq(payout.partnerId, p.id),
        eq(payout.status, "paid"),
        eq(payout.currency, "usd"),
        sql`${payout.paidAt} >= ${new Date(Date.UTC(year, 0, 1)).toISOString()}::timestamptz`,
      ),
    );
  if ((row?.n ?? 0) + po.amount >= nec1099Threshold(year)) {
    throw new PayoutError(
      "This partner needs to submit a W-9 (with SSN/EIN) in their portal before they can be paid more this year",
    );
  }
}

/**
 * The provider took the request but the money has not landed (PayPal, Wise), or we cannot tell whether it
 * moved (timeout, 5xx, a crash after the call). The payout stays `processing` with its commissions locked,
 * and `reconcilePayouts` asks the provider later. Only a PayoutError, a definite "no money moved", fails it.
 */
type Sent = { ref: string; done: boolean; note?: string };

async function sendPayout(po: Payout): Promise<{ id: string; status: string; error?: string }> {
  const [p] = await db().select().from(partner).where(eq(partner.id, po.partnerId));
  try {
    if (!p) throw new PayoutError("Partner not found");
    await assertTaxReady(po, p);
    if (po.method === "manual") return { id: po.id, status: "processing" };
    const r = await PROVIDERS[po.method](po, p);
    if (r.done) {
      await settle(po, r.ref);
      return { id: po.id, status: "paid" };
    }
    await markSent(po, r.ref, r.note);
    return { id: po.id, status: "processing" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (err instanceof PayoutError) {
      await fail(po, msg);
      return { id: po.id, status: "failed", error: msg };
    }
    await db()
      .update(payout)
      .set({ failureReason: `Checking with ${po.method}: ${msg}`.slice(0, 500) })
      .where(eq(payout.id, po.id));
    return { id: po.id, status: "processing", error: msg };
  }
}

async function markSent(po: Payout, ref: string, note?: string) {
  await db()
    .update(payout)
    .set({ externalId: ref, failureReason: note ?? null })
    .where(and(eq(payout.id, po.id), eq(payout.status, "processing")));
}

/** fetch that sorts failures: 4xx is a definite no (PayoutError), network errors, 429 and 5xx are unsure. */
async function call(url: string, init: RequestInit, label: string) {
  const res = await fetch(url, { ...init, signal: init.signal ?? AbortSignal.timeout(30_000) });
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {}
  if (res.ok) return { res, body };
  const detail = String(
    body.message ??
      body.error_description ??
      body.name ??
      (body.errors as { message?: string }[])?.[0]?.message ??
      "",
  );
  if (res.status >= 500 || res.status === 429) throw new Error(`${label} returned ${res.status} ${detail}`);
  const e = new PayoutError(`${label} failed (${res.status}) ${detail}`.trim());
  (e as PayoutError & { status?: number; body?: unknown }).status = res.status;
  (e as PayoutError & { body?: unknown }).body = body;
  throw e;
}

/** Currencies PayPal Payouts accepts; HUF, JPY and TWD take whole units only. */
const PAYPAL = new Set(
  "AUD BRL CAD CNY CZK DKK EUR HKD HUF ILS JPY MYR MXN TWD NZD NOK PHP PLN GBP SGD SEK CHF THB USD".split(
    " ",
  ),
);
const PAYPAL_WHOLE = new Set(["HUF", "JPY", "TWD"]);

function paypalAmount(po: Payout) {
  const c = po.currency.toUpperCase();
  if (!PAYPAL.has(c)) throw new PayoutError(`PayPal does not pay out in ${c}`);
  const v = toMajor(po.amount, po.currency);
  if (PAYPAL_WHOLE.has(c) && !/^\d+(\.0+)?$/.test(v))
    throw new PayoutError(`PayPal pays ${c} in whole units only; this payout is ${v} ${c}`);
  return { value: PAYPAL_WHOLE.has(c) ? String(Math.round(Number(v))) : v, currency: c };
}

async function paypalAuth(po: Payout) {
  const conn = await connection(po.workspaceId, "paypal");
  const cfg = JSON.parse(conn.secret) as { clientId: string; clientSecret: string; sandbox?: boolean };
  const base = cfg.sandbox ? "https://api-m.sandbox.paypal.com" : "https://api-m.paypal.com";
  const { body } = await call(
    `${base}/v1/oauth2/token`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    },
    "PayPal sign-in",
  );
  return {
    base,
    headers: { Authorization: `Bearer ${body.access_token}`, "Content-Type": "application/json" },
  };
}

async function wiseAuth(po: Payout) {
  const conn = await connection(po.workspaceId, "wise");
  const cfg = JSON.parse(conn.secret) as {
    token: string;
    profileId: string;
    sandbox?: boolean;
    sourceCurrency?: string;
  };
  const base = cfg.sandbox ? "https://api.wise-sandbox.com" : "https://api.wise.com";
  const headers = { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" };
  const post = async (path: string, body: unknown) =>
    (await call(`${base}${path}`, { method: "POST", headers, body: JSON.stringify(body) }, `Wise ${path}`))
      .body;
  return { cfg, base, headers, post };
}

const PROVIDERS: Record<Exclude<PayoutMethod, "manual">, (po: Payout, p: Partner) => Promise<Sent>> = {
  async stripe(po, p) {
    if (!p.stripeAccountId || !p.stripePayoutsEnabled)
      throw new PayoutError("Partner has not finished Stripe onboarding");
    const conn = await connection(po.workspaceId, "stripe");
    try {
      const t = await stripeClient(conn.secret).transfers.create(
        {
          amount: po.amount,
          currency: po.currency,
          destination: p.stripeAccountId,
          description: `Commission payout ${po.invoiceNumber}`,
          metadata: { openpromoter_payout: po.id },
        },
        // a retry with the same key within 24 hours returns the first transfer instead of a second one
        { idempotencyKey: `op-payout-${po.id}` },
      );
      return { ref: t.id, done: true };
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code && code < 500 && code !== 429) throw new PayoutError((e as Error).message);
      throw e;
    }
  },

  async paypal(po, p) {
    if (!p.paypalEmail) throw new PayoutError("Partner has no PayPal email");
    const amount = paypalAmount(po);
    const { base, headers } = await paypalAuth(po);
    try {
      // sender_batch_id is PayPal's idempotency key: a resend with the same id never pays twice
      const { body } = await call(
        `${base}/v1/payments/payouts`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            sender_batch_header: {
              sender_batch_id: po.id,
              email_subject: "You have a commission payout",
              email_message: "Thanks for promoting us.",
            },
            items: [{ recipient_type: "EMAIL", receiver: p.paypalEmail, amount, sender_item_id: po.id }],
          }),
        },
        "PayPal payout",
      );
      const id = (body.batch_header as { payout_batch_id?: string } | undefined)?.payout_batch_id;
      if (!id) throw new Error("PayPal accepted the payout but sent no batch id");
      // the batch starts PENDING; reconcilePayouts settles it when the item reaches SUCCESS
      return { ref: id, done: false };
    } catch (e) {
      // the batch already exists from an earlier try: PayPal links to it instead of paying again
      const raw = JSON.stringify((e as { body?: unknown }).body ?? "");
      if (e instanceof PayoutError && /SENDER_BATCH_ID|DUPLICATE/i.test(raw)) {
        const id = raw.match(/\/v1\/payments\/payouts\/([A-Z0-9]+)/)?.[1];
        if (id) return { ref: id, done: false };
        throw new Error(`PayPal says payout ${po.id} was already sent; check the PayPal dashboard`);
      }
      throw e;
    }
  },

  async wise(po, p) {
    if (!p.wiseEmail) throw new PayoutError("Partner has no Wise email");
    const { cfg, base, headers, post } = await wiseAuth(po);
    const currency = po.currency.toUpperCase();
    const recipient = await post("/v1/accounts", {
      profile: Number(cfg.profileId),
      accountHolderName: p.name,
      currency,
      type: "email",
      details: { email: p.wiseEmail },
    });
    const quote = await post(`/v3/profiles/${cfg.profileId}/quotes`, {
      sourceCurrency: cfg.sourceCurrency?.toUpperCase() || currency,
      targetCurrency: currency,
      targetAmount: Number(toMajor(po.amount, po.currency)),
      targetAccount: recipient.id,
    });
    // customerTransactionId is Wise's idempotency key; deterministic per payout
    const h = sha256(po.id);
    const uuid = `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
    const transfer = await post("/v1/transfers", {
      targetAccount: recipient.id,
      quoteUuid: quote.id,
      customerTransactionId: uuid,
      details: { reference: po.invoiceNumber ?? "Commission" },
    });
    const ref = String(transfer.id);
    // keep the transfer id before funding, so a failed funding step never leaves an unknown transfer behind
    await markSent(po, ref);
    try {
      const fund = await post(`/v3/profiles/${cfg.profileId}/transfers/${ref}/payments`, { type: "BALANCE" });
      if (fund.status !== "COMPLETED")
        throw new PayoutError(`Wise could not fund it: ${fund.errorCode ?? fund.status}`);
    } catch (e) {
      if (!(e instanceof PayoutError)) throw e;
      if ((e as { status?: number }).status === 403)
        // UK and EEA profiles need strong customer authentication to fund through the API
        return { ref, done: false, note: `Fund Wise transfer ${ref} in the Wise app to send it` };
      await call(`${base}/v1/transfers/${ref}/cancel`, { method: "PUT", headers }, "Wise cancel").catch(
        () => {},
      );
      throw e;
    }
    // funded; reconcilePayouts settles it once Wise reports outgoing_payment_sent
    return { ref, done: false };
  },
};

const PAYPAL_FAILED = new Set(["FAILED", "RETURNED", "BLOCKED", "REFUNDED", "REVERSED", "DENIED"]);
const WISE_FAILED = new Set(["cancelled", "funds_refunded", "bounced_back", "charged_back"]);

/** Ask the provider about one payout that is still processing. Returns what happened. */
async function reconcile(po: Payout): Promise<string> {
  const [p] = await db().select().from(partner).where(eq(partner.id, po.partnerId));
  if (!p) return "no partner";
  if (po.method === "stripe") {
    const conn = await connection(po.workspaceId, "stripe");
    const since = Math.floor(((po.approvedAt ?? po.createdAt).getTime() - 3_600_000) / 1000);
    if (p.stripeAccountId)
      for await (const t of stripeClient(conn.secret).transfers.list({
        destination: p.stripeAccountId,
        created: { gte: since },
        limit: 100,
      }))
        if (t.metadata?.openpromoter_payout === po.id) {
          await settle(po, t.id);
          return "paid";
        }
    // not at Stripe: resend inside the 24 hour idempotency window, otherwise nothing was sent
    if (Date.now() - (po.approvedAt ?? po.createdAt).getTime() < 23 * 3_600_000) {
      const r = await sendPayout(po);
      return r.status;
    }
    await fail(po, "Stripe has no transfer for this payout");
    return "failed";
  }
  if (!po.externalId) return (await sendPayout(po)).status; // the first call never got an answer
  if (po.method === "paypal") {
    const { base, headers } = await paypalAuth(po);
    const { body } = await call(`${base}/v1/payments/payouts/${po.externalId}`, { headers }, "PayPal status");
    const batch = (body.batch_header as { batch_status?: string } | undefined)?.batch_status ?? "";
    const item = (
      body.items as { transaction_status?: string; errors?: { message?: string } }[] | undefined
    )?.[0];
    const st = item?.transaction_status ?? batch;
    if (st === "SUCCESS") {
      await settle(po, po.externalId);
      return "paid";
    }
    if (PAYPAL_FAILED.has(st) || PAYPAL_FAILED.has(batch)) {
      await fail(po, `PayPal: ${st}${item?.errors?.message ? ` (${item.errors.message})` : ""}`);
      return "failed";
    }
    if (st === "UNCLAIMED")
      await markSent(
        po,
        po.externalId,
        "The partner has not claimed it in PayPal yet. PayPal returns it after 30 days.",
      );
    return st.toLowerCase() || "pending";
  }
  const { base, headers } = await wiseAuth(po);
  const { body } = await call(`${base}/v1/transfers/${po.externalId}`, { headers }, "Wise status");
  const st = String(body.status ?? "");
  if (st === "outgoing_payment_sent") {
    await settle(po, po.externalId);
    return "paid";
  }
  if (WISE_FAILED.has(st)) {
    await fail(po, `Wise: ${st}`);
    return "failed";
  }
  return st || "pending";
}

/** Scheduled: settle or fail payouts the providers have answered for. Manual payouts wait for a person. */
export async function reconcilePayouts(now = new Date()) {
  const rows = await db()
    .select()
    .from(payout)
    .where(
      and(
        eq(payout.status, "processing"),
        sql`${payout.method} <> 'manual'`,
        sql`${payout.approvedAt} < ${new Date(now.getTime() - 2 * 60_000).toISOString()}::timestamptz`,
      ),
    )
    .limit(200);
  const out: Record<string, string> = {};
  for (const po of rows) {
    try {
      out[po.id] = await reconcile(po);
    } catch (e) {
      out[po.id] = `error: ${(e as Error).message}`; // try again next run
    }
  }
  return out;
}

/** CSV of payouts, for accounting or for paying manually. */
export function payoutsCsv(
  rows: {
    invoiceNumber: string | null;
    partnerName: string;
    partnerEmail: string;
    amount: number;
    currency: string;
    method: string;
    status: string;
    paidAt: Date | null;
    paypalEmail: string | null;
  }[],
) {
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = [
    "invoice",
    "partner",
    "email",
    "amount",
    "currency",
    "method",
    "status",
    "paid_at",
    "paypal_email",
  ];
  return [
    head.join(","),
    ...rows.map((r) =>
      [
        r.invoiceNumber,
        r.partnerName,
        r.partnerEmail,
        toMajor(r.amount, r.currency),
        r.currency.toUpperCase(),
        r.method,
        r.status,
        r.paidAt?.toISOString() ?? "",
        r.paypalEmail,
      ]
        .map(esc)
        .join(","),
    ),
  ].join("\n");
}
