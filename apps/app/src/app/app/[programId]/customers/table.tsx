"use client";

import { StatusBadge } from "@openpromoter/ui";
import { UsersRound } from "@openpromoter/ui/icons";
import Link from "next/link";
import { type Column, DataTable, type Tab } from "@/components/data-table";
import { formatMoney } from "@/lib/money";

type Row = {
  id: string;
  email: string | null;
  name: string | null;
  status: string;
  via: string;
  revenue: number;
  mrr: number;
  createdAt: string;
  convertedAt: string | null;
  partnerId: string;
  partnerName: string;
  customerId: string | null;
};

export function CustomersTable({
  programId,
  currency,
  rows,
  total,
  page,
  pageSize,
  tabs,
}: {
  programId: string;
  currency: string;
  rows: Row[];
  total: number;
  page: number;
  pageSize: number;
  tabs: Tab[];
}) {
  const m = (n: number) => formatMoney(n, currency);
  const d = (s: string | null) =>
    s ? new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "–";
  const columns: Column<Row>[] = [
    {
      key: "who",
      header: "Customer",
      mobile: "title",
      render: (r) => (
        <span className="block max-w-64 truncate font-medium">
          {r.email ?? r.name ?? r.customerId ?? r.id}
        </span>
      ),
    },
    { key: "status", header: "Status", mobile: "badge", render: (r) => <StatusBadge status={r.status} /> },
    {
      key: "partner",
      header: "Partner",
      mobile: "meta",
      render: (r) => (
        <Link
          href={`/app/${programId}/partners/${r.partnerId}`}
          className="text-muted hover:text-fg hover:underline"
        >
          {r.partnerName}
        </Link>
      ),
    },
    {
      key: "via",
      header: "Source",
      mobile: "meta",
      render: (r) => <span className="text-muted capitalize">{r.via}</span>,
    },
    { key: "mrr", header: "MRR", align: "right", sortable: true, render: (r) => (r.mrr ? m(r.mrr) : "–") },
    {
      key: "revenue",
      header: "Revenue",
      align: "right",
      sortable: true,
      mobile: "amount",
      render: (r) => m(r.revenue),
    },
    {
      key: "createdAt",
      header: "Signed up",
      sortable: true,
      mobile: "meta",
      render: (r) => <span className="text-muted">{d(r.createdAt)}</span>,
    },
    {
      key: "convertedAt",
      header: "First paid",
      render: (r) => <span className="text-muted">{d(r.convertedAt)}</span>,
    },
  ];
  return (
    <DataTable
      rows={rows}
      columns={columns}
      total={total}
      page={page}
      pageSize={pageSize}
      tabs={tabs}
      searchPlaceholder="Search customer or partner"
      exportHref={`/api/export/customers?program=${programId}`}
      empty={{
        icon: UsersRound,
        title: "No referred customers yet",
        description: "When someone signs up or pays through a partner's link or code, they show up here.",
      }}
    />
  );
}
