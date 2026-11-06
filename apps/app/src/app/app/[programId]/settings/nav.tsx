"use client";

import { cn } from "@openpromoter/ui";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function SettingsNav({ base, hosted }: { base: string; hosted: boolean }) {
  const path = usePathname();
  const items = [
    ["", "Program"],
    ["/application", "Applications"],
    ["/import", "Import"],
    ["/branding", "Portal & domain"],
    ["/install", "Install"],
    ["/integrations", "Integrations"],
    ["/developers", "API & webhooks"],
    ["/team", "Team"],
    ["/audit", "Audit log"],
    ...(hosted ? [["/billing", "Plan & billing"]] : []),
    ["/programs", "Programs"],
    ["/account", "Account"],
  ];
  return (
    <nav
      aria-label="Settings"
      className="-mx-4 flex gap-1 overflow-x-auto border-b border-border px-4 md:mx-0 md:px-0"
    >
      {items.map(([href, label]) => {
        const active = href === "" ? path === base : path.startsWith(base + href);
        return (
          <Link
            key={href}
            href={base + href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px shrink-0 border-b-2 px-3 py-2 text-[13px] font-medium whitespace-nowrap",
              active ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg",
            )}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
