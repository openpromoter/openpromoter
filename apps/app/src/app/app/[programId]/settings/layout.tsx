import { SettingsNav } from "./nav";

export default async function SettingsLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ programId: string }>;
}) {
  const { programId } = await params;
  return (
    <>
      <h1 className="mb-4 text-[24px] leading-8 font-medium tracking-[-0.025em] text-fg">Settings</h1>
      <SettingsNav base={`/app/${programId}/settings`} hosted={process.env.HOSTED_MODE === "true"} />
      <div className="mt-6 flex max-w-[1000px] flex-col gap-4">{children}</div>
    </>
  );
}
