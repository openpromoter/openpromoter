import { contentAsset, program } from "@openpromoter/db";
import { eq } from "drizzle-orm";
import { onColor } from "@/server/ai/brand";
import { bannerSvg } from "@/server/ai/content";
import { db } from "@/server/db";

/** Banners are public so partners can hot-link them on their sites. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [row] = await db()
    .select({ a: contentAsset, p: program })
    .from(contentAsset)
    .innerJoin(program, eq(program.id, contentAsset.programId))
    .where(eq(contentAsset.id, id));
  if (row?.a.kind !== "banner") return new Response("Not found", { status: 404 });
  const m = (row.a.meta ?? {}) as { width?: number; height?: number };
  const svg = bannerSvg({
    width: m.width ?? 1200,
    height: m.height ?? 628,
    name: row.p.name,
    headline: row.a.body,
    color: row.p.brand.color,
    fg: onColor(row.p.brand.color),
  });
  const dl = new URL(req.url).searchParams.get("download");
  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=3600",
      ...(dl
        ? { "Content-Disposition": `attachment; filename="${row.p.slug}-${m.width}x${m.height}.svg"` }
        : {}),
    },
  });
}
