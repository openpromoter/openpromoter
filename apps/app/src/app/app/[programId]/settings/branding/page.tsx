import { PROGRAM_CATEGORIES } from "@openpromoter/db";
import { subdomainOrigin } from "@/lib/subdomain";
import { programCtx } from "@/server/context";
import { cloudflareOn, cnameTarget } from "@/server/custom-hostnames";
import { env } from "@/server/env";
import { programUrl } from "@/server/ref-link";
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
      publicUrl={programUrl(p)}
      domain={p.customDomain}
      // a verified custom domain is the program's one address (its subdomain redirects there)
      freeAddress={
        p.customDomainVerifiedAt ? null : (subdomainOrigin(p.slug)?.replace(/^https?:\/\//, "") ?? null)
      }
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
