import { click, link, partner, program, referral } from "@openpromoter/db";
import { and, asc, eq, sql } from "drizzle-orm";
import { CopyButton } from "@/components/copy";
import { formatMoney, formatNumber } from "@/lib/money";
import { durationLabel, rateLabel } from "@/lib/program-labels";
import { db } from "@/server/db";
import { verifyEmbedToken } from "@/server/embed";
import { env } from "@/server/env";
import { balances } from "@/server/ledger";
import { codeUrl, linkUrl } from "@/server/ref-link";
import { BrandScope } from "../../p/[slug]/brand";

export const dynamic = "force-dynamic";

/** Framed inside the founder's app via <openpromoter-dashboard>. No login: the signed token identifies the partner. */
export default async function EmbedPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const { slug } = await params;
  const { token } = await searchParams;
  const partnerId = verifyEmbedToken(token);
  const [row] = partnerId
    ? await db()
        .select({ p: partner, prog: program })
        .from(partner)
        .innerJoin(program, eq(program.id, partner.programId))
        .where(and(eq(partner.id, partnerId), eq(program.slug, slug)))
    : [];
  if (!row)
    return (
      <p className="p-6 text-[13px] text-muted">This referral dashboard link has expired. Reload the page.</p>
    );
  const { p, prog } = row;
  const [[l], [clicks], [refs], bal] = await Promise.all([
    // the first link is the partner's main one; deep links made later never replace it
    db()
      .select()
      .from(link)
      .where(eq(link.partnerId, p.id))
      .orderBy(asc(link.createdAt), asc(link.id))
      .limit(1),
    db()
      .select({ n: sql<number>`count(*)::int` })
      .from(click)
      .where(and(eq(click.partnerId, p.id), eq(click.isBot, false))),
    db()
      .select({ n: sql<number>`count(*) filter (where ${referral.convertedAt} is not null)::int` })
      .from(referral)
      .where(eq(referral.partnerId, p.id)),
    balances(prog.id, [p.id]),
  ]);
  const b = bal.find((x) => x.currency === prog.currency) ?? { approved: 0, pending: 0, paid: 0, held: 0 };
  const url = l ? linkUrl(prog, l.key) : codeUrl(prog, p.code);
  const m = (n: number) => formatMoney(n, prog.currency);
  return (
    <BrandScope color={prog.brand.color} className="bg-surface p-4 text-[13px]">
      <p className="text-[14px] leading-5 text-fg">
        Earn <b className="font-medium">{rateLabel(prog)}</b> {durationLabel(prog)} you refer.
      </p>
      <div className="mt-3 flex items-center gap-2 rounded-lg bg-canvas py-1.5 pr-1.5 pl-3 dark:bg-surface-2">
        <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-fg">{url}</span>
        <CopyButton value={url} label="Copy link" size="sm" />
      </div>
      <dl className="mt-3 flex flex-col gap-2 rounded-lg border border-border px-3 py-2.5">
        {[
          ["Clicks", formatNumber(clicks?.n ?? 0)],
          ["Customers", formatNumber(refs?.n ?? 0)],
          ["Earned", m(b.approved + b.pending + b.paid)],
        ].map(([k, v]) => (
          <div key={k} className="flex items-baseline">
            <dt className="text-muted">{k}</dt>
            <span className="leader" aria-hidden />
            <dd className="num font-medium text-fg">{v}</dd>
          </div>
        ))}
      </dl>
      <a
        href={`${env.APP_URL}/p/${slug}/portal`}
        target="_blank"
        rel="noreferrer"
        className="mt-3 inline-block text-xs font-medium text-accent-text hover:underline"
      >
        Open the full partner portal
      </a>
    </BrandScope>
  );
}
