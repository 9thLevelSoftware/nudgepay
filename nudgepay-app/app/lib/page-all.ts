// PostgREST/Supabase list cap: a page shorter than `count` is truncated.
// Never treat a truncated set as complete (recon must not auto-resolve).

export const POSTGREST_MAX_ROWS = 1000;

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
