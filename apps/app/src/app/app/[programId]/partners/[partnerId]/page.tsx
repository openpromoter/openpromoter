import {
  click,
  commission,
  fraudFlag,
  link,
  partner,
  partnerGroup,
  promoCode,
  referral,
} from "@openpromoter/db";
import { Avatar, Badge, Card, CardBody, CardHeader, EmptyState, StatusBadge } from "@openpromoter/ui";
import {
  Banknote,
  ChartLine,
  Coins,
  MousePointerClick,
  ShieldAlert,
  UsersRound,
  Wallet,
} from "@openpromoter/ui/icons";
import { and, desc, eq, sql } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Section, Stat } from "@/components/page";
import { TrafficPanels } from "@/components/traffic";
import { formatMoney, formatNumber } from "@/lib/money";
import { programCtx } from "@/server/context";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { SIGNAL_LABELS } from "@/server/fraud";
import { baseSale } from "@/server/fx";
import { balanceAcross, balances, splitAcross } from "@/server/ledger";
import { domainOrigin } from "@/server/ref-link";
import { trafficReport } from "@/server/traffic";
import { LinksCard, PartnerActions, PartnerSettings, PromoCard } from "./partner-client";

export default async function PartnerPage({
  params,
}: {
  params: Promise<{ programId: string; partnerId: string }>;
}) {
  const { programId, partnerId } = await params;
  const { program: prog } = await programCtx(programId);
  const [p] = await db()
    .select()
    .from(partner)
    .where(and(eq(partner.id, partnerId), eq(partner.programId, programId)));
  if (!p) notFound();
  const now = new Date();
  const traffic = await trafficReport({
    programId,
    partnerId,
    from: new Date(now.getTime() - 30 * 86_400_000),
    to: now,
  });
  const m = (n: number, c = prog.currency) => formatMoney(n, c);
  // two-tier: who recruited this partner and how many they recruited
  const [[recruiter], [team]] = await Promise.all([
    p.recruitedBy
      ? db().select({ id: partner.id, name: partner.name }).from(partner).where(eq(partner.id, p.recruitedBy))
      : Promise.resolve([]),
    db()
      .select({ n: sql<number>`count(*)::int` })
      .from(partner)
      .where(and(eq(partner.programId, programId), eq(partner.recruitedBy, p.id))),
  ]);
  const [links, promos, groups, comms, refs, flags, [clicks], bal] = await Promise.all([
    db()
      .select({
        l: link,
        clicks: sql<number>`(select count(*) from ${click} where ${click.linkId} = ${sql.raw('"link"."id"')})::int`,
      })
      .from(link)
      .where(eq(link.partnerId, partnerId))
      .orderBy(link.createdAt),
    db().select().from(promoCode).where(eq(promoCode.partnerId, partnerId)),
    db().select().from(partnerGroup).where(eq(partnerGroup.programId, programId)).orderBy(partnerGroup.rank),
    db()
      .select()
      .from(commission)
      .where(eq(commission.partnerId, partnerId))
      .orderBy(desc(commission.createdAt))
      .limit(10),
    db()
      .select()
      .from(referral)
      .where(eq(referral.partnerId, partnerId))
      .orderBy(desc(referral.createdAt))
      .limit(10),
    db()
      .select()
      .from(fraudFlag)
      .where(and(eq(fraudFlag.partnerId, partnerId), eq(fraudFlag.resolution, "open"))),
    db()
      .select({ n: sql<number>`count(*)::int` })
      .from(click)
      .where(and(eq(click.partnerId, partnerId), eq(click.isBot, false))),
    balances(programId, [partnerId]),
  ]);
  const across = (pick: (b: (typeof bal)[number]) => number, whole = false) =>
    balanceAcross(bal, prog.currency, pick, { whole });
  const held = bal.some((x) => x.held !== 0);
  const owed = splitAcross(
    bal.map((x) => ({ currency: x.currency, n: x.approved })),
    prog.currency,
    { whole: true },
  );
  const paid = splitAcross(
    bal.map((x) => ({ currency: x.currency, n: x.paid })),
    prog.currency,
    { whole: true },
  );
  // revenue in the program's currency (sales paid in other currencies converted)
  const [rev] = await db()
    .select({
      revenue: sql<number>`coalesce(sum(${baseSale}),0)::bigint`,
      customers: sql<number>`(count(distinct ${commission.referralId}) filter (where ${commission.kind} <> 'override'))::int`,
    })
    .from(commission)
    .where(eq(commission.partnerId, partnerId));

  return (
    <>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={p.name} src={p.avatarUrl} size={44} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-[22px] font-medium tracking-tight text-fg">{p.name}</h1>
              <StatusBadge status={p.status === "approved" ? "active" : p.status} />
              {p.riskScore >= prog.fraudHoldScore ? (
                <Badge tone="danger" icon={ShieldAlert}>
                  Risk {p.riskScore}
                </Badge>
              ) : null}
            </div>
            <p className="truncate text-[13px] text-muted">
              {p.email}
              {p.website ? ` · ${p.website}` : ""}
              {p.country ? ` · ${p.country}` : ""} · joined{" "}
              {p.createdAt.toLocaleDateString("en-US", { dateStyle: "medium" })} via {p.source}
              {recruiter ? (
                <>
                  {" "}
                  · recruited by{" "}
                  <Link
                    href={`/app/${programId}/partners/${recruiter.id}`}
                    className="text-fg hover:underline"
                  >
                    {recruiter.name}
                  </Link>
                </>
              ) : null}
              {team?.n ? ` · ${team.n} recruit${team.n === 1 ? "" : "s"}` : ""}
            </p>
          </div>
        </div>
        <PartnerActions programId={programId} partnerId={p.id} status={p.status} />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Stat icon={MousePointerClick} label="Clicks" value={formatNumber(clicks?.n ?? 0)} />
        <Stat icon={UsersRound} label="Customers" value={formatNumber(rev?.customers ?? 0)} />
        <Stat
          icon={ChartLine}
          label="Revenue"
          value={formatMoney(Number(rev?.revenue ?? 0), prog.currency, { whole: true })}
        />
        <Stat
          icon={Wallet}
          label="Owed"
          value={owed.main}
          sub={[owed.rest, `${across((x) => x.pending)} pending`, held ? `${across((x) => x.held)} held` : ""]
            .filter(Boolean)
            .join(" · ")}
        />
        <Stat
          icon={Banknote}
          label="Paid"
          value={paid.main}
          sub={paid.rest || undefined}
          className="col-span-2 lg:col-span-1"
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <LinksCard
            programId={programId}
            partnerId={p.id}
            slug={prog.slug}
            code={p.code}
            appUrl={env.APP_URL}
            domain={domainOrigin(prog)}
            website={prog.websiteUrl}
            param={prog.referralParam}
            links={links.map(({ l, clicks: c }) => ({
              id: l.id,
              key: l.key,
              destination: l.destination,
              subId: l.subId,
              label: l.label,
              clicks: c,
            }))}
          />
          <Card>
            <CardHeader title="Commissions" description="Most recent first" />
            {comms.length ? (
              <ul className="divide-y divide-border border-t border-border">
                {comms.map((c) => (
                  <li key={c.id} className="flex items-center gap-3 px-5 py-2.5 text-[13px]">
                    <StatusBadge status={c.status} title={c.heldReason ?? undefined} />
                    <span className="min-w-0 flex-1 truncate text-muted">{c.description ?? c.kind}</span>
                    <time className="hidden text-xs text-subtle sm:inline">
                      {c.createdAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </time>
                    <span className={`num w-24 text-right ${c.amount < 0 ? "text-danger" : "text-fg"}`}>
                      {c.amount < 0 ? `−${m(-c.amount, c.currency)}` : m(c.amount, c.currency)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                icon={Coins}
                mascot="thinking"
                title="No commissions yet"
                description="They appear when a customer this partner referred pays."
              />
            )}
          </Card>
          <Card>
            <CardHeader title="Referred customers" />
            {refs.length ? (
              <ul className="divide-y divide-border border-t border-border">
                {refs.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 px-5 py-2.5 text-[13px]">
                    <span className="min-w-0 flex-1 truncate text-fg">
                      {r.email ?? r.name ?? r.externalCustomerId ?? r.id}
                    </span>
                    <StatusBadge status={r.status} />
                    <span className="text-xs text-subtle">via {r.via}</span>
                    <span className="num w-24 text-right text-fg">{m(r.revenue)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="border-t border-border px-5 py-6 text-[13px] text-muted">No referrals yet.</p>
            )}
          </Card>
        </div>
        <div className="flex flex-col gap-4">
          {flags.length ? (
            <Card className="border-danger/40">
              <CardHeader title="Fraud signals" description="Open flags from the fraud checks" />
              <CardBody className="flex flex-col gap-2">
                {flags.map((f) => (
                  <div key={f.id} className="rounded-sm bg-danger-soft px-3 py-2 text-[13px]">
                    <div className="font-medium text-danger">
                      {SIGNAL_LABELS[f.signal as keyof typeof SIGNAL_LABELS] ?? f.signal} · {f.score}
                    </div>
                    <div className="text-fg/80">{f.detail}</div>
                  </div>
                ))}
              </CardBody>
            </Card>
          ) : null}
          <PromoCard
            programId={programId}
            partnerId={p.id}
            codes={promos.map((x) => ({ id: x.id, code: x.code, synced: !!x.externalId }))}
          />
          <PartnerSettings
            programId={programId}
            partnerId={p.id}
            groups={groups.map((g) => ({ id: g.id, name: g.name, rate: g.commissionValue }))}
            groupId={p.groupId}
            notes={p.notes}
            payoutMethod={p.payoutMethod}
            paypalEmail={p.paypalEmail}
            override={
              p.commissionOverride == null
                ? ""
                : prog.commissionType === "percent"
                  ? String(p.commissionOverride / 100)
                  : (p.commissionOverride / 100).toFixed(2)
            }
            unit={prog.commissionType === "percent" ? "%" : prog.currency.toUpperCase()}
          />
          <Card>
            <CardHeader title="Payout and tax" />
            <CardBody className="flex flex-col gap-2 text-[13px]">
              <div className="flex justify-between">
                <span className="text-muted">Method</span>
                <span className="text-fg capitalize">{p.payoutMethod ?? "Not set"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Stripe payouts</span>
                <span className="text-fg">
                  {p.stripeAccountId ? (p.stripePayoutsEnabled ? "Ready" : "Onboarding") : "–"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Tax form</span>
                <span className="text-fg">
                  {p.taxFormType
                    ? p.taxFormType.toUpperCase().replace("W8", "W-8").replace("W9", "W-9")
                    : "–"}{" "}
                  · {p.taxFormStatus}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">VAT ID</span>
                <span className="font-mono text-fg">{p.vatId ?? "–"}</span>
              </div>
            </CardBody>
          </Card>
          {Object.keys(p.answers).length ? (
            <Card>
              <CardHeader title="Application" />
              <CardBody className="flex flex-col gap-3 text-[13px]">
                {Object.entries(p.answers).map(([k, v]) => (
                  <div key={k}>
                    <div className="text-xs text-muted">
                      {prog.applicationQuestions.find((q) => q.id === k)?.label ?? k}
                    </div>
                    <div className="whitespace-pre-wrap text-fg">{v}</div>
                  </div>
                ))}
              </CardBody>
            </Card>
          ) : null}
        </div>
      </div>
      <Section
        className="mt-4"
        title="Traffic"
        description="This partner's visitors in the last 30 days: sources, countries, devices and the latest clicks."
      >
        <TrafficPanels t={traffic} />
      </Section>
    </>
  );
}
