"use client";

import { cn } from "@openpromoter/ui";
import {
  ArrowLeft,
  Coins,
  History,
  type Icon,
  Layers,
  LayoutDashboard,
  Mail,
  Store,
  Users,
  UsersRound,
  Webhook,
} from "@openpromoter/ui/icons";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogoMark } from "@/components/logo";

type Item = [href: string, label: string, icon: Icon, badge?: number];

/**
 * The owner's console, laid out like the founder app: a sidebar of sections on the left, one page per
 * question on the right. Phones get the same sections as a scrolling row under the header.
 */
export function AdminShell({
  email,
  alerts,
  children,
}: {
  email: string;
  /** Counts that need the owner: shown as a red badge on their section. */
  alerts: { emails: number; jobs: number; webhooks: number };
  children: React.ReactNode;
}) {
  const path = usePathname();
  const groups: { label: string; items: Item[] }[] = [
    {
      label: "Business",
      items: [
        ["/admin", "Overview", LayoutDashboard],
        ["/admin/revenue", "Revenue", Coins],
        ["/admin/workspaces", "Workspaces", Store],
      ],
    },
    {
      label: "People",
      items: [
        ["/admin/partners", "Partners", UsersRound],
        ["/admin/users", "Users", Users],
      ],
    },
    {
      label: "Operations",
      items: [
        ["/admin/emails", "Emails", Mail, alerts.emails],
        ["/admin/jobs", "Jobs", Layers, alerts.jobs],
        ["/admin/webhooks", "Webhooks", Webhook, alerts.webhooks],
        ["/admin/activity", "Activity", History],
      ],
    },
  ];
  const items = groups.flatMap((g) => g.items);
  const active = (h: string) =>
    h === "/admin"
      ? path === "/admin"
      : path.startsWith(h) || (h === "/admin/workspaces" && path.startsWith("/admin/w/"));
  const current = items.find(([h]) => active(h));
  return (
    <div className="min-h-dvh bg-canvas lg:grid lg:grid-cols-[232px_1fr]">
      <aside className="sticky top-0 hidden h-dvh flex-col lg:flex" aria-label="Admin">
        <div className="flex h-[60px] items-center gap-2.5 px-5 pt-2">
          <LogoMark />
          <div className="min-w-0">
            <div className="truncate text-[14px] leading-5 font-medium tracking-[-0.01em] text-fg">
              OpenPromoter
            </div>
            <div className="truncate text-xs leading-4 text-subtle">Cloud admin</div>
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 pt-3 pb-4">
          {groups.map((g) => (
            <div key={g.label} className="mt-5 first:mt-1">
              <div className="eyebrow mb-1.5 px-2">{g.label}</div>
              <div className="flex flex-col gap-px">
                {g.items.map(([h, l, I, badge]) => {
                  const on = active(h);
                  return (
                    <Link
                      key={h}
                      href={h}
                      aria-current={on ? "page" : undefined}
                      className={cn(
                        "group flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] transition-colors duration-150",
                        on
                          ? "bg-surface font-medium text-fg dark:bg-surface-3"
                          : "text-muted hover:bg-surface-3/70 hover:text-fg dark:hover:bg-surface-2",
                      )}
                    >
                      <I
                        className={cn(
                          "size-[18px] shrink-0",
                          on ? "text-accent" : "text-subtle group-hover:text-muted",
                        )}
                        aria-hidden
                      />
                      {l}
                      {badge ? (
                        <span className="num ml-auto rounded-[4px] bg-danger px-1.5 text-[11px] leading-[18px] font-medium text-white">
                          {badge}
                        </span>
                      ) : null}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
        <div className="flex flex-col gap-1 border-t border-border px-3 py-3">
          <span className="truncate px-2 text-xs text-subtle">{email}</span>
          <Link
            href="/app"
            className="flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] text-muted hover:bg-surface-3/70 hover:text-fg"
          >
            <ArrowLeft className="size-[18px] text-subtle" aria-hidden /> Back to app
          </Link>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col lg:py-2 lg:pr-2">
        <div className="flex min-h-dvh flex-1 flex-col bg-surface lg:min-h-[calc(100dvh-16px)] lg:rounded-[14px] lg:border lg:border-border">
          <header className="sticky top-0 z-20 border-b border-border bg-surface/90 backdrop-blur-md lg:top-2 lg:rounded-t-[14px]">
            <div className="flex h-14 items-center gap-3 px-4 lg:px-6">
              <span className="lg:hidden">
                <LogoMark />
              </span>
              <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2 text-[13px]">
                <span className="truncate text-subtle">Cloud admin</span>
                <span aria-hidden className="size-1 shrink-0 rounded-full bg-border-strong" />
                <span className="truncate font-medium text-fg">{current?.[1] ?? "Admin"}</span>
              </nav>
              <span className="ml-auto rounded-[4px] bg-neutral-soft px-1.5 py-0.5 text-[12px] text-neutral">
                Read-only
              </span>
              <Link href="/app" className="text-[13px] text-muted hover:text-fg lg:hidden">
                Back to app
              </Link>
            </div>
            <nav
              aria-label="Admin sections"
              className="-mb-px flex gap-1 overflow-x-auto px-3 pb-2 [scrollbar-width:none] lg:hidden"
            >
              {items.map(([h, l]) => (
                <Link
                  key={h}
                  href={h}
                  aria-current={active(h) ? "page" : undefined}
                  className={cn(
                    "flex h-8 shrink-0 items-center rounded-md px-2.5 text-[13px]",
                    active(h) ? "bg-surface-3 font-medium text-fg" : "text-muted",
                  )}
                >
                  {l}
                </Link>
              ))}
            </nav>
          </header>
          <main id="main" className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 lg:px-8 lg:py-8">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
