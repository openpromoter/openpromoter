import { and, desc, eq, lt, or, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { toCsv } from "@/lib/csv";

const PAGE = 5000;
const enc = new TextEncoder();

/**
 * Pages through a table newest first with a (created_at, id) keyset, so an export of 1M rows holds one page in
 * memory at a time and every query is an index range scan.
 */
export async function* keyset<T>(
  cols: { createdAt: PgColumn; id: PgColumn },
  fetch: (after: SQL | undefined, order: SQL[], limit: number) => Promise<T[]>,
  cursor: (row: T) => { createdAt: Date; id: string },
): AsyncGenerator<T[]> {
  let after: SQL | undefined;
  for (;;) {
    const rows = await fetch(after, [desc(cols.createdAt), desc(cols.id)], PAGE);
    if (rows.length) yield rows;
    if (rows.length < PAGE) return;
    const last = cursor(rows[rows.length - 1]!);
    after = or(
      lt(cols.createdAt, last.createdAt),
      and(eq(cols.createdAt, last.createdAt), lt(cols.id, last.id)),
    );
  }
}

const headers = (type: string, filename: string) => ({
  "Content-Type": type,
  "Content-Disposition": `attachment; filename="${filename}"`,
  "Cache-Control": "no-store",
});

/** Streams CSV pages (same escaping and formula-injection guard as lib/csv). */
export function csvStream(
  filename: string,
  columns: string[],
  pages: AsyncIterable<Record<string, unknown>[]>,
): Response {
  const header = columns.join(",");
  const it = pages[Symbol.asyncIterator]();
  let first = true;
  return new Response(
    new ReadableStream<Uint8Array>({
      async pull(ctrl) {
        if (first) {
          first = false;
          ctrl.enqueue(enc.encode(header));
        }
        const { done, value } = await it.next();
        if (done) return ctrl.close();
        ctrl.enqueue(enc.encode(toCsv(value, columns).slice(header.length)));
      },
      cancel: () => void it.return?.(),
    }),
    { headers: headers("text/csv; charset=utf-8", filename) },
  );
}

/** Streams `{ "key": value | [ ...pages ] }` without building the whole document in memory. */
export function jsonStream(
  filename: string,
  parts: [key: string, value: unknown | (() => AsyncIterable<unknown[]>)][],
): Response {
  async function* chunks() {
    yield "{";
    for (const [i, [key, value]] of parts.entries()) {
      yield `${i ? "," : ""}${JSON.stringify(key)}:`;
      if (typeof value !== "function") {
        yield JSON.stringify(value);
        continue;
      }
      yield "[";
      let n = 0;
      for await (const page of (value as () => AsyncIterable<unknown[]>)())
        for (const row of page) yield `${n++ ? "," : ""}${JSON.stringify(row)}`;
      yield "]";
    }
    yield "}";
  }
  const it = chunks();
  return new Response(
    new ReadableStream<Uint8Array>({
      async pull(ctrl) {
        // batch small strings into ~64 KB writes
        let buf = "";
        while (buf.length < 65_536) {
          const { done, value } = await it.next();
          if (done) {
            if (buf) ctrl.enqueue(enc.encode(buf));
            return ctrl.close();
          }
          buf += value;
        }
        ctrl.enqueue(enc.encode(buf));
      },
      cancel: () => void it.return(undefined),
    }),
    { headers: headers("application/json", filename) },
  );
}
