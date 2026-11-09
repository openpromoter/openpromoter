import {
  commission,
  kvStore,
  member,
  partner,
  payout,
  program,
  reportSubscription,
  user,
} from "@openpromoter/db";
import { and, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { formatMoney, formatNumber, formatPercent } from "@/lib/money";
import { runAutopilot } from "./ai/autopilot";
import { generateContentKit } from "./ai/content";
import { sendFollowUps } from "./ai/recruiter";
import { delta, overview, previous, topPartners } from "./analytics";
import { SYSTEM } from "./audit";
import { evaluateBounties, evaluateTiers, settleEndedCampaigns } from "./campaigns";
import { db } from "./db";
import { sendNotice, sendReport } from "./email";
import { env } from "./env";
import { deliver, emitEvent } from "./events";
import { enqueueProgramRescore, rescorePartner } from "./fraud-run";
import { pruneParked } from "./ingest";
import { defineJob, enqueue, pruneJobs, runDueJobs } from "./jobs";
import { matureCommissions } from "./ledger";
import { createPayoutBatch, reconcilePayouts } from "./payouts";
import { pruneRateLimits } from "./ratelimit";
import { codeUrl, programUrl } from "./ref-link";
import { importStripe } from "./stripe-service";

const portal = (p: Parameters<typeof programUrl>[0], path = "") => programUrl(p, `/portal${path}`);

async function brandOf(programId: string) {
  const [p] = await db().select().from(program).where(eq(program.id, programId));
  return p ?? null;
}

async function teamEmails(workspaceId: string, roles = ["owner", "admin"]) {
  const rows = await db()
    .select({ email: user.email })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(and(eq(member.workspaceId, workspaceId), inArray(member.role, roles as ("owner" | "admin")[])));
  return rows.map((r) => r.email);
}

export function registerJobs() {
  defineJob("events.emit", async (p) => {
    await emitEvent(String(p.workspaceId), String(p.event), (p.data ?? {}) as Record<string, unknown>);
  });
  defineJob("webhook.deliver", async (p) => deliver(String(p.deliveryId)));
  defineJob("campaigns.evaluate", async (p) => {
    await evaluateBounties(String(p.programId), String(p.partnerId), String(p.trigger), p.held === true);
  });
  defineJob("tiers.evaluate", async (p) => {
    await evaluateTiers(String(p.programId), String(p.partnerId));
  });
  defineJob("fraud.rescore", async (p) => {
    await rescorePartner(String(p.partnerId));
  });
  defineJob("fraud.rescore_batch", async (p) => {
    for (const id of (p.partnerIds as string[]) ?? []) await rescorePartner(id);
  });
  defineJob("stripe.import", async (p) => {
    await importStripe(String(p.workspaceId));
  });
  defineJob("content.generate", async (p) => {
    const prog = await brandOf(String(p.programId));
    if (prog) await generateContentKit(prog, { force: !!p.force });
  });
  defineJob("autopilot.run", async (p) => {
    await runAutopilot(String(p.programId));
  });
  defineJob("email.notice", async (p) => {
    const prog = p.programId ? await brandOf(String(p.programId)) : null;
    await sendNotice(
      String(p.to),
      String(p.subject),
      {
        brandName: prog?.name ?? "OpenPromoter",
        brandColor: prog?.brand.color,
        logoUrl: prog?.brand.logoUrl,
        preview: String(p.subject),
        title: String(p.title ?? p.subject),
        paragraphs: (p.paragraphs as string[]) ?? [],
        cta: p.cta as { label: string; href: string } | undefined,
      },
      undefined,
      prog?.id,
    );
  });
  defineJob("notify.commission", async (p) => {
    const [row] = await db()
      .select({ c: commission, pt: partner, prog: program })
      .from(commission)
      .innerJoin(partner, eq(partner.id, commission.partnerId))
      .innerJoin(program, eq(program.id, commission.programId))
      .where(eq(commission.id, String(p.commissionId)));
    if (!row || row.c.status === "held") return;
    await sendNotice(
      row.pt.email,
      `You earned ${formatMoney(row.c.amount, row.c.currency)} from ${row.prog.name}`,
      {
        brandName: row.prog.name,
        brandColor: row.prog.brand.color,
        logoUrl: row.prog.brand.logoUrl,
        preview: `It joins your next payout after the ${row.prog.holdDays}-day refund window.`,
        title: `You earned ${formatMoney(row.c.amount, row.c.currency)}`,
        paragraphs: [
          row.c.kind === "override"
            ? `A partner you recruited just earned a commission, and you earn ${row.prog.overrideRate / 100}% of it. It is pending for ${row.prog.holdDays} days (the refund window) and then joins your next payout.`
            : `A customer you referred just paid. The commission is pending for ${row.prog.holdDays} days (the refund window) and then joins your next payout.`,
        ],
        ledger: {
          rows: [
            ...(row.c.saleAmount
              ? [{ label: "Customer payment", value: formatMoney(row.c.saleAmount, row.c.currency) }]
              : []),
            ...(row.c.holdUntil
              ? [
                  {
                    label: "Payable from",
                    value: row.c.holdUntil.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
                  },
                ]
              : []),
          ],
          total: { label: "Your commission", value: formatMoney(row.c.amount, row.c.currency) },
        },
        cta: { label: "View earnings", href: portal(row.prog, "/earnings") },
      },
    );
  });
  defineJob("notify.payout", async (p) => {
    const [row] = await db()
      .select({ po: payout, pt: partner, prog: program })
      .from(payout)
      .innerJoin(partner, eq(partner.id, payout.partnerId))
      .innerJoin(program, eq(program.id, payout.programId))
      .where(eq(payout.id, String(p.payoutId)));
    if (!row) return;
    await sendNotice(
      row.pt.email,
      `${row.prog.name} sent you ${formatMoney(row.po.amount, row.po.currency)}`,
      {
        brandName: row.prog.name,
        brandColor: row.prog.brand.color,
        logoUrl: row.prog.brand.logoUrl,
        preview: "Your commissions were sent. The invoice is in your portal.",
        title: `Payout sent: ${formatMoney(row.po.amount, row.po.currency)}`,
        paragraphs: [
          `We sent your commissions via ${row.po.method === "stripe" ? "Stripe" : row.po.method === "paypal" ? "PayPal" : row.po.method === "wise" ? "Wise" : "bank transfer"}. ${row.po.invoiceNumber ? `Invoice ${row.po.invoiceNumber} is` : "The invoice is"} in your portal.`,
        ],
        ledger: {
          rows: [
            {
              label: "Method",
              value:
                row.po.method === "stripe"
                  ? "Stripe"
                  : row.po.method === "paypal"
                    ? "PayPal"
                    : row.po.method === "wise"
                      ? "Wise"
                      : "Bank transfer",
            },
            ...(row.po.invoiceNumber ? [{ label: "Invoice", value: row.po.invoiceNumber }] : []),
            { label: "Fees from OpenPromoter", value: formatMoney(0, row.po.currency) },
          ],
          total: { label: "Paid to you", value: formatMoney(row.po.amount, row.po.currency) },
        },
        cta: { label: "View payouts", href: portal(row.prog, "/payouts") },
      },
    );
  });
  defineJob("notify.partner_approved", async (p) => {
    const [row] = await db()
      .select({ pt: partner, prog: program })
      .from(partner)
      .innerJoin(program, eq(program.id, partner.programId))
      .where(eq(partner.id, String(p.partnerId)));
    if (!row) return;
    await sendNotice(row.pt.email, `You're in: ${row.prog.name} partner program`, {
      brandName: row.prog.name,
      brandColor: row.prog.brand.color,
      logoUrl: row.prog.brand.logoUrl,
      preview: "Your application was approved",
      title: "Your partner account is ready",
      paragraphs: [
        `Your partner account for ${row.prog.name} is ready. Your link is ${codeUrl(row.prog, row.pt.code)}.`,
        "Add a payout method in the portal so we can pay you. Then grab ready-made posts from the content kit.",
      ],
      cta: { label: "Open your portal", href: portal(row.prog) },
    });
  });
  defineJob("notify.new_application", async (p) => {
    const [row] = await db()
      .select({ pt: partner, prog: program })
      .from(partner)
      .innerJoin(program, eq(program.id, partner.programId))
      .where(eq(partner.id, String(p.partnerId)));
    if (!row) return;
    for (const to of await teamEmails(row.prog.workspaceId)) {
      await sendNotice(to, `New partner application: ${row.pt.name}`, {
        brandName: "OpenPromoter",
        preview: "Review a new application",
        title: `${row.pt.name} wants to promote ${row.prog.name}`,
        paragraphs: [
          `${row.pt.email}${row.pt.website ? ` · ${row.pt.website}` : ""}. Risk score ${row.pt.riskScore}/100.`,
        ],
        cta: { label: "Review", href: `${env.APP_URL}/app/${row.prog.id}/partners/${row.pt.id}` },
      });
    }
  });
  defineJob("reports.send", async (p) => sendProgramReport(String(p.programId), String(p.email)));
}

export async function sendProgramReport(programId: string, email: string) {
  const prog = await brandOf(programId);
  if (!prog) return;
  const now = new Date();
  const r = { from: new Date(now.getTime() - 7 * 86_400_000), to: now };
  const cur = await overview(programId, r);
  const prev = await overview(programId, previous(r));
  const top = (await topPartners(programId, r, 3)).filter((t) => t.revenue > 0);
  const m = (n: number) => formatMoney(n, prog.currency);
  const d = (a: number, b: number) =>
    `${delta(a, b) >= 0 ? "+" : ""}${formatPercent(delta(a, b), 0)} vs last week`;
  await sendReport(email, `${prog.name} partners: ${m(cur.revenue)} this week`, {
    brandName: prog.name,
    periodLabel: `Week ending ${now.toLocaleDateString("en-US", { dateStyle: "medium", timeZone: "UTC" })}`,
    stats: [
      { label: "referred revenue", value: m(cur.revenue), delta: d(cur.revenue, prev.revenue) },
      { label: "new customers", value: String(cur.customers), delta: d(cur.customers, prev.customers) },
      { label: "clicks", value: formatNumber(cur.clicks), delta: d(cur.clicks, prev.clicks) },
      { label: "MRR from partners", value: m(cur.mrr) },
      { label: "owed to partners", value: m(cur.owed) },
    ],
    highlights: top.map((t) => `${t.name}: ${m(t.revenue)} from ${t.customers} customers`),
    nextSteps: [
      cur.owed > 0 ? `Approve payouts (${m(cur.owed)} owed)` : null,
      cur.held > 0 ? `Review ${m(cur.held)} in held commissions` : null,
      "Check Autopilot's suggestions",
    ].filter(Boolean) as string[],
    dashboardUrl: `${env.APP_URL}/app/${programId}`,
  });
}

/** Cron-like schedule. Each task runs at most once per period across all workers (kv lock). */
const SCHEDULE: { key: string; every: number; run: () => Promise<unknown> }[] = [
  { key: "mature", every: 15 * 60_000, run: () => matureCommissions() },
  { key: "payouts.reconcile", every: 10 * 60_000, run: () => reconcilePayouts() },
  {
    key: "housekeeping",
    every: 10 * 60_000,
    run: () => Promise.all([pruneJobs(), pruneRateLimits(), pruneParked()]),
  },
  { key: "campaigns.settle", every: 15 * 60_000, run: () => settleEndedCampaigns() },
  { key: "recruiter.followups", every: 6 * 3_600_000, run: () => sendFollowUps() },
  {
    key: "autopilot.weekly",
    every: 7 * 86_400_000,
    run: async () => {
      for (const p of await db()
        .select({ id: program.id })
        .from(program)
        .where(eq(program.autopilotEnabled, true)))
        await enqueue("autopilot.run", { programId: p.id });
    },
  },
  {
    key: "fraud.daily",
    every: 86_400_000,
    run: async () => {
      for (const p of await db().select({ id: program.id }).from(program)) await enqueueProgramRescore(p.id);
    },
  },
  {
    key: "content.weekly",
    every: 7 * 86_400_000,
    run: async () => {
      for (const p of await db().select({ id: program.id }).from(program))
        await enqueue("content.generate", { programId: p.id });
    },
  },
  {
    key: "payouts.scheduled",
    every: 86_400_000,
    run: async () => {
      const today = new Date();
      const programs = await db().select().from(program).where(sql`${program.payoutSchedule} <> 'manual'`);
      for (const p of programs) {
        const due = p.payoutSchedule === "monthly" ? today.getUTCDate() === 1 : today.getUTCDay() === 1;
        if (!due) continue;
        const batch = await createPayoutBatch(p.id, SYSTEM);
        if (batch.length) {
          for (const to of await teamEmails(p.workspaceId, ["owner", "admin", "finance"])) {
            await enqueue("email.notice", {
              to,
              subject: `${batch.length} payouts are ready for approval`,
              title: "Payouts ready for approval",
              paragraphs: [
                `${formatMoney(
                  batch.reduce((a, b) => a + b.amount, 0),
                  p.currency,
                )} for ${batch.length} partners. Nothing is sent until you approve.`,
              ],
              cta: { label: "Review payouts", href: `${env.APP_URL}/app/${p.id}/payouts` },
            });
          }
        }
      }
    },
  },
  {
    key: "reports",
    every: 3_600_000,
    run: async () => {
      const now = new Date();
      const due = await db()
        .select()
        .from(reportSubscription)
        .where(
          or(
            isNull(reportSubscription.lastSentAt),
            lte(reportSubscription.lastSentAt, new Date(now.getTime() - 7 * 86_400_000)),
          ),
        );
      for (const s of due) {
        if (
          s.frequency === "monthly" &&
          s.lastSentAt &&
          now.getTime() - s.lastSentAt.getTime() < 28 * 86_400_000
        )
          continue;
        // a teammate removed from the workspace stops getting its analytics
        const [still] = await db()
          .select({ id: user.id })
          .from(user)
          .innerJoin(member, eq(member.userId, user.id))
          .innerJoin(program, eq(program.workspaceId, member.workspaceId))
          .where(and(eq(program.id, s.programId), sql`lower(${user.email}) = lower(${s.email})`));
        if (!still) {
          await db().delete(reportSubscription).where(eq(reportSubscription.id, s.id));
          continue;
        }
        await enqueue("reports.send", { programId: s.programId, email: s.email });
        await db().update(reportSubscription).set({ lastSentAt: now }).where(eq(reportSubscription.id, s.id));
      }
    },
  },
];

async function claim(key: string, every: number) {
  const now = Date.now();
  const rows = await db()
    .insert(kvStore)
    .values({ key: `schedule:${key}`, value: { at: now } })
    .onConflictDoUpdate({
      target: kvStore.key,
      set: { value: { at: now }, updatedAt: new Date() },
      setWhere: sql`(${kvStore.value}->>'at')::bigint < ${now - every}`,
    })
    .returning();
  return rows.length > 0;
}

let started = false;

/** Starts the in-process worker loop (Postgres queue; no Redis). */
export function startWorker() {
  if (started || env.RUN_WORKER === "false") return;
  started = true;
  registerJobs();
  let busy = false;
  const tick = async () => {
    // one tick at a time per process: a slow tick must not stack up concurrent loops every 5s
    if (busy) return;
    busy = true;
    try {
      for (const s of SCHEDULE)
        if (await claim(s.key, s.every))
          await s.run().catch((e) => console.error(`[schedule] ${s.key}: ${(e as Error).message}`));
      while ((await runDueJobs(20)) > 0) {}
    } catch (err) {
      console.error(`[worker] ${(err as Error).message}`);
    } finally {
      busy = false;
    }
  };
  setInterval(tick, 5_000).unref();
  void tick();
}
