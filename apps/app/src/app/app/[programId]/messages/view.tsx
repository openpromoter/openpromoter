"use client";

import { Avatar, Button, cn, EmptyState, Kbd, StatusBadge } from "@openpromoter/ui";
import {
  ArrowLeft,
  Check,
  Copy,
  Globe,
  Inbox,
  Mail,
  Megaphone,
  MessageSquare,
  Pencil,
  Search,
  Send,
  X,
} from "@openpromoter/ui/icons";
import Link from "next/link";
import { Fragment, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { LedgerLine } from "@/components/page";
import { useAction } from "@/components/use-action";
import { sendMessageAction } from "../growth-actions";

type M = {
  id: string;
  subject: string | null;
  body: string;
  fromPartner: boolean;
  partnerName: string | null;
  partnerId: string | null;
  createdAt: string;
};
type Convo = {
  partnerId: string;
  partnerName: string;
  preview: string;
  fromPartner: boolean;
  unread: boolean;
  createdAt: string;
};
type Context = {
  id: string;
  name: string;
  email: string;
  website: string | null;
  country: string | null;
  status: string;
  joined: string;
  link: string;
  money: { label: string; value: string }[];
  revenue: string;
  customers: string;
};
type Filter = "all" | "unread" | "reply";

function ago(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

/** Consecutive messages from one side within 10 minutes share a name line. */
function groups(thread: M[]) {
  const out: M[][] = [];
  for (const m of thread) {
    const last = out.at(-1)?.at(-1);
    const same =
      last &&
      last.fromPartner === m.fromPartner &&
      new Date(m.createdAt).toDateString() === new Date(last.createdAt).toDateString() &&
      new Date(m.createdAt).getTime() - new Date(last.createdAt).getTime() < 10 * 60_000;
    if (same) out.at(-1)!.push(m);
    else out.push([m]);
  }
  return out;
}

/** Two-pane inbox (three on wide screens): conversations, the thread with its composer, and who the partner is. */
export function MessagesView({
  programId,
  canWrite,
  partners,
  selected,
  paneOpen,
  context,
  thread,
  convos,
  announcements,
}: {
  programId: string;
  canWrite: boolean;
  partners: { id: string; name: string }[];
  selected: string | null;
  /** On phones the list and the thread are separate screens. */
  paneOpen: boolean;
  context: Context | null;
  thread: M[];
  convos: Convo[];
  announcements: number;
}) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [picking, setPicking] = useState(false);
  const base = `/app/${programId}/messages`;
  const needle = q.trim().toLowerCase();
  const counts = {
    all: convos.length,
    unread: convos.filter((c) => c.unread).length,
    reply: convos.filter((c) => c.fromPartner).length,
  };
  const shown = useMemo(
    () =>
      convos.filter(
        (c) =>
          (filter === "all" || (filter === "unread" ? c.unread : c.fromPartner)) &&
          (c.partnerName.toLowerCase().includes(needle) || c.preview.toLowerCase().includes(needle)),
      ),
    [convos, filter, needle],
  );
  const pickable = useMemo(
    () => partners.filter((p) => p.name.toLowerCase().includes(needle)).slice(0, 100),
    [partners, needle],
  );
  const ordered = [...thread].reverse();

  return (
    <div className="-mx-4 -my-6 flex h-[calc(100dvh-56px-60px)] md:-mx-8 md:-my-8 md:h-[calc(100dvh-56px-18px)]">
      {/* conversations */}
      <aside
        className={cn(
          "min-h-0 w-full flex-col border-border md:flex md:w-[320px] md:shrink-0 md:border-r",
          paneOpen ? "hidden" : "flex",
        )}
        aria-label="Conversations"
      >
        <div className="flex h-14 shrink-0 items-center gap-2 px-4">
          <h2 className="text-[15px] font-medium tracking-[-0.01em] text-fg">
            {picking ? "New message" : "Inbox"}
          </h2>
          {!picking && counts.unread ? (
            <span className="num text-xs text-accent-text">{counts.unread} unread</span>
          ) : null}
          {canWrite ? (
            <Button
              variant="ghost"
              size="icon-sm"
              className="ml-auto"
              aria-label={picking ? "Cancel new message" : "New message"}
              title={picking ? "Cancel" : "New message"}
              onClick={() => {
                setPicking((p) => !p);
                setQ("");
              }}
            >
              {picking ? <X /> : <Pencil />}
            </Button>
          ) : null}
        </div>
        <div className="px-3">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-subtle" />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={picking ? "Find a partner" : "Search messages"}
              aria-label={picking ? "Find a partner" : "Search messages"}
              // biome-ignore lint/a11y/noAutofocus: the field is the whole point of the new-message mode
              autoFocus={picking}
              className="h-8 w-full rounded-sm border border-border bg-surface-2 pr-2.5 pl-8 text-[13px] text-fg placeholder:text-subtle hover:border-border-strong focus:border-border-strong focus:bg-surface dark:focus:bg-surface-2"
            />
          </div>
        </div>

        {picking ? (
          <ul className="mt-2 min-h-0 flex-1 overflow-y-auto px-2 pb-2">
            {pickable.map((p) => (
              <li key={p.id}>
                <Link
                  href={`${base}?partner=${p.id}`}
                  onClick={() => setPicking(false)}
                  className="flex h-10 items-center gap-2.5 rounded-md px-2 text-[13px] text-fg hover:bg-surface-2"
                >
                  <Avatar name={p.name} size={24} />
                  <span className="truncate">{p.name}</span>
                </Link>
              </li>
            ))}
            {pickable.length === 0 ? (
              <li className="px-3 py-8 text-center text-[13px] text-subtle">No active partner matches</li>
            ) : null}
          </ul>
        ) : (
          <>
            <div className="flex gap-1 px-3 pt-3 pb-2" role="group" aria-label="Filter conversations">
              {(
                [
                  ["all", "All"],
                  ["unread", "Unread"],
                  ["reply", "Needs reply"],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={filter === k}
                  onClick={() => setFilter(k)}
                  className={cn(
                    "inline-flex h-7 items-center gap-1.5 rounded-sm px-2.5 text-xs font-medium",
                    filter === k ? "bg-surface-3 text-fg" : "text-muted hover:bg-surface-2 hover:text-fg",
                  )}
                >
                  {label}
                  <span className="num text-subtle">{counts[k]}</span>
                </button>
              ))}
            </div>
            <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
              <li className="mb-1 border-b border-border pb-1">
                <Link
                  href={`${base}?view=announcements`}
                  aria-current={!selected && paneOpen ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-2.5 rounded-md px-2 py-2.5",
                    !selected ? "md:bg-surface-3" : "hover:bg-surface-2",
                  )}
                >
                  <span className="flex size-8 shrink-0 items-center justify-center text-muted">
                    <Megaphone className="size-[18px]" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-medium text-fg">Announcements</span>
                    <span className="block truncate text-xs leading-5 text-subtle">
                      To all {partners.length} active partners
                    </span>
                  </span>
                  <span className="num shrink-0 text-xs text-subtle">{announcements}</span>
                </Link>
              </li>
              {shown.map((c) => (
                <li key={c.partnerId}>
                  <Link
                    href={`${base}?partner=${c.partnerId}`}
                    aria-current={selected === c.partnerId ? "page" : undefined}
                    className={cn(
                      "flex gap-2.5 rounded-md px-2 py-2.5",
                      selected === c.partnerId ? "bg-surface-3" : "hover:bg-surface-2",
                    )}
                  >
                    <Avatar name={c.partnerName} size={32} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2">
                        <span
                          className={cn(
                            "flex-1 truncate text-[13px] text-fg",
                            c.unread ? "font-medium" : "font-normal",
                          )}
                        >
                          {c.partnerName}
                        </span>
                        <time
                          suppressHydrationWarning
                          className={cn(
                            "num shrink-0 text-[11px]",
                            c.unread ? "font-medium text-accent-text" : "text-subtle",
                          )}
                        >
                          {ago(c.createdAt)}
                        </time>
                      </span>
                      <span className="flex items-center gap-2">
                        <span
                          className={cn(
                            "block flex-1 truncate text-xs leading-5",
                            c.unread ? "text-fg" : "text-subtle",
                          )}
                        >
                          {c.fromPartner ? "" : "You: "}
                          {c.preview}
                        </span>
                        {c.unread ? <span className="sr-only">Unread</span> : null}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
              {shown.length === 0 ? (
                <li className="px-4 py-10 text-center">
                  <p className="text-[13px] font-medium text-fg">
                    {convos.length ? "Nothing here" : "No conversations yet"}
                  </p>
                  <p className="mx-auto mt-1 max-w-[30ch] text-xs leading-5 text-subtle">
                    {convos.length
                      ? needle
                        ? "No conversation matches your search."
                        : "Every conversation in this view is handled."
                      : "When a partner writes from their portal, the conversation shows up here."}
                  </p>
                </li>
              ) : null}
            </ul>
          </>
        )}
      </aside>

      {/* thread */}
      <section
        className={cn("min-h-0 min-w-0 flex-1 flex-col", paneOpen ? "flex" : "hidden md:flex")}
        aria-label={context ? `Conversation with ${context.name}` : "Announcements"}
      >
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-3 md:px-5">
          <Button asChild variant="ghost" size="icon-sm" className="md:hidden">
            <Link href={base} aria-label="Back to inbox">
              <ArrowLeft />
            </Link>
          </Button>
          {context ? (
            <>
              <Avatar name={context.name} size={30} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[14px] font-medium text-fg">{context.name}</span>
                  <StatusBadge
                    status={context.status === "approved" ? "active" : context.status}
                    className="xl:hidden"
                  />
                </div>
                <div className="truncate text-xs text-subtle">{context.email}</div>
              </div>
              <Button asChild variant="secondary" size="sm" className="xl:hidden">
                <Link href={`/app/${programId}/partners/${context.id}`}>Profile</Link>
              </Button>
            </>
          ) : (
            <>
              <Megaphone className="size-[18px] shrink-0 text-muted" aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] font-medium text-fg">Announcements</div>
                <div className="truncate text-xs text-subtle">
                  Sent to {partners.length} active partners by email and in their portal
                </div>
              </div>
            </>
          )}
        </header>

        {/* column-reverse keeps the newest message in view without a scroll script */}
        <div className="flex min-h-0 flex-1 flex-col-reverse overflow-y-auto">
          <div className="mx-auto w-full max-w-[760px] px-4 py-6 md:px-6">
            {ordered.length ? (
              <ol className="flex flex-col gap-4">
                {groups(ordered).map((g, i, all) => {
                  const first = g[0]!;
                  const prev = all[i - 1]?.[0];
                  const newDay =
                    !prev ||
                    new Date(prev.createdAt).toDateString() !== new Date(first.createdAt).toDateString();
                  const mine = !first.fromPartner;
                  const who = mine ? "You" : (first.partnerName ?? "Partner");
                  return (
                    <Fragment key={first.id}>
                      {newDay ? (
                        <li className="flex items-center gap-3 py-1 text-xs text-subtle">
                          <span className="h-px flex-1 bg-border" />
                          <span suppressHydrationWarning>{dayLabel(first.createdAt)}</span>
                          <span className="h-px flex-1 bg-border" />
                        </li>
                      ) : null}
                      {context ? (
                        <li className={cn("flex gap-2.5", mine && "flex-row-reverse")}>
                          {mine ? null : <Avatar name={who} size={28} className="mt-5" />}
                          <div
                            className={cn(
                              "flex min-w-0 max-w-[min(560px,85%)] flex-col gap-1",
                              mine && "items-end",
                            )}
                          >
                            <div className="flex items-baseline gap-2 px-1 text-xs">
                              <span className="font-medium text-fg">{who}</span>
                              <time suppressHydrationWarning className="num text-subtle">
                                {time(first.createdAt)}
                              </time>
                            </div>
                            {g.map((m) => (
                              <p
                                key={m.id}
                                className={cn(
                                  "rounded-lg px-3.5 py-2 text-[14px] leading-6 [overflow-wrap:anywhere] whitespace-pre-wrap text-fg",
                                  mine ? "bg-accent-soft" : "bg-surface-2 dark:bg-surface-3",
                                )}
                              >
                                {m.body}
                              </p>
                            ))}
                          </div>
                        </li>
                      ) : (
                        g.map((m) => (
                          <li key={m.id}>
                            <article className="rounded-lg border border-border p-4">
                              <div className="flex items-baseline gap-2 text-xs text-subtle">
                                <span className="font-medium text-fg">You</span>
                                <span aria-hidden>·</span>
                                <time suppressHydrationWarning className="num">
                                  {time(m.createdAt)}
                                </time>
                              </div>
                              {m.subject ? (
                                <h3 className="mt-2 text-[15px] font-medium tracking-[-0.01em] text-fg">
                                  {m.subject}
                                </h3>
                              ) : null}
                              <p className="mt-1 text-[14px] leading-6 [overflow-wrap:anywhere] whitespace-pre-wrap text-fg/90">
                                {m.body}
                              </p>
                            </article>
                          </li>
                        ))
                      )}
                    </Fragment>
                  );
                })}
              </ol>
            ) : (
              <EmptyState
                icon={context ? MessageSquare : Inbox}
                mascot="thinking"
                title={context ? `Write to ${context.name}` : "No announcements yet"}
                description={
                  context
                    ? "Your message lands in their email and their portal. Their replies show up here."
                    : "Tell every active partner about a campaign, a payout change or a launch."
                }
              />
            )}
          </div>
        </div>

        {canWrite ? (
          <Composer
            programId={programId}
            partnerId={context?.id ?? null}
            name={context?.name ?? null}
            audience={partners.length}
          />
        ) : (
          <p className="shrink-0 border-t border-border px-5 py-3 text-center text-xs text-subtle">
            Your role can read messages. An admin can reply.
          </p>
        )}
      </section>

      {context ? <PartnerPanel programId={programId} p={context} /> : null}
    </div>
  );
}

function Composer({
  programId,
  partnerId,
  name,
  audience,
}: {
  programId: string;
  partnerId: string | null;
  name: string | null;
  audience: number;
}) {
  const { pending, run } = useAction();
  const form = useRef<HTMLFormElement>(null);
  return (
    <form
      ref={form}
      className="shrink-0 px-3 pb-3 md:px-6 md:pb-5"
      action={(f) =>
        run(
          () =>
            sendMessageAction(programId, {
              partnerId,
              subject: String(f.get("subject") || "") || undefined,
              body: String(f.get("body")),
            }),
          partnerId ? "Message sent" : "Announcement sent",
          () => form.current?.reset(),
        )
      }
    >
      <div className="mx-auto max-w-[712px] rounded-lg border border-border-strong bg-surface focus-within:border-fg/40 dark:bg-surface-2">
        {partnerId ? null : (
          <input
            name="subject"
            placeholder="Subject"
            aria-label="Subject"
            maxLength={200}
            className="block h-10 w-full border-b border-border bg-transparent px-3.5 text-[14px] font-medium text-fg placeholder:font-normal placeholder:text-subtle"
          />
        )}
        <textarea
          name="body"
          required
          maxLength={8000}
          rows={2}
          placeholder={partnerId ? `Message ${name ?? "this partner"}` : "Write an announcement"}
          aria-label="Message"
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") form.current?.requestSubmit();
          }}
          className="block max-h-56 min-h-14 w-full resize-none bg-transparent px-3.5 pt-3 pb-1 text-[14px] leading-6 text-fg [field-sizing:content] placeholder:text-subtle"
        />
        <div className="flex items-center gap-3 px-2.5 pt-1 pb-2.5 pl-3.5">
          <span className="hidden min-w-0 truncate text-xs text-subtle sm:block">
            {partnerId ? "Delivered by email and in their portal" : `Goes to ${audience} partners by email`}
          </span>
          <span className="ml-auto hidden items-center gap-1 text-xs text-subtle md:flex">
            <Kbd>⌘</Kbd>
            <Kbd>↵</Kbd>
          </span>
          <Button type="submit" variant="primary" size="sm" loading={pending} className="ml-auto md:ml-0">
            {partnerId ? <Send /> : <Megaphone />}
            {partnerId ? "Send" : "Announce"}
          </Button>
        </div>
      </div>
    </form>
  );
}

function PartnerPanel({ programId, p }: { programId: string; p: Context }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(p.link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Could not copy the link");
    }
  };
  return (
    <aside
      aria-label="About this partner"
      className="hidden min-h-0 w-[300px] shrink-0 flex-col gap-3 overflow-y-auto border-l border-border bg-surface-2 p-3 xl:flex dark:bg-bg"
    >
      <section className="rounded-lg bg-surface p-4">
        <div className="flex items-start gap-3">
          <Avatar name={p.name} size={40} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[14px] font-medium text-fg">{p.name}</div>
            <div className="mt-1">
              <StatusBadge status={p.status === "approved" ? "active" : p.status} />
            </div>
          </div>
        </div>
        <ul className="mt-4 flex flex-col gap-2 text-[13px] text-muted">
          <li className="flex items-center gap-2">
            <Mail className="size-4 shrink-0 text-subtle" aria-hidden />
            <a href={`mailto:${p.email}`} className="truncate hover:text-fg">
              {p.email}
            </a>
          </li>
          {p.website ? (
            <li className="flex items-center gap-2">
              <Globe className="size-4 shrink-0 text-subtle" aria-hidden />
              <a
                href={/^https?:\/\//.test(p.website) ? p.website : `https://${p.website}`}
                target="_blank"
                rel="noreferrer"
                className="truncate hover:text-fg"
              >
                {p.website.replace(/^https?:\/\//, "")}
              </a>
            </li>
          ) : null}
          <li className="text-xs text-subtle">
            Joined {p.joined}
            {p.country ? ` · ${p.country}` : ""}
          </li>
        </ul>
      </section>

      <section className="rounded-lg bg-surface p-4">
        <h3 className="mb-2 text-xs font-medium text-subtle">Earnings</h3>
        <div className="flex flex-col gap-1.5">
          {p.money.map((x) => (
            <LedgerLine key={x.label} label={x.label} value={x.value} strong={x.label === "Owed"} />
          ))}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 border-t border-border pt-3">
          <div>
            <div className="text-xs text-subtle">Revenue</div>
            <div className="num mt-0.5 text-[15px] font-medium text-fg">{p.revenue}</div>
          </div>
          <div>
            <div className="text-xs text-subtle">Customers</div>
            <div className="num mt-0.5 text-[15px] font-medium text-fg">{p.customers}</div>
          </div>
        </div>
      </section>

      <section className="rounded-lg bg-surface p-4">
        <h3 className="mb-2 text-xs font-medium text-subtle">Referral link</h3>
        <div className="flex items-center gap-1 rounded-sm bg-surface-2 py-1 pr-1 pl-2.5 dark:bg-surface-3">
          <span className="stamp min-w-0 flex-1 truncate text-fg" title={p.link}>
            {p.link.replace(/^https?:\/\//, "")}
          </span>
          <Button variant="ghost" size="icon-sm" onClick={copy} aria-label="Copy referral link">
            {copied ? <Check /> : <Copy />}
          </Button>
        </div>
      </section>

      <Button asChild variant="secondary" className="w-full">
        <Link href={`/app/${programId}/partners/${p.id}`}>Open partner profile</Link>
      </Button>
    </aside>
  );
}
