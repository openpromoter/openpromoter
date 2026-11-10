import { applyUnsubscribe, readToken } from "@/server/unsubscribe";

/**
 * GET shows a confirm button (mail scanners open links, so a GET must change nothing).
 * POST unsubscribes: the button, and the one-click request mail apps send (RFC 8058,
 * body "List-Unsubscribe=One-Click").
 */
const page = (title: string, body: string, form = "") =>
  new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title>
<style>
:root{color-scheme:light dark}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#F4F4F1;font-family:Inter,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#16171A;padding:16px}
main{max-width:420px;width:100%;background:#fff;border:1px solid #E4E4E0;border-radius:12px;padding:28px}
h1{margin:0;font-size:20px;line-height:28px;font-weight:500}
p{margin:8px 0 0;font-size:15px;line-height:24px;color:#5F6066}
button{margin-top:20px;height:36px;padding:0 14px;border:0;border-radius:8px;background:#2442F5;color:#fff;font:500 14px/36px inherit;cursor:pointer}
@media (prefers-color-scheme:dark){body{background:#0C0C0D;color:#EDEDEE}main{background:#131315;border-color:#2F2F33}p{color:#A1A1A7}}
</style></head><body><main><h1>${title}</h1><p>${body}</p>${form}</main></body></html>`,
    { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
  );

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => `&${{ "&": "amp", "<": "lt", ">": "gt", '"': "quot" }[c]};`);

export async function GET(req: Request) {
  const t = new URL(req.url).searchParams.get("t") ?? "";
  if (!readToken(t)) return page("Link not valid", "This unsubscribe link is broken or incomplete.");
  return page(
    "Unsubscribe from these emails?",
    "You'll stop getting this type of email. Payouts and account emails still arrive.",
    `<form method="post" action="?t=${esc(encodeURIComponent(t))}"><button type="submit">Unsubscribe</button></form>`,
  );
}

export async function POST(req: Request) {
  const t = new URL(req.url).searchParams.get("t") ?? "";
  const what = await applyUnsubscribe(t);
  if (!what) return page("Link not valid", "This unsubscribe link is broken or incomplete.");
  return page("You're unsubscribed", `You won't get ${esc(what)} by email anymore.`);
}
