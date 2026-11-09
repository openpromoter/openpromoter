import { type NextRequest, NextResponse } from "next/server";

/**
 * Custom domain → program slug, cached per process. A trigger bumps kv 'domains:version' whenever a program's
 * domain or slug changes (migration 0002); each replica polls that row at most every 5s and drops its cache
 * when it moves, so a domain change reaches every replica within seconds. Entries also expire after 5 minutes.
 */
const cache = new Map<string, { slug: string | null; at: number }>();
const MAX_ENTRIES = 10_000;
const TTL = 5 * 60_000;
const VERSION_EVERY = 5_000;
let version: { value: string | null; checkedAt: number } = { value: null, checkedAt: 0 };
const appHost = () => new URL(process.env.APP_URL ?? "http://localhost:3000").host;

async function db() {
  const [{ db }, schema, orm] = await Promise.all([
    import("./server/db"),
    import("@openpromoter/db"),
    import("drizzle-orm"),
  ]);
  return { db, schema, orm };
}

async function syncVersion() {
  if (Date.now() - version.checkedAt < VERSION_EVERY) return;
  version.checkedAt = Date.now();
  const { db: d, schema, orm } = await db();
  const [row] = await d()
    .select({ at: schema.kvStore.updatedAt })
    .from(schema.kvStore)
    .where(orm.eq(schema.kvStore.key, "domains:version"));
  const v = row?.at.toISOString() ?? "";
  if (version.value !== null && v !== version.value) cache.clear();
  version = { value: v, checkedAt: version.checkedAt };
}

async function slugFor(host: string): Promise<string | null> {
  await syncVersion().catch(() => {});
  const hit = cache.get(host);
  if (hit && Date.now() - hit.at < TTL) return hit.slug;
  const { db: d, schema, orm } = await db();
  const [p] = await d()
    .select({ slug: schema.program.slug })
    .from(schema.program)
    .where(
      orm.and(
        orm.eq(schema.program.customDomain, host),
        orm.isNotNull(schema.program.customDomainVerifiedAt),
      ),
    );
  // bounded: random Host headers can't grow the map without limit
  if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value!);
  cache.set(host, { slug: p?.slug ?? null, at: Date.now() });
  return p?.slug ?? null;
}

/** Custom domains: partners.yourapp.com → program page, portal and short links. */
export async function proxy(req: NextRequest) {
  const host = req.headers.get("host") ?? "";
  if (!host || host === appHost() || host.startsWith("localhost") || host.startsWith("127.0.0.1"))
    return NextResponse.next();
  const name = host.split(":")[0]!.toLowerCase();
  if (!/^[a-z0-9.-]{1,253}$/.test(name)) return NextResponse.next();
  const slug = await slugFor(name);
  if (!slug) return NextResponse.next();
  const path = req.nextUrl.pathname;
  // the program lives at this domain's root: old /p/<slug>/... links land on the clean path. Built from the
  // Host header, since behind the tunnel the request URL carries the internal host.
  const own =
    path === `/p/${slug}` || path.startsWith(`/p/${slug}/`) ? path.slice(slug.length + 3) || "/" : null;
  if (own) {
    const proto = req.headers.get("x-forwarded-proto")?.split(",")[0] ?? req.nextUrl.protocol.replace(":", "");
    return NextResponse.redirect(new URL(own + req.nextUrl.search, `${proto}://${host}`), 307);
  }
  if (/^\/(api|_next|op\.js|favicon|login|signup|forgot|reset)/.test(path)) return NextResponse.next();
  const url = req.nextUrl.clone();
  if (path === "/" || /^\/(apply|portal)(\/|$)/.test(path))
    url.pathname = `/p/${slug}${path === "/" ? "" : path}`;
  else if (/^\/[\w-]{1,64}$/.test(path)) url.pathname = `/r/${slug}/l${path}`;
  else return NextResponse.next();
  return NextResponse.rewrite(url);
}

export const config = { matcher: ["/((?!_next/static|_next/image).*)"] };
