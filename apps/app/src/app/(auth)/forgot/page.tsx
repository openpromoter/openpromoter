import type { Metadata } from "next";
import { headers } from "next/headers";
import { PartnerAuthShell } from "@/app/p/[slug]/partner-auth-shell";
import { safeNext } from "@/lib/url";
import { captchaFor } from "@/server/captcha";
import { partnerProgram } from "@/server/partner-auth";
import { ForgotForm } from "./forgot-form";

// Utility pages stay out of search (they also serve every program's partner portal subdomain).
export const metadata: Metadata = { title: "Reset password", robots: { index: false, follow: false } };

export default async function ForgotPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const h = await headers();
  const next = safeNext((await searchParams).next, "/app");
  const p = await partnerProgram(next, h);
  if (!p) return <ForgotForm captcha={captchaFor(h)} />;
  return (
    <PartnerAuthShell p={p}>
      <ForgotForm captcha={captchaFor(h)} next={next} partner />
    </PartnerAuthShell>
  );
}
