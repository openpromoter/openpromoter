"use client";

import { Button, Field, Input } from "@openpromoter/ui";
import Link from "next/link";
import { useState } from "react";
import { AuthCard } from "@/components/auth/auth-card";
import { authClient } from "@/lib/auth-client";

export default function ForgotPage() {
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    await authClient.requestPasswordReset({
      email: String(new FormData(e.currentTarget).get("email")),
      redirectTo: "/reset",
    });
    setLoading(false);
    setSent(true);
  }
  return (
    <AuthCard
      title="Reset your password"
      subtitle="We'll email you a link to choose a new one."
      footer={
        <Link href="/login" className="font-medium text-fg hover:underline">
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
          <Button type="submit" variant="primary" size="lg" loading={loading} className="w-full">
            Send reset link
          </Button>
        </form>
      )}
    </AuthCard>
  );
}
