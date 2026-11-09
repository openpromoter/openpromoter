"use client";

import { Button, Input } from "@openpromoter/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAction } from "@/components/use-action";
import { sendTestEmailAction } from "./actions";

/** Send one test email. Amazon's simulator addresses test delivery and bounces without a real inbox. */
export function TestEmailForm() {
  const [to, setTo] = useState("success@simulator.amazonses.com");
  const { pending, run } = useAction();
  const router = useRouter();
  return (
    <form
      className="flex w-full max-w-[460px] gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () => sendTestEmailAction(to),
          undefined,
          () => router.refresh(),
        );
      }}
    >
      <Input
        type="email"
        value={to}
        onChange={(e) => setTo(e.target.value)}
        aria-label="Send a test email to"
        list="ses-simulator"
        required
      />
      <datalist id="ses-simulator">
        <option value="success@simulator.amazonses.com">Always delivered</option>
        <option value="bounce@simulator.amazonses.com">Always bounces</option>
        <option value="complaint@simulator.amazonses.com">Marked as spam</option>
      </datalist>
      <Button type="submit" loading={pending}>
        Send test
      </Button>
    </form>
  );
}
