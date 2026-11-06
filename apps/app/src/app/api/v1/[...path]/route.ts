import { ZodError } from "zod";
import { ApiError, authenticate, match } from "@/server/api";

async function handle(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  try {
    const m = match(req.method, `/${path.join("/")}`);
    if (!m) throw new ApiError(404, "not_found", `No route ${req.method} /${path.join("/")}`);
    const ctx = await authenticate(req);
    if (!ctx.scopes.includes(m.route.scope))
      throw new ApiError(403, "forbidden", `This key needs the "${m.route.scope}" scope`);
    const url = new URL(req.url);
    const query = m.route.query ? m.route.query.parse(Object.fromEntries(url.searchParams)) : {};
    const body = m.route.body ? m.route.body.parse(await req.json().catch(() => ({}))) : {};
    return Response.json(await m.route.handler(ctx, { params: m.params, query, body }));
  } catch (err) {
    if (err instanceof ApiError)
      return Response.json({ error: { code: err.code, message: err.message } }, { status: err.status });
    if (err instanceof ZodError)
      return Response.json(
        {
          error: {
            code: "invalid_request",
            message: "Invalid request",
            issues: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
          },
        },
        { status: 400 },
      );
    const message = err instanceof Error ? err.message : "Internal error";
    if (/not found/i.test(message))
      return Response.json({ error: { code: "not_found", message } }, { status: 404 });
    // a unique key someone already used, e.g. a link key
    if (
      (err as { code?: string }).code === "23505" ||
      (err as { cause?: { code?: string } }).cause?.code === "23505"
    )
      return Response.json(
        { error: { code: "conflict", message: "That value is already taken" } },
        { status: 409 },
      );
    if (/must point|already|isn't|can't|cannot/i.test(message))
      return Response.json({ error: { code: "invalid_request", message } }, { status: 400 });
    console.error(`[api] ${req.method} /${path.join("/")}: ${message}`);
    return Response.json({ error: { code: "internal", message: "Internal error" } }, { status: 500 });
  }
}

export { handle as GET, handle as PATCH, handle as POST };
