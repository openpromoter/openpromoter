import { describe, expect, it } from "vitest";
import { generateMetadata } from "@/app/p/[slug]/layout";
import { fixture } from "./helpers";

const meta = (slug: string) => generateMetadata({ params: Promise.resolve({ slug }) });

describe("program page metadata", () => {
  it("uses the program logo as the tab icon and in the link preview", async () => {
    const { program } = await fixture({
      name: "Love Wrapped",
      brand: { color: "#B8141B", logoUrl: "https://lw.test/logo.png", description: "Your chat as a story." },
    });
    const m = await meta(program.slug);
    expect(m.icons).toEqual({ icon: "https://lw.test/logo.png", apple: "https://lw.test/logo.png" });
    expect(m.openGraph).toMatchObject({
      siteName: "Love Wrapped",
      title: "Love Wrapped partner program",
      description: "Your chat as a story.",
      images: [{ url: "https://lw.test/logo.png", alt: "Love Wrapped logo" }],
    });
  });

  it("keeps the default icon when there is no safe logo link", async () => {
    const { program } = await fixture({ brand: { color: "#B8141B", logoUrl: "javascript:alert(1)" } });
    const m = await meta(program.slug);
    expect(m.icons).toBeUndefined();
    expect(m.openGraph).not.toHaveProperty("images");
  });

  it("returns nothing for an unknown program", async () => {
    expect(await meta("no-such-program")).toEqual({});
  });
});
