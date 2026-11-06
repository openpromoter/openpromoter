import { PageHeader } from "@/components/page";
import { partnerCtx } from "@/server/context";
import { TaxForm } from "./tax";

export default async function PortalSettings({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { partner: pt } = await partnerCtx(slug);
  return (
    <>
      <PageHeader
        title="Settings"
        description="Tax details for your commission invoices. Stored encrypted."
      />
      <TaxForm
        slug={slug}
        form={pt.taxFormType ?? (pt.country && pt.country !== "US" ? "w8ben" : "w9")}
        status={pt.taxFormStatus}
        legalName={pt.taxLegalName ?? pt.name}
        address={pt.taxAddress ?? ""}
        country={pt.country ?? ""}
        vatId={pt.vatId ?? ""}
        hasTin={!!pt.taxIdEnc}
        viaStripe={pt.stripePayoutsEnabled}
      />
    </>
  );
}
