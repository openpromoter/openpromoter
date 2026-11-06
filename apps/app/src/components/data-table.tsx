"use client";

import { Button, Card, Checkbox, cn, EmptyState, Input, Kbd } from "@openpromoter/ui";
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Download,
  type LucideIcon,
  Search,
  SearchX,
  X,
} from "@openpromoter/ui/icons";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { formatNumber } from "@/lib/money";
import type { ActionResult } from "@/server/context";

export interface Column<T> {
  key: string;
  header: string;
  align?: "left" | "right";
  sortable?: boolean;
  className?: string;
  render: (row: T) => React.ReactNode;
  /** Shown in the mobile card: "title" (row 1 left), "badge" (row 1 right), "amount" (row 2 right), "meta" (row 3) */
  mobile?: "title" | "badge" | "amount" | "meta";
}

export interface BulkAction {
  label: string;
  icon?: LucideIcon;
  danger?: boolean;
  confirm?: string;
  run: (ids: string[]) => Promise<ActionResult<unknown>>;
}

export interface Tab {
  label: string;
  query: string;
  count?: number;
}

export function DataTable<T extends { id: string }>({
  rows,
  columns,
  total,
  page,
  pageSize,
  tabs,
  bulk,
  rowHref,
  searchPlaceholder = "Search",
  empty,
  exportHref,
  toolbar,
}: {
  rows: T[];
  columns: Column<T>[];
  total: number;
  page: number;
  pageSize: number;
  tabs?: Tab[];
  bulk?: BulkAction[];
  rowHref?: (row: T) => string;
  searchPlaceholder?: string;
  empty: { icon: LucideIcon; title: string; description?: string; action?: React.ReactNode };
  exportHref?: string;
  toolbar?: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [q, setQ] = useState(sp.get("q") ?? "");
  const [pending, start] = useTransition();
  const searchRef = useRef<HTMLInputElement>(null);
  const filtered = !!(sp.get("q") || sp.get("status") || sp.get("view"));

  const setParams = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) v == null || v === "" ? next.delete(k) : next.set(k, v);
    if (!("page" in patch)) next.delete("page");
    start(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  };

  useEffect(() => {
    const t = setTimeout(() => {
      if ((sp.get("q") ?? "") !== q) setParams({ q });
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line
  }, [q, setParams, sp.get]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === "/" && !["INPUT", "TEXTAREA"].includes(t.tagName)) {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === "Escape" && selected.size) setSelected(new Set());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected.size]);

  useEffect(() => setSelected(new Set()), []);

  const sort = sp.get("sort") ?? "";
  const [sortKey, sortDir] = sort.split(":");
  const allChecked = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const runBulk = (a: BulkAction) => {
    if (a.confirm && !window.confirm(a.confirm)) return;
    start(async () => {
      const res = await a.run([...selected]);
      if (res.ok) {
        toast.success(res.message ?? `${a.label}: done`);
        setSelected(new Set());
        router.refresh();
      } else toast.error(res.error);
    });
  };

  const mobileCols = useMemo(
    () => ({
      title: columns.find((c) => c.mobile === "title") ?? columns[0],
      badge: columns.find((c) => c.mobile === "badge"),
      amount: columns.find((c) => c.mobile === "amount"),
      meta: columns.filter((c) => c.mobile === "meta"),
    }),
    [columns],
  );

  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const activeTab = tabs?.find((t) => {
    const tq = new URLSearchParams(t.query);
    return (
      [...tq.entries()].every(([k, v]) => sp.get(k) === v) &&
      [...new URLSearchParams(sp.toString()).keys()]
        .filter((k) => !["q", "page", "sort"].includes(k))
        .every((k) => tq.has(k))
    );
  });

  return (
    <div aria-busy={pending}>
      <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        {tabs?.length ? (
          <div
            role="tablist"
            className="flex gap-0.5 overflow-x-auto rounded-lg bg-surface-2 p-0.5 ring-1 ring-border ring-inset"
          >
            {tabs.map((t) => (
              <button
                key={t.label}
                role="tab"
                type="button"
                aria-selected={activeTab === t}
                onClick={() => {
                  const next = new URLSearchParams(t.query);
                  if (q) next.set("q", q);
                  start(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
                }}
                className={cn(
                  "flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium transition-colors",
                  activeTab === t ? "bg-surface text-fg dark:bg-surface-3" : "text-subtle hover:text-fg",
                )}
              >
                {t.label}
                {t.count != null ? (
                  <span className="num text-xs font-normal text-subtle">{formatNumber(t.count)}</span>
                ) : null}
              </button>
            ))}
          </div>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2">
          <div className="relative flex-1 lg:w-64 lg:flex-none">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-subtle" />
            <Input
              ref={searchRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              className="pr-8 pl-8"
            />
            <Kbd className="absolute top-1/2 right-1.5 -translate-y-1/2">/</Kbd>
          </div>
          {toolbar}
          {exportHref ? (
            <Button asChild variant="secondary" size="md">
              <a href={`${exportHref}${exportHref.includes("?") ? "&" : "?"}${sp.toString()}`}>
                <Download /> <span className="hidden sm:inline">Export</span>
              </a>
            </Button>
          ) : null}
        </div>
      </div>

      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          filtered ? (
            <EmptyState
              icon={SearchX}
              title="No results for these filters"
              description="Try a different search or tab."
              action={
                <Button
                  variant="secondary"
                  onClick={() => {
                    setQ("");
                    start(() => router.replace(pathname));
                  }}
                >
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState {...empty} />
          )
        ) : (
          <>
            <div className="hidden md:block">
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr>
                    {bulk?.length ? (
                      <th className="sticky top-0 h-10 w-10 border-b border-border bg-surface-2 pl-5">
                        <Checkbox
                          checked={allChecked ? true : selected.size ? "indeterminate" : false}
                          onCheckedChange={() =>
                            setSelected(allChecked ? new Set() : new Set(rows.map((r) => r.id)))
                          }
                          aria-label="Select all rows"
                        />
                      </th>
                    ) : null}
                    {columns.map((c, i) => {
                      const dir = sortKey === c.key ? sortDir : null;
                      return (
                        <th
                          key={c.key}
                          aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : undefined}
                          className={cn(
                            "sticky top-0 h-10 border-b border-border bg-surface-2 px-3 text-xs font-medium whitespace-nowrap text-subtle last:pr-5",
                            !bulk?.length && i === 0 && "pl-5",
                            c.align === "right" ? "text-right" : "text-left",
                            c.className,
                          )}
                        >
                          {c.sortable ? (
                            <button
                              type="button"
                              className={cn(
                                "inline-flex items-center gap-1 hover:text-fg",
                                c.align === "right" && "flex-row-reverse",
                              )}
                              onClick={() =>
                                setParams({ sort: `${c.key}:${dir === "desc" ? "asc" : "desc"}` })
                              }
                            >
                              {c.header}
                              {dir === "asc" ? (
                                <ArrowUp className="size-3" />
                              ) : dir === "desc" ? (
                                <ArrowDown className="size-3" />
                              ) : null}
                            </button>
                          ) : (
                            c.header
                          )}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.id}
                      data-selected={selected.has(r.id) || undefined}
                      className={cn(
                        "group transition-colors hover:bg-surface-2/70 data-[selected]:bg-accent-soft/50",
                        rowHref && "cursor-pointer",
                      )}
                      onClick={(e) => {
                        if (!rowHref || (e.target as HTMLElement).closest("button,a,input,[role=checkbox]"))
                          return;
                        router.push(rowHref(r));
                      }}
                    >
                      {bulk?.length ? (
                        <td className="h-12 w-10 border-b border-border pl-5">
                          <Checkbox
                            checked={selected.has(r.id)}
                            onCheckedChange={() => toggle(r.id)}
                            aria-label="Select row"
                          />
                        </td>
                      ) : null}
                      {columns.map((c, i) => (
                        <td
                          key={c.key}
                          className={cn(
                            "h-12 border-b border-border px-3 text-fg last:pr-5",
                            !bulk?.length && i === 0 && "pl-5",
                            c.align === "right" && "num text-right",
                            c.className,
                          )}
                        >
                          {i === 0 && rowHref ? (
                            <Link href={rowHref(r)} className="outline-none focus-visible:underline">
                              {c.render(r)}
                            </Link>
                          ) : (
                            c.render(r)
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="divide-y divide-border md:hidden">
              {rows.map((r) => {
                const inner = (
                  <div className="flex min-h-16 flex-col gap-1 px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0 truncate font-medium text-fg">
                        {mobileCols.title?.render(r)}
                      </div>
                      {mobileCols.badge ? <div className="shrink-0">{mobileCols.badge.render(r)}</div> : null}
                    </div>
                    {mobileCols.amount ? (
                      <div className="num text-right text-fg">{mobileCols.amount.render(r)}</div>
                    ) : null}
                    {mobileCols.meta.length ? (
                      <div className="flex flex-wrap gap-x-3 text-xs text-subtle">
                        {mobileCols.meta.map((m) => (
                          <span key={m.key}>{m.render(r)}</span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
                return (
                  <li key={r.id} className="flex items-start">
                    {bulk?.length ? (
                      <div className="py-4 pl-4">
                        <Checkbox
                          checked={selected.has(r.id)}
                          onCheckedChange={() => toggle(r.id)}
                          aria-label="Select row"
                        />
                      </div>
                    ) : null}
                    <div className="min-w-0 flex-1">
                      {rowHref ? <Link href={rowHref(r)}>{inner}</Link> : inner}
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
        {total > 0 ? (
          <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-2.5 text-xs text-muted">
            <span className="num">
              {from.toLocaleString()}–{to.toLocaleString()} of {total.toLocaleString()}
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Previous page"
                disabled={page <= 1}
                onClick={() => setParams({ page: String(page - 1) })}
              >
                <ChevronLeft />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Next page"
                disabled={to >= total}
                onClick={() => setParams({ page: String(page + 1) })}
              >
                <ChevronRight />
              </Button>
            </div>
          </div>
        ) : null}
      </Card>

      {selected.size > 0 && bulk?.length ? (
        <div
          role="toolbar"
          aria-label="Bulk actions"
          className="fixed bottom-[calc(72px+env(safe-area-inset-bottom))] left-1/2 z-40 flex -translate-x-1/2 items-center gap-1 rounded-lg border border-border bg-surface p-1.5 shadow-lg md:bottom-6"
        >
          <span className="num px-2 text-[13px] text-fg">{selected.size} selected</span>
          {bulk.map((a) => (
            <Button
              key={a.label}
              size="sm"
              variant={a.danger ? "ghost" : "secondary"}
              className={a.danger ? "text-danger" : undefined}
              loading={pending}
              onClick={() => runBulk(a)}
            >
              {a.icon ? <a.icon /> : null}
              {a.label}
            </Button>
          ))}
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Clear selection"
            onClick={() => setSelected(new Set())}
          >
            <X />
          </Button>
        </div>
      ) : null}
    </div>
  );
}
