/** Normalize Supabase CLI JSON output across supported CLI/runtime versions. */
export function parseLocalQueryRows<T>(raw: string): T[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Local query returned invalid JSON.");
  }
  const rows = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { rows?: unknown }).rows)
      ? (parsed as { rows: unknown[] }).rows
      : null;
  if (rows) {
    if (rows.some((row) => !row || typeof row !== "object" || Array.isArray(row))) {
      throw new Error("Local query JSON rows must be non-null objects.");
    }
    return rows as T[];
  }
  throw new Error("Local query JSON must be a row array or an object with a rows array.");
}
