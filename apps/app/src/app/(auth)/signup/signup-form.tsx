"use client";

import { Button, Field, Input } from "@openpromoter/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AuthCard } from "@/components/auth/auth-card";
import { PasswordInput } from "@/components/auth/password-input";
import { type Social, SocialButtons } from "@/components/auth/social-buttons";
import { authClient } from "@/lib/auth-client";

export function SignupForm({ next, email, social }: { next: string; email: string; social: Social[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const f = new FormData(e.currentTarget);
    const res = await authClient.signUp.email({
      name: String(f.get("name")),
      email: String(f.get("email")),
      password: String(f.get("password")),
    });
    setLoading(false);
    if (res.error) return setError(res.error.message ?? "Could not create the account");
    router.push(next);
    router.refresh();
  }

  return (
    <AuthCard
      scene="signup"
      title="Create your account"
      subtitle="Free and open source. Your partner program is live in about five minutes."
      footer={
        <>
          Already have an account?{" "}
          <Link
            className="font-medium text-accent-text hover:underline"
            href={`/login?next=${encodeURIComponent(next)}`}
          >
            Sign in
          </Link>
        </>
      }
    >
      <SocialButtons providers={social} next={next} verb="Continue with" />
      <form onSubmit={onSubmit} className="flex flex-col gap-5">
        <Field label="Name" htmlFor="name">
          <Input id="name" name="name" autoComplete="name" required className="h-10" />
        </Field>
        <Field label="Work email" htmlFor="email">
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            defaultValue={email}
            required
            className="h-10"
          />
        </Field>
        <Field label="Password" htmlFor="password" hint="At least 8 characters.">
          <PasswordInput id="password" name="password" autoComplete="new-password" minLength={8} required />
        </Field>
        {error ? (
          <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-[13px] leading-5 text-danger">
            {error}
          </p>
        ) : null}
        <Button type="submit" variant="primary" size="lg" loading={loading} className="mt-1 w-full">
          Create account
        </Button>
      </form>
    </AuthCard>
  );
}
