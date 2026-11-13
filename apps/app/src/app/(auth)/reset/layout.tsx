import type { Metadata } from "next";

// The page is a client component, so its noindex lives here.
export const metadata: Metadata = { title: "Choose a new password", robots: { index: false, follow: false } };

export default function ResetLayout({ children }: { children: React.ReactNode }) {
  return children;
}
