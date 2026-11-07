"use client";

import { Badge, Button, Field, Input } from "@openpromoter/ui";
import { ShieldCheck } from "@openpromoter/ui/icons";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { useState } from "react";
import { toast } from "sonner";
import { SettingsCard } from "@/components/page";
import { authClient } from "@/lib/auth-client";
import { setPasswordAction } from "./actions";

const PROVIDER: Record<string, string> = { google: "Google", github: "GitHub" };

export function AccountView({
  name,
  email,
  twoFactor,
  hasPassword,
  social,
  workspaceExport,
  programsHref,
}: {
  name: string;
  email: string;
  twoFactor: boolean;
  hasPassword: boolean;
  social: string[];
  workspaceExport: string | null;
  programsHref: string;
}) {
  const router = useRouter();
  const [qr, setQr] = useState<string | null>(null);
  const [codes, setCodes] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const via = social.map((p) => PROVIDER[p] ?? p).join(" or ") || "a sign-in link";
  return (
    <>
      <SettingsCard title="Profile">
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const v = String(new FormData(e.currentTarget).get("name") ?? "").trim();
            if (!v) return void toast.error("Enter your name");
            setLoading(true);
            const r = await authClient.updateUser({ name: v.slice(0, 120) });
            setLoading(false);
            if (r.error) return void toast.error(r.error.message ?? "Couldn't save your name");
            toast.success("Name saved");
            router.refresh();
          }}
        >
          <Field label="Name" htmlFor="ac-name">
            <Input id="ac-name" name="name" defaultValue={name} maxLength={120} required />
          </Field>
          <Field label="Email" htmlFor="ac-email">
            <Input id="ac-email" defaultValue={email} readOnly />
          </Field>
          <Button type="submit" loading={loading} className="self-start sm:col-span-2">
            Save name
          </Button>
        </form>
      </SettingsCard>
      {!hasPassword ? (
        <SettingsCard
          title="Password"
          description={`You sign in with ${via}. Add a password to also sign in with your email and to turn on two-factor authentication.`}
        >
          <form
            className="grid gap-4 sm:grid-cols-2"
            onSubmit={async (e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const next = String(new FormData(form).get("new"));
              if (next.length < 8) return void toast.error("Use at least 8 characters");
              setLoading(true);
              const r = await setPasswordAction(next);
              setLoading(false);
              if (!r.ok) return void toast.error(r.error);
              form.reset();
              toast.success(r.message ?? "Password set");
              router.refresh();
            }}
          >
            <Field label="New password" htmlFor="ac-pw-set">
              <Input
                id="ac-pw-set"
                name="new"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
              />
            </Field>
            <Button type="submit" loading={loading} className="self-start sm:col-span-2">
              Set password
            </Button>
          </form>
        </SettingsCard>
      ) : (
        <SettingsCard title="Password" description="Other devices are signed out when you change it.">
          <form
            className="grid gap-4 sm:grid-cols-2"
            onSubmit={async (e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const f = new FormData(form);
              const next = String(f.get("new"));
              if (next.length < 8) return void toast.error("Use at least 8 characters");
              setLoading(true);
              const r = await authClient.changePassword({
                currentPassword: String(f.get("current")),
                newPassword: next,
                revokeOtherSessions: true,
              });
              setLoading(false);
              if (r.error) return void toast.error(r.error.message ?? "Couldn't change the password");
              form.reset();
              toast.success("Password changed");
            }}
          >
            <Field label="Current password" htmlFor="ac-pw-current">
              <Input
                id="ac-pw-current"
                name="current"
                type="password"
                autoComplete="current-password"
                required
              />
            </Field>
            <Field label="New password" htmlFor="ac-pw-new">
              <Input
                id="ac-pw-new"
                name="new"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
              />
            </Field>
            <Button type="submit" loading={loading} className="self-start sm:col-span-2">
              Change password
            </Button>
          </form>
        </SettingsCard>
      )}
      <SettingsCard
        title="Two-factor authentication"
        description="Use an authenticator app. Strongly recommended for anyone who approves payouts."
      >
        {twoFactor ? (
          <Badge tone="success" icon={ShieldCheck} className="self-start">
            Enabled
          </Badge>
        ) : null}
        {!twoFactor && !hasPassword ? (
          <p className="text-[13px] text-muted">Set a password above first. Two-factor setup asks for it.</p>
        ) : null}
        {!twoFactor && hasPassword && !qr ? (
          <form
            className="flex gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              setLoading(true);
              const r = await authClient.twoFactor.enable({
                password: String(new FormData(e.currentTarget).get("password")),
              });
              setLoading(false);
              if (r.error) return void toast.error(r.error.message ?? "Couldn't enable 2FA");
              if (r.data.method !== "totp") return void toast.error("Authenticator setup isn't available");
              setQr(await QRCode.toDataURL(r.data.totpURI));
              setCodes(r.data.backupCodes);
            }}
          >
            <Input
              name="password"
              type="password"
              placeholder="Confirm your password"
              aria-label="Password"
              required
            />
            <Button type="submit" loading={loading}>
              Set up 2FA
            </Button>
          </form>
        ) : null}
        {qr ? (
          <div className="flex flex-col gap-3">
            <img
              src={qr}
              alt="Scan with your authenticator app"
              width={180}
              height={180}
              className="rounded-md border border-border bg-white p-2"
            />
            <p className="text-xs text-muted">
              Backup codes (store them somewhere safe): <span className="font-mono">{codes.join(" ")}</span>
            </p>
            <form
              className="flex gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                const r = await authClient.twoFactor.verifyTotp({
                  code: String(new FormData(e.currentTarget).get("code")),
                });
                if (r.error) return void toast.error(r.error.message ?? "Wrong code");
                toast.success("Two-factor authentication is on");
                setQr(null);
                router.refresh();
              }}
            >
              <Input
                name="code"
                inputMode="numeric"
                placeholder="6-digit code"
                aria-label="Code"
                className="font-mono"
                required
              />
              <Button type="submit" variant="primary">
                Verify
              </Button>
            </form>
          </div>
        ) : null}
        {twoFactor ? (
          <form
            className="flex gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              const r = await authClient.twoFactor.disable({
                password: String(new FormData(e.currentTarget).get("password")),
              });
              if (r.error) return void toast.error(r.error.message ?? "Couldn't disable");
              toast.success("2FA disabled");
              router.refresh();
            }}
          >
            <Input name="password" type="password" placeholder="Password" aria-label="Password" required />
            <Button type="submit" variant="ghost" className="text-danger">
              Disable 2FA
            </Button>
          </form>
        ) : null}
      </SettingsCard>
      <SettingsCard
        title="Your data"
        description="Export everything OpenPromoter stores about you or delete your account (GDPR)."
      >
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="secondary">
            <a href="/api/account/export">Export my data</a>
          </Button>
          {workspaceExport ? (
            <Button asChild variant="secondary">
              <a href={workspaceExport}>Export the whole workspace</a>
            </Button>
          ) : null}
          {!deleting ? (
            <Button variant="ghost" className="text-danger" onClick={() => setDeleting(true)}>
              Delete my account
            </Button>
          ) : null}
        </div>
        {deleting ? (
          <form
            className="flex flex-col gap-3 rounded-md border border-danger/40 p-4"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              setLoading(true);
              const r = await authClient.deleteUser({
                ...(hasPassword ? { password: String(f.get("password")) } : {}),
                callbackURL: "/login",
              });
              setLoading(false);
              if (r.error)
                return void toast.error(
                  r.error.code === "SESSION_EXPIRED"
                    ? "For your safety, sign out and sign in again, then delete within a day."
                    : (r.error.message ?? "Couldn't delete the account"),
                );
              window.location.href = "/login";
            }}
          >
            <p className="text-[13px] text-fg">
              This deletes your login and every program you own alone, with their partners and payout history.
              It can't be undone. To remove one program only, go to{" "}
              <a href={programsHref} className="text-accent-text hover:underline">
                Settings &gt; Programs
              </a>
              .
            </p>
            {hasPassword ? (
              <Field label="Your password" htmlFor="ac-del-pw">
                <Input
                  id="ac-del-pw"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                />
              </Field>
            ) : (
              <Field label='Type "DELETE" to confirm' htmlFor="ac-del-typed">
                <Input
                  id="ac-del-typed"
                  name="typed"
                  autoComplete="off"
                  required
                  pattern="DELETE"
                  title="Type DELETE in capitals"
                />
              </Field>
            )}
            <div className="flex gap-2">
              <Button type="submit" variant="danger" loading={loading}>
                Delete my account for good
              </Button>
              <Button type="button" variant="ghost" onClick={() => setDeleting(false)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : null}
      </SettingsCard>
    </>
  );
}
