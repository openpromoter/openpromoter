import { program } from "@openpromoter/db";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/server/db";
import { BrandScope } from "./brand";

export default async function ProgramPublicLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [p] = await db().select().from(program).where(eq(program.slug, slug));
  if (!p) notFound();
  return (
    <BrandScope color={p.brand.color} className="min-h-dvh bg-canvas">
      {children}
    </BrandScope>
  );
}
