"use client";

import {
  Avatar,
  Button,
  cn,
  Dialog,
  DialogContent,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Kbd,
  Tooltip,
} from "@openpromoter/ui";
import {
  Banknote,
  BookOpen,
  Bot,
  ChartLine,
  Check,
  ChevronsUpDown,
  Coins,
  FileText,
  LayoutDashboard,
  LogOut,
  type LucideIcon,
  Megaphone,
  MessageSquare,
  Monitor,
  Moon,
  MoreHorizontal,
  PanelLeft,
  Plus,
  Search,
  Settings2,
  ShieldAlert,
  Sparkles,
  Sun,
  UserPlus,
  Users,
  UsersRound,
} from "@openpromoter/ui/icons";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { LogoMark } from "@/components/logo";
import { useTheme } from "@/components/theme";
import { authClient } from "@/lib/auth-client";
import { t } from "@/lib/i18n";
import { CommandPalette } from "./command-palette";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  count?: number;
  key?: string;
}

export interface ShellProps {
  program: { id: string; name: string; slug: string; color: string };
  programs: { id: string; name: string; workspaceName: string }[];
  user: { name: string; email: string };
  role: string;
  counts: { partners: number; autopilot: number; payouts: number; fraud: number };
  children: React.ReactNode;
}

export function navGroups(base: string, counts: ShellProps["counts"]): { label: string; items: NavItem[] }[] {
  return [
    {
      label: t("nav.program"),
      items: [
        { href: base, label: t("nav.dashboard"), icon: LayoutDashboard, key: "d" },
        { href: `${base}/partners`, label: t("nav.partners"), icon: Users, count: counts.partners, key: "p" },
        { href: `${base}/customers`, label: t("nav.customers"), icon: UsersRound, key: "u" },
        { href: `${base}/commissions`, label: t("nav.commissions"), icon: Coins, key: "c" },
        { href: `${base}/payouts`, label: t("nav.payouts"), icon: Banknote, count: counts.payouts, key: "o" },
      ],
    },
    {
      label: t("nav.grow"),
      items: [
        {
          href: `${base}/autopilot`,
          label: t("nav.autopilot"),
          icon: Bot,
          count: counts.autopilot,
          key: "a",
        },
        { href: `${base}/recruiter`, label: t("nav.recruiter"), icon: UserPlus, key: "r" },
        { href: `${base}/campaigns`, label: t("nav.campaigns"), icon: Megaphone, key: "m" },
        { href: `${base}/content`, label: t("nav.content"), icon: FileText, key: "k" },
        { href: `${base}/messages`, label: t("nav.messages"), icon: MessageSquare },
      ],
    },
    {
      label: t("nav.insight"),
      items: [
        { href: `${base}/analytics`, label: t("nav.analytics"), icon: ChartLine, key: "n" },
        { href: `${base}/fraud`, label: t("nav.fraud"), icon: ShieldAlert, count: counts.fraud, key: "f" },
        { href: `${base}/assistant`, label: t("nav.ask"), icon: Sparkles, key: "i" },
      ],
    },
  ];
}

function NavLink({
  item,
  active,
  collapsed,
  onClick,
  alert,
}: {
  item: NavItem;
  active: boolean;
  collapsed: boolean;
  onClick?: () => void;
  alert?: boolean;
}) {
  const link = (
    <Link
      href={item.href}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px]",
        active
          ? "bg-surface font-medium text-fg dark:bg-surface-3"
          : "text-muted hover:bg-surface-3/70 hover:text-fg dark:hover:bg-surface-2",
        collapsed && "justify-center px-0",
      )}
    >
      <item.icon
        className={cn("size-[18px] shrink-0", active ? "text-fg" : "text-subtle group-hover:text-muted")}
        aria-hidden
      />
      {collapsed ? (
        <span className="sr-only">{item.label}</span>
      ) : (
        <span className="flex-1 truncate">{item.label}</span>
      )}
      {!collapsed && item.count ? (
        alert ? (
          <span className="num inline-flex h-[18px] min-w-[18px] items-center justify-center gap-1 rounded-[5px] bg-danger px-1.5 text-[11px] font-medium text-white dark:text-bg">
            {item.count}
          </span>
        ) : (
          <span className="num text-xs text-subtle">{item.count}</span>
        )
      ) : null}
    </Link>
  );
  return collapsed ? (
    <Tooltip content={item.label} side="right">
      {link}
    </Tooltip>
  ) : (
    link
  );
}

function ThemeItems() {
  const { setTheme, theme } = useTheme();
  return (
    <>
      <DropdownMenuLabel>Theme</DropdownMenuLabel>
      {(
        [
          ["system", "System", Monitor],
          ["light", "Light", Sun],
          ["dark", "Dark", Moon],
        ] as const
      ).map(([v, l, I]) => (
        <DropdownMenuItem key={v} onSelect={() => setTheme(v)}>
          <I /> {l} {theme === v ? <span className="ml-auto size-1.5 rounded-full bg-accent" /> : null}
        </DropdownMenuItem>
      ))}
    </>
  );
}

export function AppShell({ program, programs, user, role, counts, children }: ShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const base = `/app/${program.id}`;
  const groups = navGroups(base, counts);
  const [collapsed, setCollapsed] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const { setTheme, resolvedTheme } = useTheme();

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem("op:sidebar") === "1");
    } catch {}
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("op:sidebar", collapsed ? "1" : "0");
    } catch {}
  }, [collapsed]);

  // keyboard shortcuts: ⌘K, [, ?, g+<key>, t t
  useEffect(() => {
    let seq = "";
    let timer: ReturnType<typeof setTimeout> | undefined;
    const items = groups.flatMap((g) => g.items);
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
        return;
      }
      const t = e.target as HTMLElement;
      if (
        t.isContentEditable ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) ||
        e.metaKey ||
        e.ctrlKey ||
        e.altKey
      )
        return;
      if (e.key === "[") return setCollapsed((c) => !c);
      if (e.key === "?") return setHelpOpen(true);
      seq = (seq + e.key.toLowerCase()).slice(-2);
      clearTimeout(timer);
      timer = setTimeout(() => (seq = ""), 1000);
      if (seq === "tt") {
        setTheme(resolvedTheme === "dark" ? "light" : "dark");
        seq = "";
      } else if (seq[0] === "g") {
        if (seq[1] === "s") router.push(`${base}/settings`);
        const hit = items.find((i) => i.key === seq[1]);
        if (hit) router.push(hit.href);
        if (seq.length === 2) seq = "";
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [groups, router, base, resolvedTheme, setTheme]);

  const isActive = (href: string) => (href === base ? pathname === base : pathname.startsWith(href));
  const title =
    groups.flatMap((g) => g.items).find((i) => isActive(i.href))?.label ??
    (pathname.startsWith(`${base}/settings`) ? "Settings" : "");
  const mobile = [groups[0]!.items[0]!, groups[0]!.items[1]!, groups[0]!.items[3]!, groups[0]!.items[4]!];

  const alertKeys = new Set([`${base}/payouts`, `${base}/fraud`]);

  return (
    <div
      className={cn(
        "app-shell min-h-dvh bg-canvas lg:grid lg:h-dvh lg:overflow-hidden",
        collapsed ? "lg:grid-cols-[64px_1fr]" : "lg:grid-cols-[252px_1fr]",
      )}
    >
      <aside className="sticky top-0 hidden h-dvh flex-col lg:flex" aria-label="Main navigation">
        <div className={cn("flex h-[60px] items-center px-3 pt-2", collapsed && "justify-center px-0")}>
          <DropdownMenu>
            <DropdownMenuTrigger
              className={cn(
                "flex min-w-0 flex-1 items-center gap-2.5 rounded-md p-1.5 text-left hover:bg-surface-3/70 dark:hover:bg-surface-2",
                collapsed && "flex-none",
              )}
              aria-label="Switch program"
            >
              {/* lifted so the head, not the antenna box, is centred on the name */}
              <span className="relative -top-[3px] inline-flex text-fg">
                <LogoMark size={22} />
              </span>
              {!collapsed ? (
                <>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium tracking-[-0.01em] text-fg">
                      {program.name}
                    </span>
                  </span>
                  <ChevronsUpDown className="size-4 text-subtle" />
                </>
              ) : null}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64">
              <DropdownMenuLabel>Programs</DropdownMenuLabel>
              {programs.map((p) => (
                <DropdownMenuItem key={p.id} onSelect={() => router.push(`/app/${p.id}`)}>
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  {p.id === program.id ? (
                    <Check className="size-4 text-fg" aria-label="Current program" />
                  ) : (
                    <span className="truncate text-xs text-subtle">{p.workspaceName}</span>
                  )}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => router.push(`${base}/settings/programs`)}>
                <Settings2 /> Manage programs
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => router.push(`${base}/settings/programs`)}>
                <Plus /> New program
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 pt-2 pb-4">
          {groups.map((g) => (
            <div key={g.label} className="mt-5 first:mt-1">
              {!collapsed ? (
                <div className="eyebrow mb-1.5 px-2">{g.label}</div>
              ) : (
                <div className="mx-3 mb-2 border-t border-border-strong/60" />
              )}
              <div className="flex flex-col gap-px">
                {g.items.map((i) => (
                  <NavLink
                    key={i.href}
                    item={i}
                    active={isActive(i.href)}
                    collapsed={collapsed}
                    alert={alertKeys.has(i.href)}
                  />
                ))}
              </div>
            </div>
          ))}
        </nav>
        <div className="flex flex-col gap-px px-3 pb-3">
          <NavLink
            item={{ href: `${base}/settings`, label: t("nav.settings"), icon: Settings2 }}
            active={pathname.startsWith(`${base}/settings`)}
            collapsed={collapsed}
          />
          <NavLink
            item={{ href: "https://openpromoter.com/docs", label: t("nav.docs"), icon: BookOpen }}
            active={false}
            collapsed={collapsed}
          />
          <div className="mt-2">
            <UserMenu user={user} role={role} collapsed={collapsed} base={base} />
          </div>
        </div>
      </aside>

      {/* On desktop the white panel is the scroller, so the sticky header sits flush inside it */}
      <div className="flex min-w-0 flex-col pb-[calc(60px+env(safe-area-inset-bottom))] lg:h-dvh lg:py-2 lg:pr-2 lg:pb-2">
        <div className="flex min-h-full flex-1 flex-col bg-surface lg:min-h-0 lg:overflow-y-auto lg:rounded-[14px] lg:border lg:border-border">
          <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b border-border bg-surface px-4 lg:px-6">
            <Tooltip
              content={
                <span>
                  Toggle sidebar <Kbd className="ml-1">[</Kbd>
                </span>
              }
            >
              <Button
                variant="ghost"
                size="icon-sm"
                className="-ml-1.5 hidden lg:inline-flex"
                aria-label="Toggle sidebar"
                onClick={() => setCollapsed((c) => !c)}
              >
                <PanelLeft />
              </Button>
            </Tooltip>
            <span className="relative -top-[3px] inline-flex text-fg lg:hidden">
              <LogoMark size={22} />
            </span>
            <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2 text-[13px]">
              <span className="hidden truncate text-subtle sm:inline">{program.name}</span>
              <span aria-hidden className="hidden text-border-strong sm:inline">
                /
              </span>
              <span className="truncate font-medium text-fg">{title}</span>
            </nav>
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="ml-auto hidden h-8 w-[280px] items-center gap-2 rounded-md border border-border bg-surface-2 pr-1.5 pl-2.5 text-[13px] text-subtle hover:border-border-strong hover:text-muted lg:flex"
              aria-label="Search or jump to"
            >
              <Search className="size-4" />
              <span className="flex-1 text-left">Search partners and pages…</span>
              <Kbd>⌘K</Kbd>
            </button>
            <div className="ml-auto flex items-center gap-1.5 lg:ml-0">
              <Button
                variant="ghost"
                size="icon-sm"
                className="lg:hidden"
                aria-label="Search"
                onClick={() => setPaletteOpen(true)}
              >
                <Search />
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => router.push(`${base}/assistant`)}
                className="hidden sm:inline-flex"
              >
                <Sparkles className="text-accent" /> Ask
              </Button>
              <span className="lg:hidden">
                <UserMenu user={user} role={role} collapsed base={base} />
              </span>
            </div>
          </header>
          <main id="main" className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-6 lg:px-8 lg:py-8">
            {children}
          </main>
        </div>
      </div>

      <nav
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
        aria-label="Mobile navigation"
      >
        {mobile.map((i) => (
          <Link
            key={i.href}
            href={i.href}
            aria-current={isActive(i.href) ? "page" : undefined}
            className={cn(
              "flex h-[60px] flex-col items-center justify-center gap-1 text-[11px]",
              isActive(i.href) ? "font-medium text-fg" : "text-muted",
            )}
          >
            <i.icon size={20} weight={isActive(i.href) ? "fill" : "regular"} />
            {i.label}
          </Link>
        ))}
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          className="flex h-[60px] flex-col items-center justify-center gap-1 text-[11px] text-muted"
        >
          <MoreHorizontal className="size-5" />
          More
        </button>
      </nav>
      <Dialog open={moreOpen} onOpenChange={setMoreOpen}>
        <DialogContent title="More" side="right">
          <div className="flex flex-col gap-4">
            {groups.map((g) => (
              <div key={g.label}>
                <div className="eyebrow mb-1.5">{g.label}</div>
                {g.items.map((i) => (
                  <NavLink
                    key={i.href}
                    item={i}
                    active={isActive(i.href)}
                    collapsed={false}
                    onClick={() => setMoreOpen(false)}
                  />
                ))}
              </div>
            ))}
            <NavLink
              item={{ href: `${base}/settings`, label: t("nav.settings"), icon: Settings2 }}
              active={false}
              collapsed={false}
              onClick={() => setMoreOpen(false)}
            />
          </div>
        </DialogContent>
      </Dialog>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} base={base} groups={groups} />
      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent title="Keyboard shortcuts">
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-[13px]">
            {[
              ["⌘ K", "Command palette"],
              ["?", "This sheet"],
              ["[", "Toggle sidebar"],
              ["t t", "Toggle theme"],
              ["g s", "Settings"],
              ...groups.flatMap((g) => g.items.filter((i) => i.key).map((i) => [`g ${i.key}`, i.label])),
            ].map(([k, v]) => (
              <div key={k} className="contents">
                <dt>
                  <Kbd>{k}</Kbd>
                </dt>
                <dd className="text-muted">{v}</dd>
              </div>
            ))}
          </dl>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function UserMenu({
  user,
  role,
  collapsed,
  base,
}: {
  user: { name: string; email: string };
  role: string;
  collapsed: boolean;
  base: string;
}) {
  const router = useRouter();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "flex w-full items-center gap-2.5 rounded-lg border border-border bg-surface p-2 text-left hover:border-border-strong dark:bg-surface-2",
          collapsed && "w-auto justify-center border-0 bg-transparent p-1",
        )}
        aria-label="Account menu"
      >
        <Avatar name={user.name} size={collapsed ? 26 : 30} />
        {!collapsed ? (
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] leading-4 font-medium text-fg">{user.name}</span>
            <span className="block truncate text-xs leading-4 text-subtle">
              {user.email} · <span className="capitalize">{role}</span>
            </span>
          </span>
        ) : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <div className="px-2 py-1.5">
          <div className="truncate text-[13px] font-medium text-fg">{user.name}</div>
          <div className="truncate text-xs text-subtle">{user.email}</div>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => router.push(`${base}/settings/account`)}>
          <Settings2 /> Account settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <ThemeItems />
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={async () => {
            await authClient.signOut();
            router.push("/login");
          }}
        >
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
