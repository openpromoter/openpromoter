import { after } from "next/server";
import { redirectClick } from "@/server/tracking";

export async function GET(req: Request, { params }: { params: Promise<{ slug: string; code: string }> }) {
  const { slug, code } = await params;
  return redirectClick(req, slug, { code }, after);
}
