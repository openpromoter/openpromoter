"use client";

import {
  Avatar,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@openpromoter/ui";
import {
  ArrowUpRight,
  Banknote,
  ChevronsUpDown,
  Coins,
  FileText,
  Home,
  type Icon,
  Link2,
  LogOut,
  MessageSquare,
  Moon,
  Settings2,
  Sun,
  UserPlus,
} from "@openpromoter/ui/icons";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "@/components/theme";
import { authClient } from "@/lib/auth-client";

const GROUPS: { label: string; items: [string, string, Icon][] }[] = [
  {
    label: "Earn",
    items: [
      ["", "Overview", Home],
      ["/links", "Links", Link2],
      ["/earnings", "Earnings", Coins],
      ["/payouts", "Payouts", Banknote],
    ],
  },
  {
    label: "Grow",
    items: [
      ["/content", "Content", FileText],
      ["/recruits", "Recruits", UserPlus],
      ["/messages", "Messages", MessageSquare],
    ],
  },
  { label: "Account", items: [["/settings", "Settings", Settings2]] },
];

/** Partner portal shell: the founder app's inset canvas, in the program's brand colour. */
export function PortalShell({
  slug,
  name,
  logo,
  user,
  email,
  programs,
  banner,
  footer,
  recruiting = false,
  children,
}: {
  slug: string;
  name: string;
  logo: React.ReactNode;
  user: string;
  email: string;
  programs: { slug: string; name: string }[];
  banner?: React.ReactNode;
  footer?: React.ReactNode;
  /** Two-tier is on: show the Recruits page. */
  recruiting?: boolean;
  children: React.ReactNode;
}) {
  const path = usePathname();
  const base = `/p/${slug}/portal`;
  const isActive = (h: string) => (h === "" ? path === base : path.startsWith(base + h));
  const groups = GROUPS.map((g) => ({
    ...g,
    items: g.items.filter(([h]) => recruiting || h !== "/recruits"),
  }));
  const items = groups.flatMap((g) => g.items);
  const current = items.find(([h]) => isActive(h));
  return (
    <div className="min-h-dvh bg-canvas lg:grid lg:grid-cols-[244px_1fr]">
      <aside className="sticky top-0 hidden h-dvh flex-col lg:flex" aria-label="Partner portal">
        <div className="flex h-[60px] items-center gap-2.5 px-5 pt-2">
          {logo}
          <div className="min-w-0">
            <div className="truncate text-[14px] leading-5 font-medium tracking-[-0.01em] text-fg">
              {name}
            </div>
            <div className="truncate text-xs leading-4 text-subtle">Partner portal</div>
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 pt-3 pb-4">
          {groups.map((g) => (
            <div key={g.label} className="mt-5 first:mt-1">
              <div className="eyebrow mb-1.5 px-2">{g.label}</div>
              <div className="flex flex-col gap-px">
                {g.items.map(([h, l, I]) => {
                  const active = isActive(h);
                  return (
                    <Link
                      key={h}
                      href={base + h}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "group flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] transition-colors duration-150",
                        active
                          ? "bg-surface font-medium text-fg dark:bg-surface-3"
                          : "text-muted hover:bg-surface-3/70 hover:text-fg dark:hover:bg-surface-2",
                      )}
                    >
                      <I
                        className={cn(
                          "size-[18px] shrink-0",
                          active ? "text-accent" : "text-subtle group-hover:text-muted",
                        )}
                        aria-hidden
                      />
                      {l}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
        <div className="flex flex-col gap-2 px-3 pb-3">
          <Link
            href={`/p/${slug}`}
            className="flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] text-muted transition-colors hover:bg-surface-3/70 hover:text-fg dark:hover:bg-surface-2"
          >
            <ArrowUpRight className="size-[18px] text-subtle" aria-hidden />
            Program page
          </Link>
          <AccountMenu slug={slug} user={user} email={email} programs={programs} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-col lg:py-2 lg:pr-2">
        <div className="flex min-h-dvh flex-1 flex-col bg-surface lg:min-h-[calc(100dvh-16px)] lg:rounded-[14px] lg:border lg:border-border">
          <header className="sticky top-0 z-20 border-b border-border bg-surface/90 backdrop-blur-md lg:top-2 lg:rounded-t-[18px]">
            <div className="flex h-14 items-center gap-3 px-4 lg:px-6">
              <span className="lg:hidden">{logo}</span>
              <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2 text-[13px]">
                <span className="truncate text-subtle">{name}</span>
                <span aria-hidden className="size-1 shrink-0 rounded-full bg-border-strong" />
                <span className="truncate font-medium text-fg">{current?.[1] ?? "Portal"}</span>
              </nav>
              <div className="ml-auto lg:hidden">
                <AccountMenu slug={slug} user={user} email={email} programs={programs} compact />
              </div>
            </div>
            <nav
              aria-label="Portal sections"
              className="-mb-px flex gap-1 overflow-x-auto px-3 pb-2 [scrollbar-width:none] lg:hidden"
            >
              {items.map(([h, l]) => (
                <Link
                  key={h}
                  href={base + h}
                  aria-current={isActive(h) ? "page" : undefined}
                  className={cn(
                    "flex h-8 shrink-0 items-center rounded-md px-2.5 text-[13px]",
                    isActive(h) ? "bg-surface-3 font-medium text-fg" : "text-muted",
                  )}
                >
                  {l}
                </Link>
              ))}
            </nav>
          </header>
          {banner}
          <main id="main" className="mx-auto w-full max-w-[1160px] flex-1 px-4 py-6 lg:px-8 lg:py-8">
            {children}
          </main>
          {footer}
        </div>
      </div>
    </div>
  );
}

function AccountMenu({
  slug,
  user,
  email,
  programs,
  compact,
}: {
  slug: string;
  user: string;
  email: string;
  programs: { slug: string; name: string }[];
  compact?: boolean;
}) {
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <DropdownMenu>
      {compact ? (
        <DropdownMenuTrigger aria-label="Account" className="rounded-full">
          <Avatar name={user} size={28} />
        </DropdownMenuTrigger>
      ) : (
        <DropdownMenuTrigger
          aria-label="Account"
          className="flex w-full items-center gap-2.5 rounded-lg border border-border bg-surface p-2 text-left transition-colors hover:border-border-strong dark:bg-surface-2"
        >
          <Avatar name={user} size={30} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] leading-4 font-medium text-fg">{user}</span>
            <span className="block truncate text-xs leading-4 text-subtle">{email}</span>
          </span>
          <ChevronsUpDown className="size-4 text-subtle" />
        </DropdownMenuTrigger>
      )}
      <DropdownMenuContent align="end" className="w-60">
        {programs.length > 1 ? (
          <>
            <DropdownMenuLabel>Your programs</DropdownMenuLabel>
            {programs.map((p) => (
              <DropdownMenuItem key={p.slug} onSelect={() => router.push(`/p/${p.slug}/portal`)}>
                <span className="flex-1 truncate">{p.name}</span>
                {p.slug === slug ? <span className="size-1.5 rounded-full bg-primary" /> : null}
              </DropdownMenuItem>
            ))}
            <DropdownMenuItem onSelect={() => router.push("/partners")}>All programs</DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuItem onSelect={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}>
          {resolvedTheme === "dark" ? <Sun /> : <Moon />}{" "}
          {resolvedTheme === "dark" ? "Light theme" : "Dark theme"}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={async () => {
            await authClient.signOut();
            router.push(`/p/${slug}`);
          }}
        >
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
