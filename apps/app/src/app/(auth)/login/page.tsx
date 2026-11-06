import type { Metadata } from "next";
import { safeNext } from "@/lib/url";
import { socialProviders } from "@/server/auth";
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
  searchParams: Promise<{ next?: string; "2fa"?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const error = sp.error ? (OAUTH_ERROR[sp.error.toLowerCase()] ?? "Could not sign in. Try again.") : null;
  return (
    <LoginForm
      next={safeNext(sp.next, "/app")}
      twoFactor={sp["2fa"] === "1"}
      social={socialProviders}
      initialError={error}
    />
  );
}
