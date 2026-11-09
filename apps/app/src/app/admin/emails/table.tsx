"use client";

import { Badge, type BadgeTone } from "@openpromoter/ui";
import { Mail } from "@openpromoter/ui/icons";
import { type Column, DataTable, type Tab } from "@/components/data-table";

type Row = {
  id: string;
  to: string;
  subject: string;
  program: string | null;
  workspaceId: string | null;
  status: string;
  detail: string | null;
  at: string;
};

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
  return (
    <DataTable
      {...props}
      columns={columns}
      // a row opens its workspace, or every email to that address when it belongs to none
      rowHref={(r) =>
        r.workspaceId ? `/admin/w/${r.workspaceId}` : `/admin/emails?q=${encodeURIComponent(r.to)}`
      }
      searchPlaceholder="Search by email address"
      empty={{ icon: Mail, title: "No emails match", description: "Emails are kept for 30 days." }}
    />
  );
}
