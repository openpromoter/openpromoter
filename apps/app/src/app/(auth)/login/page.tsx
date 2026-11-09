import type { Metadata } from "next";
import { headers } from "next/headers";
import { PartnerAuthShell } from "@/app/p/[slug]/partner-auth-shell";
import { safeNext } from "@/lib/url";
import { socialProviders } from "@/server/auth";
import { captchaFor, isAppHost } from "@/server/captcha";
import { env } from "@/server/env";
import { partnerProgram } from "@/server/partner-auth";
import { programBase } from "@/server/program-base";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

/** Errors better-auth sends back to /login?error=..., in plain words. */
const OAUTH_ERROR: Record<string, string> = {
  two_factor_required: "This account uses two-factor authentication. Sign in with your email and password.",
  account_not_linked: "That email already has an account. Sign in with your email and password first.",
  unable_to_link_account: "That email already has an account. Sign in with your email and password first.",
  access_denied: "Sign-in was cancelled.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; "2fa"?: string; error?: string; deleted?: string }>;
}) {
  const sp = await searchParams;
  const h = await headers();
  const next = safeNext(sp.next, "/app");
  // a partner signing in to a program's portal sees that program's brand (partner-auth.ts)
  const p = await partnerProgram(next, h);
  const error = sp.error ? (OAUTH_ERROR[sp.error.toLowerCase()] ?? "Could not sign in. Try again.") : null;
  const form = (
    <LoginForm
      next={next}
      partner={p ? { name: p.name, slug: p.slug, base: await programBase(p) } : undefined}
      twoFactor={sp["2fa"] === "1"}
      social={socialProviders}
      initialError={error}
      notice={
        sp.deleted === "1"
          ? "Your account and its programs were deleted. Signing in again starts a new account."
          : null
      }
      captcha={captchaFor(h)}
      via={isAppHost(h) ? undefined : env.APP_URL}
    />
  );
  return p ? <PartnerAuthShell p={p}>{form}</PartnerAuthShell> : form;
}
