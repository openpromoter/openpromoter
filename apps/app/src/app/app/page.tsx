import { redirect } from "next/navigation";
import { requireUser, userPrograms } from "@/server/context";

export default async function AppIndex() {
  const u = await requireUser();
  const programs = await userPrograms(u.id);
  if (programs.length === 0) redirect("/onboarding");
  redirect(`/app/${programs[0]!.id}`);
}
