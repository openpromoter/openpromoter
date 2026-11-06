import { PROGRAM_CATEGORIES } from "@openpromoter/db";
import { programCtx } from "@/server/context";
import { cloudflareOn, cnameTarget } from "@/server/custom-hostnames";
import { env } from "@/server/env";
import { BrandingForm } from "./form";

export default async function BrandingSettings({ params }: { params: Promise<{ programId: string }> }) {
  const { programId } = await params;
  const { program: p, role } = await programCtx(programId);
  return (
    <BrandingForm
      programId={programId}
      canWrite={role === "owner" || role === "admin"}
      brand={{
        color: p.brand.color,
        logoUrl: p.brand.logoUrl ?? "",
        headline: p.brand.headline ?? "",
        description: p.brand.description ?? "",
      }}
      name={p.name}
      publicUrl={`${env.APP_URL}/p/${p.slug}`}
      domain={p.customDomain}
      verified={!!p.customDomainVerifiedAt}
      cnameTarget={cnameTarget()}
      autoHttps={cloudflareOn()}
      listed={p.listedInNetwork}
      category={p.category ?? ""}
      categories={PROGRAM_CATEGORIES}
      isPublic={p.visibility === "public"}
      networkUrl={`${env.APP_URL}/network`}
    />
  );
}
