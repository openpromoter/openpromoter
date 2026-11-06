import { click, link, promoCode, referral } from "@openpromoter/db";
import { Card, CardHeader } from "@openpromoter/ui";
import { eq, sql } from "drizzle-orm";
import { CopyButton } from "@/components/copy";
import { PageHeader } from "@/components/page";
import { partnerCtx } from "@/server/context";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { PartnerLinks } from "./client";

export default async function PortalLinks({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { program: p, partner: pt } = await partnerCtx(slug);
  const [links, codes] = await Promise.all([
    db()
      .select({
        l: link,
        clicks: sql<number>`(select count(*) from ${click} where ${click.linkId} = ${sql.raw('"link"."id"')} and ${click.isBot} = false)::int`,
        customers: sql<number>`(select count(*) from ${referral} r join ${click} c on c.id = r.click_id where c.link_id = ${sql.raw('"link"."id"')} and r.converted_at is not null)::int`,
      })
      .from(link)
      .where(eq(link.partnerId, pt.id))
      .orderBy(link.createdAt),
    db().select().from(promoCode).where(eq(promoCode.partnerId, pt.id)),
  ]);
  return (
    <>
      <PageHeader
        title="Links"
        description="Every link is tracked on its own. You can see which post, video or channel brings customers."
      />
      <PartnerLinks
        slug={slug}
        website={p.websiteUrl}
        appUrl={env.APP_URL}
        param={p.referralParam}
        code={pt.code}
        links={links.map(({ l, clicks, customers }) => ({
          id: l.id,
          url: `${env.APP_URL}/r/${slug}/l/${l.key}`,
          destination: l.destination,
          subId: l.subId,
          label: l.label,
          clicks,
          customers,
        }))}
      />
      {codes.length ? (
        <Card className="mt-4">
          <CardHeader
            title="Your coupon codes"
            description="Share these where links don't work (podcasts, video, print). Sales with your code are credited to you."
          />
          <ul className="flex flex-wrap gap-3 border-t border-border p-5">
            {codes.map((c) => (
              <li
                key={c.id}
                className="flex h-10 items-center gap-2 rounded-md border border-dashed border-border-strong bg-surface-2 pr-1 pl-3"
              >
                <span className="font-mono text-[14px] tracking-[0.04em] text-fg">{c.code}</span>
                <CopyButton value={c.code} label="Copy code" />
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </>
  );
}
