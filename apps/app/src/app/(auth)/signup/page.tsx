import type { Metadata } from "next";
import { headers } from "next/headers";
import { safeNext } from "@/lib/url";
import { socialProviders } from "@/server/auth";
import { captchaFor, isAppHost } from "@/server/captcha";
import { env } from "@/server/env";
import { SignupForm } from "./signup-form";

export const metadata: Metadata = { title: "Create account" };

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; email?: string }>;
}) {
  const sp = await searchParams;
  return (
    <SignupForm
      next={safeNext(sp.next, "/onboarding")}
      email={sp.email ?? ""}
      social={socialProviders}
      captcha={captchaFor(await headers())}
      via={isAppHost(await headers()) ? undefined : env.APP_URL}
    />
  );
}
