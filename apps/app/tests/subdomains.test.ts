import { afterEach, describe, expect, it } from "vitest";
import { subdomainOrigin, subdomainSlug } from "@/lib/subdomain";
import { domainOrigin, linkUrl } from "@/server/ref-link";

const prev = { root: process.env.PROGRAM_SUBDOMAINS, app: process.env.APP_URL };
afterEach(() => {
  process.env.PROGRAM_SUBDOMAINS = prev.root;
  process.env.APP_URL = prev.app;
});
const on = () => {
  process.env.PROGRAM_SUBDOMAINS = "openpromoter.com";
  process.env.APP_URL = "https://app.openpromoter.com";
};

describe("free program subdomains", () => {
  it("are off until PROGRAM_SUBDOMAINS is set", () => {
    delete process.env.PROGRAM_SUBDOMAINS;
    expect(subdomainSlug("acme.openpromoter.com")).toBeNull();
    expect(subdomainOrigin("acme")).toBeNull();
  });
  it("map one label under the root to a slug, never our own names", () => {
    on();
    expect(subdomainSlug("acme.openpromoter.com")).toBe("acme");
    expect(subdomainSlug("Acme.OpenPromoter.com:443")).toBe("acme");
    for (const h of ["app.openpromoter.com", "www.openpromoter.com", "api.openpromoter.com", "openpromoter.com"])
      expect(subdomainSlug(h)).toBeNull();
    expect(subdomainSlug("a.b.openpromoter.com")).toBeNull();
    expect(subdomainSlug("acme.evil-openpromoter.com")).toBeNull();
    expect(subdomainSlug("partners.acme.com")).toBeNull();
  });
  it("links use the subdomain, and a verified custom domain wins over it", () => {
    on();
    const p = { slug: "acme", customDomain: null, customDomainVerifiedAt: null };
    expect(domainOrigin(p)).toBe("https://acme.openpromoter.com");
    expect(linkUrl(p, "maya1")).toBe("https://acme.openpromoter.com/maya1");
    expect(domainOrigin({ ...p, customDomain: "partners.acme.com", customDomainVerifiedAt: new Date() })).toBe(
      "https://partners.acme.com",
    );
    // a slug that can't be a hostname label stays on the app's /p/ path
    expect(domainOrigin({ ...p, slug: "app" })).toBeNull();
  });
  it("keep the app's scheme and port locally", () => {
    process.env.PROGRAM_SUBDOMAINS = "localhost";
    process.env.APP_URL = "http://localhost:3000";
    expect(subdomainOrigin("calcom")).toBe("http://calcom.localhost:3000");
  });
});
