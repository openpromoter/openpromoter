"use client";

import {
  Avatar,
  Badge,
  Button,
  Card,
  Checkbox,
  cn,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTrigger,
  EmptyState,
  Field,
  Input,
  StatusBadge,
  Textarea,
} from "@openpromoter/ui";
import {
  Check,
  Copy,
  ExternalLink,
  Globe,
  Mail,
  Plus,
  Search,
  Sparkles,
  UserPlus,
  Users,
} from "@openpromoter/ui/icons";
import { useState } from "react";
import { PageHeader } from "@/components/page";
import { useAction } from "@/components/use-action";
import { formatNumber } from "@/lib/money";
import {
  addProspectAction,
  findProspectsAction,
  markInvitedAction,
  personaliseAction,
  updateProspectAction,
} from "../growth-actions";

const STEPS = [
  ["Find people", "Rank your Stripe customers, search for creators or add someone you know."],
  ["Review each draft", "Every invite is written for that person. Edit it before it goes out."],
  ["Send from your email", "Each invite opens in Gmail or your mail app, so replies come straight to you."],
] as const;

type P = {
  id: string;
  source: string;
  name: string;
  email: string | null;
  url: string | null;
  reason: string;
  score: number;
  subject: string;
  body: string;
  status: string;
  sentAt: string | null;
  /** apply link carrying this prospect's invite id */
  inviteUrl: string;
};

/** The draft as the founder will send it, with the join link at the end. */
const compose = (subject: string, body: string, url: string) => ({
  subject,
  body: `${body.trim()}\n\nJoin here: ${url}`,
});

export function RecruiterView({
  programId,
  canWrite,
  webSearch,
  rows,
  description,
}: {
  description: string;
  programId: string;
  canWrite: boolean;
  webSearch: boolean;
  rows: P[];
}) {
  const { pending, run } = useAction();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<"new" | "sent" | "all">("new");
  const [edit, setEdit] = useState<P | null>(null);
  const [niche, setNiche] = useState("");
  const shown = rows.filter((r) =>
    tab === "new"
      ? r.status === "new" || r.status === "approved"
      : tab === "sent"
        ? ["sent", "followed_up", "joined"].includes(r.status)
        : r.status !== "dismissed",
  );
  const toggle = (id: string) =>
    setSel((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  const counts = {
    new: rows.filter((r) => r.status === "new" || r.status === "approved").length,
    sent: rows.filter((r) => ["sent", "followed_up", "joined"].includes(r.status)).length,
    all: rows.filter((r) => r.status !== "dismissed").length,
  };
  const findCustomers = () =>
    run(
      () => findProspectsAction(programId, "customers"),
      (n) => `${n ?? 0} customers added`,
    );
  return (
    <>
      <PageHeader
        title="Recruiter"
        description={description}
        actions={
          canWrite ? (
            <>
              <AddProspect programId={programId} />
              <Button variant="primary" loading={pending} onClick={findCustomers}>
                <Users /> Find customers to invite
              </Button>
            </>
          ) : null
        }
      />

      <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div
          role="tablist"
          aria-label="Prospects"
          className="flex gap-0.5 self-start overflow-x-auto rounded-lg bg-surface-2 p-0.5 ring-1 ring-border ring-inset"
        >
          {(["new", "sent", "all"] as const).map((t) => (
            <button
              key={t}
              role="tab"
              type="button"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={cn(
                "flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium",
                tab === t ? "bg-surface text-fg dark:bg-surface-3" : "text-subtle hover:text-fg",
              )}
            >
              {t === "new" ? "To invite" : t === "sent" ? "Invited" : "All"}
              <span className="num text-xs font-normal text-subtle">{formatNumber(counts[t])}</span>
            </button>
          ))}
        </div>
        {sel.size && canWrite ? (
          <div className="flex items-center gap-2">
            <span className="text-[13px] text-muted">{sel.size} selected</span>
            <Button loading={pending} onClick={() => run(() => personaliseAction(programId, [...sel]))}>
              <Sparkles /> Personalise
            </Button>
            <Button
              loading={pending}
              onClick={() =>
                run(
                  () => markInvitedAction(programId, [...sel]),
                  (n) => `${n} marked as invited`,
                  () => setSel(new Set()),
                )
              }
            >
              <Check /> Mark as invited
            </Button>
          </div>
        ) : canWrite && webSearch ? (
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              run(
                () => findProspectsAction(programId, "creators", niche),
                (n) => `${n ?? 0} creators found`,
              );
            }}
          >
            <div className="relative flex-1 lg:w-72 lg:flex-none">
              <Globe className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-subtle" />
              <Input
                value={niche}
                onChange={(e) => setNiche(e.target.value)}
                placeholder="Find creators in a niche"
                aria-label="Niche to search for creators"
                className="pl-8"
                required
              />
            </div>
            <Button type="submit" loading={pending}>
              <Search /> Search
            </Button>
          </form>
        ) : null}
      </div>

      <Card className="overflow-hidden">
        {shown.length ? (
          <ul className="divide-y divide-border">
            {shown.map((r) => (
              <li key={r.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                {canWrite && (r.status === "new" || r.status === "approved") ? (
                  <Checkbox
                    checked={sel.has(r.id)}
                    onCheckedChange={() => toggle(r.id)}
                    aria-label={`Select ${r.name}`}
                    className="mt-1.5"
                    disabled={!r.email}
                  />
                ) : (
                  <span className="w-4" />
                )}
                <Avatar name={r.name} size={32} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] font-medium text-fg">{r.name}</span>
                    <Badge tone="neutral">{r.source}</Badge>
                    <StatusBadge status={r.status} />
                  </div>
                  <div className="truncate text-xs text-subtle">
                    {r.email ?? "no email found"}
                    {r.url ? ` · ${r.url}` : ""}
                  </div>
                  <p className="mt-1 text-[13px] text-muted">{r.reason}</p>
                </div>
                {/* phone: fit score and actions move to their own row under the text, which keeps its full width */}
                <div className="flex shrink-0 flex-col items-end gap-2 max-sm:w-full max-sm:flex-row max-sm:items-center max-sm:justify-between max-sm:pl-[72px]">
                  <span className="num text-xs text-muted">fit {r.score}</span>
                  {canWrite && r.status === "new" ? (
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setEdit(r)}>
                        <Mail /> Invite
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          run(
                            () => updateProspectAction(programId, r.id, { status: "dismissed" }),
                            "Dismissed",
                          )
                        }
                      >
                        Dismiss
                      </Button>
                    </div>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <>
            <EmptyState
              className="pb-8"
              icon={UserPlus}
              mascot="refers"
              title={tab === "sent" ? "No invites sent yet" : "No prospects yet"}
              description={
                tab === "sent"
                  ? "Invites you send show up here with their status."
                  : "Start with your paying customers. They already like the product."
              }
            />
            {tab !== "sent" ? (
              <ol className="grid border-t border-border sm:grid-cols-3">
                {STEPS.map(([title, body], i) => (
                  <li
                    key={title}
                    className="flex gap-3 border-border px-5 py-4 not-last:border-b sm:not-last:border-r sm:not-last:border-b-0"
                  >
                    <span className="num flex size-7 shrink-0 items-center justify-center rounded-full border border-border-strong text-[11px] text-subtle">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span>
                      <span className="block text-[13px] font-medium text-fg">{title}</span>
                      <span className="mt-0.5 block text-[13px] text-muted">{body}</span>
                    </span>
                  </li>
                ))}
              </ol>
            ) : null}
          </>
        )}
      </Card>
      {canWrite && !webSearch ? (
        <p className="mt-3 text-xs text-subtle">
          Searching the web for creators needs an Anthropic API key. You can still add people yourself.
        </p>
      ) : null}

      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        {edit ? (
          <DialogContent
            title={`Invite ${edit.name}`}
            description="Edit the draft, then send it from your own email so replies come to you. The join link is added at the end."
          >
            <InviteForm
              p={edit}
              pending={pending}
              onSent={(subject, body) =>
                run(
                  async () => {
                    const u = await updateProspectAction(programId, edit.id, {
                      inviteSubject: subject,
                      inviteBody: body,
                    });
                    if (!u.ok) return u;
                    return markInvitedAction(programId, [edit.id]);
                  },
                  "Marked as invited",
                  () => setEdit(null),
                )
              }
            />
          </DialogContent>
        ) : null}
      </Dialog>
    </>
  );
}

function AddProspect({ programId }: { programId: string }) {
  const [open, setOpen] = useState(false);
  const { pending, run } = useAction();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus /> Add someone
        </Button>
      </DialogTrigger>
      <DialogContent title="Add a prospect">
        <form
          className="flex flex-col gap-4"
          action={(f) =>
            run(
              () =>
                addProspectAction(programId, {
                  name: String(f.get("name")),
                  email: String(f.get("email")),
                  url: String(f.get("url") || ""),
                  reason: String(f.get("reason") || ""),
                }),
              "Added",
              () => setOpen(false),
            )
          }
        >
          <Field label="Name" htmlFor="ap-name">
            <Input id="ap-name" name="name" required />
          </Field>
          <Field label="Email" htmlFor="ap-email">
            <Input id="ap-email" name="email" type="email" required />
          </Field>
          <Field label="Website or channel" htmlFor="ap-url">
            <Input id="ap-url" name="url" />
          </Field>
          <Field label="Why they fit" htmlFor="ap-reason" hint="Used to personalise the invite.">
            <Input id="ap-reason" name="reason" />
          </Field>
          <DialogFooter>
            <Button type="submit" variant="primary" loading={pending}>
              Add
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The invite goes out from the founder's own mailbox. Each button opens (or copies) the draft first, inside
 * the click so the browser allows the new window, then records the invite.
 */
function InviteForm({
  p,
  pending,
  onSent,
}: {
  p: P;
  pending: boolean;
  onSent: (subject: string, body: string) => void;
}) {
  const [subject, setSubject] = useState(p.subject);
  const [body, setBody] = useState(p.body);
  const [copied, setCopied] = useState(false);
  const mail = compose(subject, body, p.inviteUrl);
  const to = p.email ?? "";
  const q = (v: string) => encodeURIComponent(v);
  const gmail = `https://mail.google.com/mail/?view=cm&fs=1&to=${q(to)}&su=${q(mail.subject)}&body=${q(mail.body)}`;
  const mailto = `mailto:${to}?subject=${q(mail.subject)}&body=${q(mail.body)}`;
  return (
    <div className="flex flex-col gap-4">
      <Field label="Subject" htmlFor="pr-sub">
        <Input id="pr-sub" value={subject} onChange={(e) => setSubject(e.target.value)} required />
      </Field>
      <Field label="Message" htmlFor="pr-body">
        <Textarea
          id="pr-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          className="h-56"
          required
        />
      </Field>
      <DialogFooter className="flex-wrap">
        <Button
          type="button"
          disabled={!body.trim()}
          onClick={async () => {
            await navigator.clipboard.writeText(`${mail.subject}\n\n${mail.body}`).catch(() => {});
            setCopied(true);
          }}
        >
          {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy"}
        </Button>
        {copied ? (
          <Button type="button" loading={pending} onClick={() => onSent(subject, body)}>
            <Check /> I sent it
          </Button>
        ) : null}
        <Button
          type="button"
          disabled={!to || !body.trim()}
          onClick={() => {
            window.location.href = mailto;
            onSent(subject, body);
          }}
        >
          <Mail /> Open in mail app
        </Button>
        <Button
          type="button"
          variant="primary"
          disabled={!to || !body.trim()}
          loading={pending}
          onClick={() => {
            window.open(gmail, "_blank", "noopener");
            onSent(subject, body);
          }}
        >
          <ExternalLink /> Open in Gmail
        </Button>
      </DialogFooter>
    </div>
  );
}
