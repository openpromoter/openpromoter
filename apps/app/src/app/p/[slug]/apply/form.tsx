"use client";

import type { ApplicationQuestion } from "@openpromoter/db";
import { Button, Field, Input, Select, Textarea } from "@openpromoter/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Captcha, captchaToken, resetCaptcha } from "@/components/auth/captcha";
import { CountrySelect } from "@/components/country-select";
import { MULTI_SEP } from "@/lib/application-answer";
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
  base,
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
  /** "" on the program's own domain, /p/slug on the app's host. */
  base: string;
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
            // a multiple choice question sends one value per ticked box: joined into one field
            Object.fromEntries(
              [...new Set(f.keys())].map((k) => [k, f.getAll(k).map(String).join(MULTI_SEP)]),
            ),
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
          router.push(`${base}/portal`);
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
                    `${base}/apply${invite ? `?invite=${invite}` : recruit ? `?recruit=${recruit}` : ""}`,
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
          <Question key={q.id} q={q} />
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
              href={base || "/"}
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

const choice = "flex items-start gap-3 text-[14px] leading-5 text-fg";
const box = "mt-0.5 size-4 shrink-0 accent-[var(--primary)]";

/** One of the founder's own questions (Settings > Application). */
function Question({ q }: { q: ApplicationQuestion }) {
  const id = `q-${q.id}`;
  const name = `q_${q.id}`;
  const label = `${q.label}${q.required ? "" : " (optional)"}`;
  if (q.type === "checkbox")
    return (
      <label className={choice}>
        <input type="checkbox" name={name} required={q.required} className={box} />
        <span>{label}</span>
      </label>
    );
  if (q.type === "multi")
    return (
      <fieldset>
        <legend className="mb-2.5 text-[13px] font-medium text-fg">{label}</legend>
        <div className="flex flex-col gap-2.5">
          {(q.options ?? []).map((o) => (
            <label key={o} className={choice}>
              <input type="checkbox" name={name} value={o} className={box} />
              <span>{o}</span>
            </label>
          ))}
        </div>
      </fieldset>
    );
  return (
    <Field label={label} htmlFor={id}>
      {q.type === "select" ? (
        <Select id={id} name={name} required={q.required} defaultValue="" className="h-10">
          <option value="" disabled>
            Choose one
          </option>
          {(q.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </Select>
      ) : q.type === "textarea" ? (
        <Textarea id={id} name={name} required={q.required} />
      ) : (
        <Input
          id={id}
          name={name}
          type={q.type === "url" ? "url" : "text"}
          required={q.required}
          className="h-10"
        />
      )}
    </Field>
  );
}
