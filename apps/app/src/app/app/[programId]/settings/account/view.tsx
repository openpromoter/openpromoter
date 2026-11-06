"use client";

import { Badge, Button, Field, Input } from "@openpromoter/ui";
import { ShieldCheck } from "@openpromoter/ui/icons";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { useState } from "react";
import { toast } from "sonner";
import { SettingsCard } from "@/components/page";
import { authClient } from "@/lib/auth-client";

export function AccountView({
  name,
  email,
  twoFactor,
  workspaceExport,
}: {
  name: string;
  email: string;
  twoFactor: boolean;
  workspaceExport: string | null;
}) {
  const router = useRouter();
  const [qr, setQr] = useState<string | null>(null);
  const [codes, setCodes] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
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
      <SettingsCard
        title="Two-factor authentication"
        description="Use an authenticator app. Strongly recommended for anyone who approves payouts."
      >
        {twoFactor ? (
          <Badge tone="success" icon={ShieldCheck} className="self-start">
            Enabled
          </Badge>
        ) : null}
        {!twoFactor && !qr ? (
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
          <Button
            variant="ghost"
            className="text-danger"
            onClick={async () => {
              const password = window.prompt(
                "Delete your account permanently? Enter your password to confirm.",
              );
              if (!password) return;
              const r = await authClient.deleteUser({ password, callbackURL: "/login" });
              if (r.error) return void toast.error(r.error.message ?? "Couldn't delete the account");
              window.location.href = "/login";
            }}
          >
            Delete my account
          </Button>
        </div>
      </SettingsCard>
    </>
  );
}
