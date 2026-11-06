"use client";

import { Button, Field } from "@openpromoter/ui";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { AuthCard } from "@/components/auth/auth-card";
import { PasswordInput } from "@/components/auth/password-input";
import { authClient } from "@/lib/auth-client";

function ResetForm() {
  const token = useSearchParams().get("token") ?? "";
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const res = await authClient.resetPassword({
      newPassword: String(new FormData(e.currentTarget).get("password")),
      token,
    });
    if (res.error) return setError(res.error.message ?? "The link is invalid or expired");
    router.push("/login");
  }
  return (
    <AuthCard title="Choose a new password" subtitle="At least 8 characters. You'll sign in with it next.">
      <form onSubmit={onSubmit} className="flex flex-col gap-5">
        <Field label="New password" htmlFor="password" error={error}>
          <PasswordInput id="password" name="password" autoComplete="new-password" minLength={8} required />
        </Field>
        <Button type="submit" variant="primary" size="lg" className="w-full">
          Save password
        </Button>
      </form>
    </AuthCard>
  );
}

export default function ResetPage() {
  return (
    <Suspense>
      <ResetForm />
    </Suspense>
  );
}
