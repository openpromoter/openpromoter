"use client";

import { Button, Field, Input } from "@openpromoter/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AuthCard } from "@/components/auth/auth-card";
import {
  CAPTCHA_ERROR,
  Captcha,
  captchaHeaders,
  isCaptchaError,
  resetCaptcha,
} from "@/components/auth/captcha";
import { PasswordInput } from "@/components/auth/password-input";
import { type Social, SocialButtons } from "@/components/auth/social-buttons";
import { authClient } from "@/lib/auth-client";

export function LoginForm({
  next,
  twoFactor,
  social,
  initialError,
  notice,
  captcha,
  via,
  partner,
}: {
  next: string;
  twoFactor: boolean;
  social: Social[];
  initialError: string | null;
  notice?: string | null;
  captcha?: string;
  via?: string;
  /** Signing in to a program's partner portal: its name and slug, for the program's own wording and links. */
  partner?: { name: string; slug: string };
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(initialError);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const form = e.currentTarget;
    const f = new FormData(form);
    const res = twoFactor
      ? await authClient.twoFactor.verifyTotp({ code: String(f.get("code")), trustDevice: true })
      : await authClient.signIn.email({
          email: String(f.get("email")),
          password: String(f.get("password")),
          fetchOptions: await captchaHeaders(form, captcha),
        });
    setLoading(false);
    if (res.error) {
      resetCaptcha();
      return setError(
        isCaptchaError(res.error.code) ? CAPTCHA_ERROR : (res.error.message ?? "Could not sign in"),
      );
    }
    if (!twoFactor && (res.data as { twoFactorRedirect?: boolean } | null)?.twoFactorRedirect)
      return router.push(`/login?2fa=1&next=${encodeURIComponent(next)}`);
    router.push(next);
    router.refresh();
  }

  return (
    <AuthCard
      bare={!!partner}
      title={twoFactor ? "Two-factor code" : partner ? "Sign in to your partner portal" : "Welcome back"}
      subtitle={
        twoFactor
          ? "Enter the 6-digit code from your authenticator app."
          : partner
            ? `See your link, earnings and payouts with ${partner.name}.`
            : "Sign in to your program dashboard or partner portal."
      }
      footer={
        twoFactor ? null : partner ? (
          <>
            Not a partner yet?{" "}
            <Link
              className="-my-2 inline-block py-2 font-medium text-accent-text hover:underline"
              href={`/p/${partner.slug}/apply`}
            >
              Apply to join
            </Link>
          </>
        ) : (
          <>
            New here?{" "}
            <Link
              className="-my-2 inline-block py-2 font-medium text-accent-text hover:underline"
              href={`/signup?next=${encodeURIComponent(next)}`}
            >
              Create an account
            </Link>
          </>
        )
      }
    >
      {twoFactor ? null : <SocialButtons providers={social} next={next} verb="Continue with" via={via} />}
      <form onSubmit={onSubmit} className="flex flex-col gap-5">
        {twoFactor ? (
          <Field label="Code" htmlFor="code">
            <Input
              id="code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              className="h-10 font-mono tracking-widest"
            />
          </Field>
        ) : (
          <>
            <Field label="Email" htmlFor="email">
              <Input id="email" name="email" type="email" autoComplete="email" required className="h-10" />
            </Field>
            <Field
              label="Password"
              htmlFor="password"
              hint={
                <Link
                  href={partner ? `/forgot?next=${encodeURIComponent(next)}` : "/forgot"}
                  className="text-muted transition-colors hover:text-fg"
                >
                  Forgot password?
                </Link>
              }
            >
              <PasswordInput id="password" name="password" autoComplete="current-password" required />
            </Field>
            <Captcha siteKey={captcha} />
          </>
        )}
        {notice && !error ? (
          <p role="status" className="rounded-md bg-surface-2 px-3 py-2 text-[13px] leading-5 text-fg">
            {notice}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-[13px] leading-5 text-danger">
            {error}
          </p>
        ) : null}
        <Button type="submit" variant="primary" size="lg" loading={loading} className="mt-1 w-full">
          {twoFactor ? "Verify" : "Sign in"}
        </Button>
      </form>
    </AuthCard>
  );
}
