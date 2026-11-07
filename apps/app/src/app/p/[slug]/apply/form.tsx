"use client";

import type { ApplicationQuestion } from "@openpromoter/db";
import { Button, Field, Input, Textarea } from "@openpromoter/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Captcha, captchaToken, resetCaptcha } from "@/components/auth/captcha";
import { CountrySelect } from "@/components/country-select";
import { applyAction } from "../portal-actions";

function Group({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <fieldset className="border-t border-border pt-6">
      <legend className="sr-only">{title}</legend>
      <div className="mb-5 flex items-baseline gap-3" aria-hidden>
        <span className="font-mono text-[12px] text-subtle">{n}</span>
        <span className="text-[14px] font-medium text-fg">{title}</span>
      </div>
      <div className="flex flex-col gap-5">{children}</div>
    </fieldset>
  );
}

export function ApplyForm({
  slug,
  signedIn,
  invite,
  recruit,
  email,
  questions,
  inviteOnly,
  instant,
  captcha,
}: {
  slug: string;
  signedIn: { name: string; email: string } | null;
  invite: string;
  recruit: string;
  email: string;
  questions: ApplicationQuestion[];
  inviteOnly: boolean;
  instant: boolean;
  captcha?: string;
}) {
  const [pending, start] = useTransition();
  const router = useRouter();
  if (inviteOnly && !invite)
    return (
      <p className="mt-8 rounded-lg border border-dashed border-border-strong p-5 text-[14px] leading-6 text-muted">
        This program is invite-only. Ask the team for an invitation link.
      </p>
    );
  return (
    <form
      className="mt-10 flex flex-col gap-8"
      // onSubmit, not action: React resets a form after its action runs, which would wipe the answers on an error
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        start(async () => {
          await captchaToken(form, captcha);
          const f = new FormData(form);
          const r = await applyAction(
            slug,
            Object.fromEntries([...f.entries()].map(([k, v]) => [k, String(v)])),
          );
          if (!r.ok) {
            resetCaptcha();
            return void toast.error(r.error);
          }
          toast.success(
            r.data!.autoApproved
              ? "You're approved. Your portal is ready."
              : "Application received. We'll email you soon.",
          );
          router.push(`/p/${slug}/portal`);
          router.refresh();
        });
      }}
    >
      <input type="hidden" name="invite" value={invite} />
      <input type="hidden" name="recruit" value={recruit} />
      <Group n="01" title="About you">
        <Field label="Full name" htmlFor="ap-name">
          <Input
            id="ap-name"
            name="name"
            defaultValue={signedIn?.name}
            required
            autoComplete="name"
            className="h-10"
          />
        </Field>
        <Field label="Email" htmlFor="ap-email">
          <Input
            id="ap-email"
            name="email"
            type="email"
            defaultValue={signedIn?.email ?? email}
            readOnly={!!signedIn}
            required
            autoComplete="email"
            className="h-10"
          />
        </Field>
        {!signedIn ? (
          <Field
            label="Password"
            htmlFor="ap-pass"
            hint={
              <>
                For your partner portal. Have an account?{" "}
                <Link
                  className="text-muted underline decoration-border-strong underline-offset-2 hover:text-fg"
                  href={`/login?next=${encodeURIComponent(
                    `/p/${slug}/apply${invite ? `?invite=${invite}` : recruit ? `?recruit=${recruit}` : ""}`,
                  )}`}
                >
                  Sign in
                </Link>
              </>
            }
          >
            <Input
              id="ap-pass"
              name="password"
              type="password"
              minLength={8}
              required
              autoComplete="new-password"
              className="h-10"
            />
          </Field>
        ) : null}
      </Group>
      <Group n="02" title="Where you'll share">
        <Field label="Website or main channel" htmlFor="ap-web">
          <Input id="ap-web" name="website" placeholder="https://" className="h-10" />
        </Field>
        <Field label="Country" htmlFor="ap-cc" hint="Used for tax forms and payout options.">
          <CountrySelect id="ap-cc" />
        </Field>
        {questions.map((q) => (
          <Field key={q.id} label={`${q.label}${q.required ? "" : " (optional)"}`} htmlFor={`q-${q.id}`}>
            {q.type === "textarea" ? (
              <Textarea id={`q-${q.id}`} name={`q_${q.id}`} required={q.required} />
            ) : (
              <Input
                id={`q-${q.id}`}
                name={`q_${q.id}`}
                type={q.type === "url" ? "url" : "text"}
                required={q.required}
                className="h-10"
              />
            )}
          </Field>
        ))}
      </Group>
      <div className="flex flex-col gap-5 border-t border-border pt-6">
        <label className="flex items-start gap-3 text-[13px] leading-5 text-muted">
          <input
            type="checkbox"
            name="terms"
            required
            className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]"
          />
          <span>
            I agree to the{" "}
            <Link
              href={`/p/${slug}`}
              className="text-fg underline decoration-border-strong underline-offset-2"
            >
              program terms
            </Link>{" "}
            including the self-billing agreement for commission invoices.
          </span>
        </label>
        <Captcha siteKey={captcha} />
        <Button
          type="submit"
          variant="primary"
          size="lg"
          loading={pending}
          className="h-11 w-full text-[14px]"
        >
          {instant ? "Join and get my link" : "Send application"}
        </Button>
      </div>
    </form>
  );
}
