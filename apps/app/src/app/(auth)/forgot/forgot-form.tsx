"use client";

import { Button, Field, Input } from "@openpromoter/ui";
import Link from "next/link";
import { useState } from "react";
import { AuthCard } from "@/components/auth/auth-card";
import {
  CAPTCHA_ERROR,
  Captcha,
  captchaHeaders,
  isCaptchaError,
  resetCaptcha,
} from "@/components/auth/captcha";
import { authClient } from "@/lib/auth-client";

export function ForgotForm({
  captcha,
  next,
  partner = false,
}: {
  captcha?: string;
  next?: string;
  /** Inside a program's own frame (partners): the form only. */
  partner?: boolean;
}) {
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const form = e.currentTarget;
    const res = await authClient.requestPasswordReset({
      email: String(new FormData(form).get("email")),
      redirectTo: "/reset",
      fetchOptions: await captchaHeaders(form, captcha),
    });
    setLoading(false);
    // any other error stays hidden: the reply never says whether an account exists
    if (isCaptchaError(res.error?.code)) {
      resetCaptcha();
      return setError(CAPTCHA_ERROR);
    }
    setSent(true);
  }
  return (
    <AuthCard
      bare={partner}
      title="Reset your password"
      subtitle="We'll email you a link to choose a new one."
      footer={
        <Link
          href={next ? `/login?next=${encodeURIComponent(next)}` : "/login"}
          className="font-medium text-accent-text hover:underline"
        >
          Back to sign in
        </Link>
      }
    >
      {sent ? (
        <p className="rounded-lg border border-border bg-surface-2 px-4 py-3 text-[13px] leading-5 text-muted">
          If an account exists for that email, a reset link is on its way. It works for one hour.
        </p>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-5">
          <Field label="Email" htmlFor="email">
            <Input id="email" name="email" type="email" required className="h-10" />
          </Field>
          <Captcha siteKey={captcha} />
          {error ? (
            <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-[13px] leading-5 text-danger">
              {error}
            </p>
          ) : null}
          <Button type="submit" variant="primary" size="lg" loading={loading} className="w-full">
            Send reset link
          </Button>
        </form>
      )}
    </AuthCard>
  );
}
