import QRCode from "qrcode";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const target = url.searchParams.get("url") ?? "";
  if (!/^https?:\/\//.test(target) || target.length > 2000) return new Response("Bad url", { status: 400 });
  const svg = await QRCode.toString(target, {
    type: "svg",
    margin: 1,
    color: { dark: "#15191A", light: "#FFFFFF" },
  });
  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=86400",
      ...(url.searchParams.get("download") ? { "Content-Disposition": 'attachment; filename="qr.svg"' } : {}),
    },
  });
}
