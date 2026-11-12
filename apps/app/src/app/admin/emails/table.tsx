"use client";

import { Badge, type BadgeTone, Button, Dialog, DialogContent, Skeleton } from "@openpromoter/ui";
import { Mail } from "@openpromoter/ui/icons";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { type Column, DataTable, type Tab } from "@/components/data-table";
import { emailPreviewAction } from "./actions";

type Row = {
  id: string;
  to: string;
  subject: string;
  program: string | null;
  workspaceId: string | null;
  status: string;
  detail: string | null;
  messageId: string | null;
  updatedAt: string;
  at: string;
};

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

const TONE: Record<string, BadgeTone> = {
  delivered: "success",
  sent: "neutral",
  bounced: "danger",
  complained: "danger",
  failed: "danger",
  not_sent: "warning",
};
const LABEL: Record<string, string> = {
  delivered: "Delivered",
  sent: "Sent",
  bounced: "Bounced",
  complained: "Marked as spam",
  failed: "Failed",
  not_sent: "Not sent",
};

export function EmailsTable(props: {
  rows: Row[];
  total: number;
  page: number;
  pageSize: number;
  tabs: Tab[];
}) {
  const columns: Column<Row>[] = [
    {
      key: "at",
      header: "Sent",
      mobile: "meta",
      render: (r) => (
        <span className="text-muted">
          {new Date(r.at).toLocaleString("en-US", {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })}
        </span>
      ),
    },
    {
      key: "to",
      header: "To",
      mobile: "title",
      render: (r) => (
        <span className="block max-w-80 min-w-0">
          <span className="block truncate font-medium text-fg">{r.to}</span>
          <span className="block truncate text-xs text-subtle">{r.subject}</span>
        </span>
      ),
    },
    {
      key: "program",
      header: "Program",
      render: (r) => <span className="text-muted">{r.program ?? "OpenPromoter"}</span>,
    },
    {
      key: "status",
      header: "Status",
      mobile: "badge",
      render: (r) => (
        <span className="flex min-w-0 items-center gap-2">
          <Badge tone={TONE[r.status] ?? "neutral"}>{LABEL[r.status] ?? r.status}</Badge>
          {r.detail ? (
            <span className="max-w-72 truncate text-xs text-subtle" title={r.detail}>
              {r.detail}
            </span>
          ) : null}
        </span>
      ),
    },
  ];
  // a row opens what was recorded about that email. The id lives in the URL through the History API,
  // so it opens and closes at once with no server round trip and can still be linked.
  const path = usePathname();
  const sp = useSearchParams();
  const href = (open: string | null) => {
    const q = new URLSearchParams(sp);
    if (open) q.set("open", open);
    else q.delete("open");
    const s = q.toString();
    return s ? `${path}?${s}` : path;
  };
  const open = props.rows.find((r) => r.id === sp.get("open"));
  // the copy is fetched when a row opens: undefined while loading, null when none was kept
  const openId = open?.id;
  const [preview, setPreview] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    setPreview(undefined);
    if (!openId) return;
    let live = true;
    emailPreviewAction(openId).then(
      (h) => live && setPreview(h),
      () => live && setPreview(null),
    );
    return () => {
      live = false;
    };
  }, [openId]);
  const facts: [string, string][] = open
    ? [
        ["To", open.to],
        ["Subject", open.subject],
        ["From program", open.program ?? "OpenPromoter"],
        ["Sent", when(open.at)],
        ["Last report", when(open.updatedAt)],
        ["Provider note", open.detail || "None"],
        ["Message id", open.messageId ?? "None"],
      ]
    : [];
  return (
    <>
      <DataTable
        {...props}
        columns={columns}
        rowHref={(r) => href(r.id)}
        onRowOpen={(r) => window.history.pushState(null, "", href(r.id))}
        searchPlaceholder="Search by email address"
        empty={{ icon: Mail, title: "No emails match", description: "Emails are kept for 30 days." }}
      />
      <Dialog
        open={!!open}
        onOpenChange={(o: boolean) => !o && window.history.replaceState(null, "", href(null))}
      >
        {open ? (
          <DialogContent
            side="right"
            className="max-w-[680px]"
            title={open.subject}
            description={
              <Badge tone={TONE[open.status] ?? "neutral"}>{LABEL[open.status] ?? open.status}</Badge>
            }
          >
            <dl className="flex flex-col gap-3 text-[13px]">
              {facts.map(([k, v]) => (
                <div key={k} className="grid grid-cols-[110px_1fr] gap-3">
                  <dt className="text-muted">{k}</dt>
                  <dd
                    className={`min-w-0 break-words text-fg ${k === "Message id" && v !== "None" ? "font-mono text-xs break-all" : ""}`}
                  >
                    {v}
                  </dd>
                </div>
              ))}
            </dl>
            <div className="mt-5 border-t border-border pt-4">
              <p className="text-[13px] font-medium text-fg">Preview</p>
              <p className="mt-1 text-[13px] leading-5 text-muted">
                This is the email as it was sent with every link removed.
              </p>
              {preview === undefined ? (
                <Skeleton className="mt-3 h-[420px] w-full rounded-lg" />
              ) : preview ? (
                // sandboxed: no scripts, no forms and no navigation can run from the stored copy
                <iframe
                  title={`Preview of ${open.subject}`}
                  sandbox=""
                  srcDoc={preview}
                  className="mt-3 h-[520px] w-full rounded-lg border border-border bg-white"
                />
              ) : (
                <p className="mt-3 rounded-lg border border-dashed border-border-strong px-3 py-2.5 text-[13px] text-muted">
                  No copy was kept for this email. Copies are kept for emails sent from now on.
                </p>
              )}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button asChild variant="secondary">
                <Link href={`/admin/emails?q=${encodeURIComponent(open.to)}`}>
                  All emails to this address
                </Link>
              </Button>
              {open.workspaceId ? (
                <Button asChild variant="secondary">
                  <Link href={`/admin/w/${open.workspaceId}`}>Open the workspace</Link>
                </Button>
              ) : null}
            </div>
          </DialogContent>
        ) : null}
      </Dialog>
    </>
  );
}
