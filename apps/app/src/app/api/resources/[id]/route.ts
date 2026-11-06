import { resource } from "@openpromoter/db";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";

/** Uploaded creatives are public (random ids) so partners can download or hot-link them. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [r] = await db()
    .select({ name: resource.fileName, type: resource.fileType, data: resource.fileData })
    .from(resource)
    .where(eq(resource.id, id));
  if (!r?.data || !r.type) return new Response("Not found", { status: 404 });
  const download = new URL(req.url).searchParams.has("download");
  const name = (r.name ?? "file").replace(/[^\w.-]+/g, "_");
  return new Response(new Uint8Array(r.data), {
    headers: {
      "Content-Type": r.type,
      "Content-Length": String(r.data.length),
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${name}"`,
      "Cache-Control": "public, max-age=86400",
    },
  });
}
