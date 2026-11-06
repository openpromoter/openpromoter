"use client";

import { twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  plugins: [
    twoFactorClient({
      onTwoFactorRedirect() {
        window.location.href = `/login?2fa=1&next=${encodeURIComponent(new URLSearchParams(window.location.search).get("next") ?? "/app")}`;
      },
    }),
  ],
});
