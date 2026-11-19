import { program } from "@openpromoter/db";
import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { db } from "@/server/db";
import { BrandScope } from "./brand";

/** The program's own logo as the tab icon, and a link preview with its name: these links get shared in DMs. */
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const [p] = await db()
    .select({ name: program.name, brand: program.brand })
    .from(program)
    .where(eq(program.slug, slug));
  if (!p) return {};
  const logo = p.brand.logoUrl && /^https?:\/\//i.test(p.brand.logoUrl) ? p.brand.logoUrl : null;
  const title = `${p.name} partner program`;
  return {
    ...(logo ? { icons: { icon: logo, apple: logo } } : {}),
    openGraph: {
      type: "website",
      siteName: p.name,
      title,
      description: p.brand.description,
      ...(logo ? { images: [{ url: logo, alt: `${p.name} logo` }] } : {}),
    },
    twitter: { card: "summary", title, description: p.brand.description },
  };
}

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
