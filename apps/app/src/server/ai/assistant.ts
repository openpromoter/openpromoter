import { fraudFlag, partner, payout } from "@openpromoter/db";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { formatMoney, formatNumber, formatPercent } from "@/lib/money";
import {
  cohorts,
  idlePartners,
  overview,
  partnersWithCustomers,
  pendingApplications,
  type Range,
  topPartners,
  topSources,
} from "../analytics";
import { db } from "../db";
import { payableBalances } from "../ledger";
import { aiJson, aiText } from "./provider";

/** Questions the assistant can answer from real data. Each returns rows plus links into the app. */
export const TOOLS = {
  overview:
    "Totals for the period: revenue, commissions, clicks, signups, customers, conversion rate, EPC, MRR, owed.",
  top_partners: "Partners ranked by referred revenue in the period, with clicks, customers, EPC and LTV.",
  partners_with_customers: "Partners who brought paying customers in the period.",
  idle_partners: "Approved partners with no clicks in the last 30 days.",
  pending_applications: "Partner applications waiting for approval.",
  payouts_owed: "Partners currently owed money (approved, past the hold), and payouts waiting for approval.",
  fraud: "Open fraud flags.",
  sources: "Traffic sources and links that produce customers.",
  cohorts: "Monthly customer cohorts with retention.",
} as const;
export type ToolName = keyof typeof TOOLS;
/** Tools that report the current state, where a date range would only confuse the answer. */
const UNDATED = new Set<ToolName>(["payouts_owed", "pending_applications", "fraud", "idle_partners"]);

export interface Answer {
  text: string;
  tool: ToolName;
  rows: Record<string, unknown>[];
  links: { label: string; href: string }[];
  source: "ai" | "rules";
}

/** Keyword router used without AI (and as a safety net when the AI picks nothing). */
export function routeQuestion(q: string): { tool: ToolName; days: number } {
  const t = q.toLowerCase();
  const days = /last week|7 days|this week/.test(t)
    ? 7
    : /last month|30 days|this month/.test(t)
      ? 30
      : /quarter|90 days/.test(t)
        ? 90
        : /year|12 months|365/.test(t)
          ? 365
          : 30;
  if (/fraud|suspicious|risk|cheat/.test(t)) return { tool: "fraud", days };
  if (/owe|payout|pay out|unpaid|balance/.test(t)) return { tool: "payouts_owed", days };
  if (/application|pending|waiting|approve/.test(t)) return { tool: "pending_applications", days };
  if (/idle|inactive|quiet|dormant|stopped/.test(t)) return { tool: "idle_partners", days };
  if (/paying customer|brought.*customer|customers? from|who (brought|referred)/.test(t))
    return { tool: "partners_with_customers", days };
  if (/source|channel|link|content|traffic|where/.test(t)) return { tool: "sources", days };
  if (/cohort|retention|churn|stick/.test(t)) return { tool: "cohorts", days };
  if (/top|best|most|rank|leader/.test(t)) return { tool: "top_partners", days };
  return { tool: "overview", days };
}

async function run(
  programId: string,
  base: string,
  tool: ToolName,
  r: Range,
  currency: string,
): Promise<Omit<Answer, "source" | "text"> & { summary: string }> {
  const m = (n: number) => formatMoney(n, currency);
  switch (tool) {
    case "overview": {
      const o = await overview(programId, r);
      return {
        tool,
        rows: [o],
        links: [{ label: "Dashboard", href: base }],
        summary: `${m(o.revenue)} referred revenue, ${m(o.commissions)} in commissions, ${formatNumber(o.clicks)} clicks, ${o.leads} signups and ${o.customers} new customers (${formatPercent(o.conversionRate, 2)} of clicks). MRR from partners ${m(o.mrr)}. ${m(o.owed)} approved and unpaid.`,
      };
    }
    case "top_partners": {
      const rows = await topPartners(programId, r, 10);
      const nonzero = rows.filter((x) => x.revenue > 0 || x.clicks > 0);
      return {
        tool,
        rows: nonzero,
        links: nonzero.slice(0, 5).map((x) => ({ label: x.name, href: `${base}/partners/${x.id}` })),
        summary: nonzero.length
          ? nonzero
              .slice(0, 5)
              .map(
                (x, i) =>
                  `${i + 1}. ${x.name}: ${m(x.revenue)} from ${x.customers} customers and ${formatNumber(x.clicks)} clicks`,
              )
              .join("\n")
          : "No partner activity in this period.",
      };
    }
    case "partners_with_customers": {
      const rows = (await partnersWithCustomers(programId, r)).map((x) => ({
        ...x,
        revenue: Number(x.revenue),
      }));
      return {
        tool,
        rows,
        links: rows.slice(0, 8).map((x) => ({ label: x.name, href: `${base}/partners/${x.id}` })),
        summary: rows.length
          ? rows
              .map(
                (x) =>
                  `${x.name}: ${x.customers} paying customer${x.customers === 1 ? "" : "s"} (${m(x.revenue)})`,
              )
              .join("\n")
          : "No partner brought a paying customer in this period.",
      };
    }
    case "idle_partners": {
      const rows = await idlePartners(programId, 30);
      return {
        tool,
        rows,
        links: [
          { label: "Autopilot", href: `${base}/autopilot` },
          ...rows.slice(0, 5).map((x) => ({ label: x.name, href: `${base}/partners/${x.id}` })),
        ],
        summary: `${rows.length} approved partners had no clicks in 30 days.`,
      };
    }
    case "pending_applications": {
      const rows = await pendingApplications(programId);
      return {
        tool,
        rows: rows.map((x) => ({
          id: x.id,
          name: x.name,
          email: x.email,
          riskScore: x.riskScore,
          createdAt: x.createdAt,
        })),
        links: [{ label: "Review applications", href: `${base}/partners?status=pending` }],
        summary: `${rows.length} applications are waiting.`,
      };
    }
    case "payouts_owed": {
      const owed = await payableBalances(programId);
      const names = await db()
        .select({ id: partner.id, name: partner.name })
        .from(partner)
        .where(eq(partner.programId, programId));
      const byId = new Map(names.map((n) => [n.id, n.name]));
      const waiting = await db()
        .select()
        .from(payout)
        .where(and(eq(payout.programId, programId), eq(payout.status, "awaiting_approval")));
      // money in a payout that waits for approval is still owed: count it, not only what the next batch would pick up
      const rows = [
        ...waiting.map((p) => ({
          partner: byId.get(p.partnerId),
          amount: p.amount,
          currency: p.currency,
          status: "in a payout waiting for approval",
        })),
        ...owed.map((o) => ({
          partner: byId.get(o.partnerId),
          amount: o.approved,
          currency: o.currency,
          status: "approved, ready for the next payout",
        })),
      ];
      const inPayouts = waiting.reduce((a, b) => a + b.amount, 0);
      const ready = owed.reduce((a, b) => a + b.approved, 0);
      return {
        tool,
        rows,
        links: [{ label: "Payouts", href: `${base}/payouts` }],
        summary: `You owe partners ${m(inPayouts + ready)} in total. ${m(inPayouts)} is in ${waiting.length} ${waiting.length === 1 ? "payout" : "payouts"} waiting for your approval. ${m(ready)} more is approved for ${owed.length} ${owed.length === 1 ? "partner" : "partners"} and goes into the next payout.`,
      };
    }
    case "fraud": {
      const rows = await db()
        .select({
          id: fraudFlag.id,
          partner: partner.name,
          partnerId: partner.id,
          signal: fraudFlag.signal,
          score: fraudFlag.score,
          detail: fraudFlag.detail,
        })
        .from(fraudFlag)
        .innerJoin(partner, eq(partner.id, fraudFlag.partnerId))
        .where(and(eq(fraudFlag.programId, programId), eq(fraudFlag.resolution, "open")))
        .orderBy(desc(fraudFlag.score))
        .limit(20);
      return {
        tool,
        rows,
        links: [{ label: "Fraud", href: `${base}/fraud` }],
        summary: rows.length
          ? rows
              .slice(0, 5)
              .map((x) => `${x.partner}: ${x.detail} (score ${x.score})`)
              .join("\n")
          : "No open fraud flags.",
      };
    }
    case "sources": {
      const s = await topSources(programId, r, 8);
      return {
        tool,
        rows: s.bySource,
        links: [{ label: "Analytics", href: `${base}/analytics` }],
        summary: s.bySource.length
          ? s.bySource.map((x) => `${x.source}: ${x.clicks} clicks and ${x.customers} customers`).join("\n")
          : "No clicks in this period.",
      };
    }
    case "cohorts": {
      const rows = await cohorts(programId, 6);
      return {
        tool,
        rows,
        links: [{ label: "Analytics", href: `${base}/analytics` }],
        summary: rows.length
          ? rows
              .map(
                (x) =>
                  `${x.cohort}: ${x.customers} customers with ${formatPercent(x.retention, 0)} still active`,
              )
              .join("\n")
          : "No converted customers yet.",
      };
    }
  }
}

const planSchema = z.object({
  tool: z.enum(Object.keys(TOOLS) as [ToolName, ...ToolName[]]),
  days: z.number().int(),
});

export async function ask(
  programId: string,
  question: string,
  opts: { base: string; currency: string; now?: Date; workspaceId?: string },
): Promise<Answer> {
  const now = opts.now ?? new Date();
  const plan =
    (await aiJson(planSchema, {
      system: `Pick the one data tool that answers the founder's question about their affiliate program, and the look-back window in days (default 30). Tools: ${JSON.stringify(TOOLS)}`,
      prompt: question,
      workspaceId: opts.workspaceId,
    })) ?? null;
  const route = plan ?? routeQuestion(question);
  const days = Math.min(730, Math.max(1, route.days || 30));
  const result = await run(
    programId,
    opts.base,
    route.tool,
    { from: new Date(now.getTime() - days * 86_400_000), to: now },
    opts.currency,
  );
  const text = plan
    ? ((await aiText({
        system:
          "Answer the founder's question in 1-4 short sentences using only the data given. Take totals from the summary. The detail list may be only the first entries, so never add it up or mention rows, lists or data. Name partners and amounts. If the data is empty, say so plainly and suggest one next step. No markdown headings.",
        prompt: `Question: ${question}\n${UNDATED.has(route.tool) ? "" : `Period: last ${days} days\n`}Summary:\n${result.summary}\nTop entries (JSON): ${JSON.stringify(result.rows.slice(0, 15))}`,
        workspaceId: opts.workspaceId,
      })) ?? result.summary)
    : result.summary;
  return { text, tool: result.tool, rows: result.rows, links: result.links, source: plan ? "ai" : "rules" };
}
