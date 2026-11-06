export interface ListParams {
  q: string;
  status: string | null;
  page: number;
  pageSize: number;
  sort: { key: string; dir: "asc" | "desc" } | null;
  view: string | null;
  partner: string | null;
}

export function listParams(sp: Record<string, string | string[] | undefined>, pageSize = 50): ListParams {
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k]![0] : sp[k]) ?? null;
  const [key, dir] = (one("sort") ?? "").split(":");
  return {
    q: (one("q") ?? "").slice(0, 80),
    status: one("status"),
    page: Math.max(1, Number(one("page") ?? 1) || 1),
    pageSize,
    sort: key ? { key, dir: dir === "asc" ? "asc" : "desc" } : null,
    view: one("view"),
    partner: one("partner"),
  };
}

export const like = (q: string) => `%${q.replace(/[%_\\]/g, "")}%`;
