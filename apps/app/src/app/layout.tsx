import "@fontsource-variable/inter/opsz.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { Providers } from "@/components/providers";
import { PRODUCT } from "@/lib/config";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: PRODUCT.name, template: `%s · ${PRODUCT.name}` },
  description: PRODUCT.tagline,
  icons: { icon: "/favicon.svg" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F4F4F1" },
    { media: "(prefers-color-scheme: dark)", color: "#0C0C0D" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const t = (await cookies()).get("theme")?.value;
  // same classes as themeClass() in components/theme.tsx (a client file, so it can't be called here)
  const cls = t === "dark" || t === "light" ? t : "system";
  return (
    // the theme class comes from a cookie, so the first paint is right without an inline script
    <html lang="en" className={cls} suppressHydrationWarning>
      {/* browser extensions (ColorZilla, Grammarly) add attributes to body before React loads */}
      <body className="min-h-dvh font-sans text-[14px] leading-5" suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
