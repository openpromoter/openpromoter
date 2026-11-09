import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { safeNext } from "@/lib/url";
import { socialProviders } from "@/server/auth";
import { captchaFor, isAppHost } from "@/server/captcha";
import { env } from "@/server/env";
import { partnerProgram } from "@/server/partner-auth";
import { programBase } from "@/server/program-base";
import { SignupForm } from "./signup-form";

export const metadata: Metadata = { title: "Create account" };

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; email?: string }>;
}) {
  const sp = await searchParams;
  const next = safeNext(sp.next, "/onboarding");
  // partners join through the program's application, which creates their account; this page is for founders
  const p = await partnerProgram(next, await headers());
  if (p) redirect(`${await programBase(p)}/apply${sp.email ? `?email=${encodeURIComponent(sp.email)}` : ""}`);
  return (
    <SignupForm
      next={next}
      email={sp.email ?? ""}
      social={socialProviders}
      captcha={captchaFor(await headers())}
      via={isAppHost(await headers()) ? undefined : env.APP_URL}
    />
  );
}
