import { programLogo } from "@openpromoter/db";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";

/** A program's uploaded logo. Public: it shows on the program page, the portal and in emails. */
export async function GET(_req: Request, { params }: { params: Promise<{ programId: string }> }) {
  const { programId } = await params;
  const [r] = await db()
    .select({ data: programLogo.data, type: programLogo.type })
    .from(programLogo)
    .where(eq(programLogo.programId, programId));
  if (!r) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(r.data), {
    headers: {
      "Content-Type": r.type,
      "Content-Length": String(r.data.length),
      "X-Content-Type-Options": "nosniff",
      // the saved link carries ?v=, so a new upload is a new URL
      "Cache-Control": "public, max-age=86400",
    },
  });
}
