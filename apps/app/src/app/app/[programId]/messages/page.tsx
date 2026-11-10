import { commission, message, partner } from "@openpromoter/db";
import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import type { Metadata } from "next";
import { formatMoney, formatNumber } from "@/lib/money";
import { programCtx } from "@/server/context";
import { db } from "@/server/db";
import { baseSale } from "@/server/fx";
import { balanceAcross, balances } from "@/server/ledger";
import { codeUrl } from "@/server/ref-link";
import { MessagesView } from "./view";

export const metadata: Metadata = { title: "Messages" };

export default async function MessagesPage({
  params,
  searchParams,
}: {
  params: Promise<{ programId: string }>;
  searchParams: Promise<{ partner?: string; view?: string }>;
}) {
  const { programId } = await params;
  const sp = await searchParams;
  const { role, program: prog } = await programCtx(programId);
  const selected = sp.partner ?? null;
  const [sel] = selected
    ? await db()
        .select()
        .from(partner)
        .where(and(eq(partner.id, selected), eq(partner.programId, programId)))
    : [];
  // opening a conversation reads it: clear the unread state before the list is built
  if (sel) {
    await db()
      .update(message)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(message.programId, programId),
          eq(message.partnerId, sel.id),
          eq(message.fromPartner, true),
          isNull(message.readAt),
        ),
      );
  }
  const partners = await db()
    .select({ id: partner.id, name: partner.name })
    .from(partner)
    .where(and(eq(partner.programId, programId), eq(partner.status, "approved")))
    .orderBy(partner.name)
    .limit(1000);
  // latest message per partner conversation, newest first
  const convos = await db()
    .select({
      partnerId: message.partnerId,
      partnerName: partner.name,
      body: message.body,
      subject: message.subject,
      fromPartner: message.fromPartner,
      readAt: message.readAt,
      createdAt: message.createdAt,
    })
    .from(message)
    .innerJoin(partner, eq(partner.id, message.partnerId))
    .where(
      and(
        eq(message.programId, programId),
        isNotNull(message.partnerId),
        sql`${message.createdAt} = (select max(m2.created_at) from message m2 where m2.partner_id = ${sql.raw('"message"."partner_id"')} and m2.program_id = ${programId})`,
      ),
    )
    .orderBy(desc(message.createdAt))
    .limit(200);
  const [ann] = await db()
    .select({ n: sql<number>`count(*)::int` })
    .from(message)
    .where(and(eq(message.programId, programId), isNull(message.partnerId)));
  const thread = await db()
    .select({ m: message, partnerName: partner.name })
    .from(message)
    .leftJoin(partner, eq(partner.id, message.partnerId))
    .where(
      and(eq(message.programId, programId), sel ? eq(message.partnerId, sel.id) : isNull(message.partnerId)),
    )
    .orderBy(desc(message.createdAt))
    .limit(100);

  let context = null;
  if (sel) {
    const [bal, [rev]] = await Promise.all([
      balances(programId, [sel.id]),
      db()
        .select({
          revenue: sql<number>`coalesce(sum(${baseSale}),0)::bigint`,
          customers: sql<number>`(count(distinct ${commission.referralId}) filter (where ${commission.kind} <> 'override'))::int`,
        })
        .from(commission)
        .where(eq(commission.partnerId, sel.id)),
    ]);
    const m = (pick: (b: (typeof bal)[number]) => number) => balanceAcross(bal, prog.currency, pick);
    context = {
      id: sel.id,
      name: sel.name,
      email: sel.email,
      website: sel.website,
      country: sel.country,
      status: sel.status === "approved" ? "active" : sel.status,
      joined: sel.createdAt.toLocaleDateString("en-US", { dateStyle: "medium" }),
      link: codeUrl(prog, sel.code),
      money: [
        { label: "Owed", value: m((b) => b.approved) },
        { label: "Pending", value: m((b) => b.pending) },
        ...(bal.some((b) => b.held !== 0) ? [{ label: "Held", value: m((b) => b.held) }] : []),
        { label: "Paid", value: m((b) => b.paid) },
      ],
      revenue: formatMoney(Number(rev?.revenue ?? 0), prog.currency, { whole: true }),
      customers: formatNumber(rev?.customers ?? 0),
    };
  }

  return (
    <>
      <h1 className="sr-only">Messages</h1>
      <MessagesView
        programId={programId}
        canWrite={role !== "viewer" && role !== "finance"}
        partners={partners}
        selected={sel?.id ?? null}
        paneOpen={Boolean(sel) || sp.view === "announcements"}
        context={context}
        announcements={ann?.n ?? 0}
        convos={convos.map((c) => ({
          partnerId: c.partnerId!,
          partnerName: c.partnerName,
          preview: c.subject || c.body,
          fromPartner: c.fromPartner,
          unread: c.fromPartner && !c.readAt,
          createdAt: c.createdAt.toISOString(),
        }))}
        thread={thread.map((t) => ({
          id: t.m.id,
          subject: t.m.subject,
          body: t.m.body,
          fromPartner: t.m.fromPartner,
          partnerName: t.partnerName,
          partnerId: t.m.partnerId,
          createdAt: t.m.createdAt.toISOString(),
        }))}
      />
    </>
  );
}
