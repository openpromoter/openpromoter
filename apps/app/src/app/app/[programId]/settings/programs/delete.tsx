"use client";

import { Button, Field, Input } from "@openpromoter/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { SettingsCard } from "@/components/page";
import { useAction } from "@/components/use-action";
import { deleteProgramAction } from "../../settings-actions";

export function DeleteProgram({
  programId,
  name,
  created,
}: {
  programId: string;
  name: string;
  created: string;
}) {
  const { pending, run } = useAction();
  const router = useRouter();
  const [typed, setTyped] = useState("");
  return (
    <SettingsCard
      title="Delete this program"
      description={`Deletes ${name} (created ${created}) with its partners, commissions, links and payout history. Your account and other programs stay. Export what you need first.`}
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          run(
            () => deleteProgramAction(programId, typed),
            "Program deleted",
            (to) => router.push(to ?? "/app"),
          );
        }}
      >
        <Field label={`Type "${name}" to confirm`} htmlFor="dp-name">
          <Input id="dp-name" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
        </Field>
        <Button
          type="submit"
          variant="danger"
          loading={pending}
          disabled={typed !== name}
          className="self-start"
        >
          Delete program
        </Button>
      </form>
    </SettingsCard>
  );
}
