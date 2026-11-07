import type { Metadata } from "next";
import { headers } from "next/headers";
import { safeNext } from "@/lib/url";
import { socialProviders } from "@/server/auth";
import { captchaFor } from "@/server/captcha";
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
    />
  );
}
