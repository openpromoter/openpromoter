"use server";

import { headers } from "next/headers";
import { auth } from "@/server/auth";
import { safe } from "@/server/context";

/** Adds a password to an account that signs in with Google or GitHub only. */
export async function setPasswordAction(newPassword: string) {
  return safe(async () => {
    const h = await headers();
    const s = await auth.api.getSession({ headers: h, query: { disableCookieCache: true } });
    if (!s) throw new Error("Sign in again and try once more.");
    // a stolen session must not be able to add a password and keep the account: same freshness rule
    // better-auth applies to deleting an account (one day)
    if (Date.now() - new Date(s.session.createdAt).getTime() > 86_400_000)
      throw new Error("For your safety, sign out and sign in again. Then set the password.");
    if (newPassword.length < 8) throw new Error("Use at least 8 characters");
    await auth.api.setPassword({ body: { newPassword }, headers: h });
  }, "Password set. You can now sign in with your email too.");
}
