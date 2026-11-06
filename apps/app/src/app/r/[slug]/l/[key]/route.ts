import { after } from "next/server";
import { redirectClick } from "@/server/tracking";

export async function GET(req: Request, { params }: { params: Promise<{ slug: string; key: string }> }) {
  const { slug, key } = await params;
  return redirectClick(req, slug, { linkKey: key }, after);
}
