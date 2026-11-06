"use client";

import { Button, Field, Input } from "@openpromoter/ui";
import { useRouter } from "next/navigation";
import { SettingsCard } from "@/components/page";
import { useAction } from "@/components/use-action";
import { createProgramAction } from "../../settings-actions";

export function NewProgram({ programId }: { programId: string }) {
  const { pending, run } = useAction();
  const router = useRouter();
  return (
    <SettingsCard title="New program" description="Branded automatically from the website you enter.">
      <form
        className="flex flex-col gap-3"
        action={(f) =>
          run(
            () =>
              createProgramAction(programId, {
                websiteUrl: String(f.get("url")),
                name: String(f.get("name") || ""),
              }),
            "Program created",
            (id) => router.push(`/onboarding?program=${id}&step=3`),
          )
        }
      >
        <Field label="Website" htmlFor="np-url">
          <Input id="np-url" name="url" required placeholder="product.com" />
        </Field>
        <Field label="Name" htmlFor="np-name">
          <Input id="np-name" name="name" />
        </Field>
        <Button type="submit" variant="primary" loading={pending} className="self-start">
          Create program
        </Button>
      </form>
    </SettingsCard>
  );
}
