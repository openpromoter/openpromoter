import { ArrowLeft } from "@openpromoter/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/logo";
import { requireAdmin } from "@/server/admin";

export const metadata: Metadata = { title: "Admin", robots: { index: false, follow: false } };

/** The owner's console: the app's canvas and white panel, without a program's sidebar. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const u = await requireAdmin();
  return (
    <div className="min-h-dvh bg-canvas lg:p-2">
      <div className="min-h-dvh bg-surface lg:min-h-[calc(100dvh-16px)] lg:rounded-[14px] lg:border lg:border-border">
        <header className="flex h-14 items-center gap-3 border-b border-border px-4 lg:px-8">
          <Link href="/admin" className="flex items-center gap-2.5">
            <Logo />
          </Link>
          <span className="rounded-[4px] bg-neutral-soft px-1.5 py-0.5 text-[12px] text-neutral">Admin</span>
          <span className="ml-auto hidden truncate text-[13px] text-subtle sm:block">{u.email}</span>
          <Link
            href="/app"
            className="inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-fg sm:ml-4"
          >
            <ArrowLeft className="size-4" /> Back to app
          </Link>
        </header>
        <main className="mx-auto w-full max-w-[1600px] px-4 py-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
