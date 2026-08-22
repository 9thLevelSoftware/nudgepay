// PostgREST/Supabase list cap: a page shorter than `count` is truncated.
// Never treat a truncated set as complete (recon must not auto-resolve).
// pageAll / pageAllChunked are for dedicated peek / payer / AR reads only —
// they do not page Stage-1 of loadCaseQueueSource.

export const POSTGREST_MAX_ROWS = 1000;
export const PAGE_ALL_MAX_ROWS = 5000;

export type PageAllPage<T> = {
  data: T[] | null;
  count: number | null;
  error: { message: string } | null;
};

export type PageAllResult<T> = { rows: T[]; truncated: boolean };

export function isTruncatedPage(length: number, count: number | null | undefined): boolean {
  if (count == null || !Number.isFinite(count)) return false;
  return length < count;
}

export function assertNotTruncated(
  length: number,
  count: number | null | undefined,
  label: string,
): void {
  if (isTruncatedPage(length, count)) {
    throw new Error(`${label} truncated: page is incomplete`);
  }
}

export async function pageAll<T>(
  run: (from: number, to: number) => PromiseLike<PageAllPage<T>>,
  opts?: { pageSize?: number; maxRows?: number },
): Promise<PageAllResult<T>> {
  const pageSize = opts?.pageSize ?? POSTGREST_MAX_ROWS;
  const maxRows = opts?.maxRows ?? PAGE_ALL_MAX_ROWS;
  const rows: T[] = [];
  let from = 0;
  for (;;) {
    const to = Math.min(from + pageSize - 1, maxRows - 1);
    const { data, count, error } = await run(from, to);
    if (error) throw error;
    const page = data ?? [];
    rows.push(...page);
    const requested = to - from + 1;
    const exhausted = page.length < requested;
    const hitCap = rows.length >= maxRows;
    const moreInDb = count != null && count > rows.length;
    if (hitCap) {
      // count == pulled → complete; unknown count + a full last page → assume more.
      const truncated = moreInDb || (count == null && !exhausted);
      return { rows: rows.slice(0, maxRows), truncated };
    }
    if (exhausted) return { rows, truncated: moreInDb };
    from += pageSize;
  }
}

/**
 * Chunked `.in(id)` reads with **one** running cap across all chunks.
 * Stop when `rows.length >= maxRows`. `truncated` if any remaining chunk
 * was skipped or a chunk's `count` exceeds what was pulled.
 */
export async function pageAllChunked<T>(
  idChunks: string[][],
  runChunk: (
    ids: string[],
    from: number,
    to: number,
  ) => PromiseLike<PageAllPage<T>>,
  opts?: { pageSize?: number; maxRows?: number },
): Promise<PageAllResult<T>> {
  const maxRows = opts?.maxRows ?? PAGE_ALL_MAX_ROWS;
  const acc: T[] = [];
  for (let i = 0; i < idChunks.length; i++) {
    const remaining = maxRows - acc.length;
    if (remaining <= 0) return { rows: acc, truncated: true };
    const part = await pageAll<T>(
      (from, to) => runChunk(idChunks[i], from, to),
      { pageSize: opts?.pageSize, maxRows: remaining },
    );
    acc.push(...part.rows);
    if (part.truncated) return { rows: acc.slice(0, maxRows), truncated: true };
  }
  return { rows: acc, truncated: false };
}

export function chunkIds(ids: string[], size = 100): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}
