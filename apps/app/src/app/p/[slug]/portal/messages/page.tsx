import { message } from "@openpromoter/db";
import { Badge, cn } from "@openpromoter/ui";
import { Inbox, Megaphone } from "@openpromoter/ui/icons";
import { and, desc, eq, isNull, or } from "drizzle-orm";
import Link from "next/link";
import { PageHeader } from "@/components/page";
import { partnerCtx } from "@/server/context";
import { db } from "@/server/db";
import { programBase } from "@/server/program-base";
import { BrandMark } from "../../brand";
import { Reply } from "./reply";

const when = (d: Date) => {
  const mins = Math.round((Date.now() - d.getTime()) / 60_000);
  if (mins < 60) return `${Math.max(1, mins)}m`;
  if (mins < 1440) return `${Math.round(mins / 60)}h`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

export default async function PortalMessages({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ t?: string }>;
}) {
  const { slug } = await params;
  const { t } = await searchParams;
  const { program: p, partner: pt } = await partnerCtx(slug);
  const home = await programBase(p);
  const rows = await db()
    .select()
    .from(message)
    .where(and(eq(message.programId, p.id), or(eq(message.partnerId, pt.id), isNull(message.partnerId))))
    .orderBy(desc(message.createdAt))
    .limit(100);
  const direct = rows.filter((m) => m.partnerId);
  const news = rows.filter((m) => !m.partnerId);
  const open = news.find((m) => m.id === t) ?? null;
  const last = direct[0];
  const base = `${home}/portal/messages`;
  const logo = <BrandMark name={p.name} logoUrl={p.brand.logoUrl ?? null} size={32} />;
  return (
    <>
      <PageHeader title="Messages" description={`Talk to the ${p.name} team and read their announcements.`} />
      <div className="grid overflow-hidden rounded-xl border border-border bg-surface md:min-h-[600px] md:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="flex flex-col border-b border-border bg-surface-2/50 md:border-r md:border-b-0 dark:bg-surface">
          <div className="flex h-12 items-center justify-between border-b border-border px-4">
            <span className="flex items-center gap-2 text-[13px] font-medium text-fg">
              <Inbox className="size-4 text-subtle" /> Inbox
            </span>
            <span className="num text-[12px] text-subtle">{1 + news.length}</span>
          </div>
          <ul className="flex flex-col">
            <li>
              <Link
                href={base}
                aria-current={!open ? "page" : undefined}
                className={cn(
                  "flex gap-3 border-b border-border px-4 py-3.5",
                  !open ? "bg-surface-3" : "hover:bg-surface",
                )}
              >
                {logo}
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[13px] font-medium text-fg">{p.name} team</span>
                    {last ? (
                      <span className="num shrink-0 text-[11px] whitespace-nowrap text-subtle">
                        {when(last.createdAt)}
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-0.5 block truncate text-[13px] text-muted">
                    {last
                      ? `${last.fromPartner ? "You: " : ""}${last.body}`
                      : "Ask anything about the program"}
                  </span>
                  <span className="mt-2 flex">
                    {last?.fromPartner ? (
                      <Badge tone="warning" dot className="h-5 text-[11px]">
                        Waiting on team
                      </Badge>
                    ) : last ? (
                      <Badge tone="success" dot className="h-5 text-[11px]">
                        Replied
                      </Badge>
                    ) : (
                      <Badge className="h-5 text-[11px]">Direct</Badge>
                    )}
                  </span>
                </span>
              </Link>
            </li>
            {news.length ? (
              <li className="eyebrow px-4 pt-4 pb-2" aria-hidden>
                Announcements
              </li>
            ) : null}
            {news.map((m) => (
              <li key={m.id}>
                <Link
                  href={`${base}?t=${m.id}`}
                  aria-current={open?.id === m.id ? "page" : undefined}
                  className={cn(
                    "flex gap-3 border-b border-border px-4 py-3",
                    open?.id === m.id ? "bg-surface-3" : "hover:bg-surface",
                  )}
                >
                  <span className="flex size-8 shrink-0 items-center justify-center text-muted">
                    <Megaphone className="size-[18px]" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-[13px] font-medium text-fg">
                        {m.subject ?? "Announcement"}
                      </span>
                      <span className="num shrink-0 text-[11px] whitespace-nowrap text-subtle">
                        {when(m.createdAt)}
                      </span>
                    </span>
                    <span className="mt-0.5 line-clamp-1 text-[13px] text-muted">{m.body}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </aside>

        <section className="flex min-w-0 flex-col">
          <div className="flex min-h-12 flex-wrap items-center gap-2 border-b border-border px-5 py-2.5">
            <h2 className="truncate text-[14px] font-medium text-fg">
              {open ? (open.subject ?? "Announcement") : `${p.name} team`}
            </h2>
            {open ? (
              <Badge tone="primary" dot className="h-5 text-[11px]">
                Announcement
              </Badge>
            ) : (
              <Badge className="h-5 text-[11px]">Direct message</Badge>
            )}
          </div>
          <div className="flex flex-1 flex-col gap-4 px-4 py-5 sm:px-6">
            {open ? (
              <article className="max-w-[640px] rounded-lg border border-border p-4">
                <time className="num text-xs text-subtle">
                  {open.createdAt.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
                </time>
                <p className="mt-2 text-[14px] leading-6 [overflow-wrap:anywhere] whitespace-pre-wrap text-fg">
                  {open.body}
                </p>
              </article>
            ) : (
              [...direct].reverse().map((m) => (
                <div key={m.id} className={cn("flex gap-2.5", m.fromPartner && "flex-row-reverse")}>
                  {m.fromPartner ? null : (
                    <span className="mt-5 shrink-0">
                      <BrandMark name={p.name} logoUrl={p.brand.logoUrl ?? null} size={28} />
                    </span>
                  )}
                  <div
                    className={cn(
                      "flex min-w-0 max-w-[min(560px,85%)] flex-col gap-1",
                      m.fromPartner && "items-end",
                    )}
                  >
                    <div className="flex items-baseline gap-2 px-1 text-xs">
                      <span className="font-medium text-fg">{m.fromPartner ? "You" : p.name}</span>
                      <time className="num text-subtle">
                        {m.createdAt.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
                      </time>
                    </div>
                    <p
                      className={cn(
                        "rounded-lg px-3.5 py-2 text-[14px] leading-6 [overflow-wrap:anywhere] whitespace-pre-wrap text-fg",
                        m.fromPartner ? "bg-accent-soft" : "bg-surface-2 dark:bg-surface-3",
                      )}
                    >
                      {m.body}
                    </p>
                  </div>
                </div>
              ))
            )}
            {!open && direct.length === 0 ? (
              <div className="m-auto max-w-[36ch] text-center text-[13px] leading-5 text-muted">
                No messages yet. Questions about a sale, a payout or the content kit go straight to the team.
              </div>
            ) : null}
          </div>
          {open ? null : (
            <div className="border-t border-border p-3 sm:p-4">
              <Reply slug={slug} />
            </div>
          )}
        </section>
      </div>
    </>
  );
}
