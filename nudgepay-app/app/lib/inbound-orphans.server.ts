import type { SupabaseClient } from "@supabase/supabase-js";

export type UnmatchedStop = {
  id: string;
  fromNumber: string;
  toNumber: string;
  createdAt: string;
};

export type UnmatchedStopPage = {
  rows: UnmatchedStop[];
  loadError: string | null;
};

export const UNMATCHED_STOP_LOAD_ERROR = "Could not load unmatched STOPs.";

type OrphanStopRow = {
  id: string;
  from_number: string | null;
  to_number: string | null;
  created_at: string;
};

/** Map a query result. Error is never coerced to a healthy empty list. */
export function unmatchedStopsFromQuery(args: {
  data: OrphanStopRow[] | null;
  error: { message: string } | null;
}): UnmatchedStopPage {
  if (args.error) return { rows: [], loadError: UNMATCHED_STOP_LOAD_ERROR };
  return {
    rows: (args.data ?? []).map((r) => ({
      id: r.id,
      fromNumber: r.from_number ?? "",
      toNumber: r.to_number ?? "",
      createdAt: r.created_at,
    })),
    loadError: null,
  };
}

/**
 * Service-operator ledger for recent unmatched inbound STOP rows.
 * `inbound_orphans` has no org_id, so these records cannot be attributed to or
 * displayed inside any tenant workspace. Service role is required by RLS.
 */
export async function listRecentUnmatchedStops(
  service: SupabaseClient,
  limit = 20,
): Promise<UnmatchedStopPage> {
  const { data, error } = await service
    .from("inbound_orphans")
    .select("id, from_number, to_number, created_at")
    .eq("keyword", "stop")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("[inbound_orphans] unmatched STOP list failed:", error.message);
  }
  return unmatchedStopsFromQuery({
    data: (data as OrphanStopRow[] | null) ?? null,
    error: error ? { message: error.message } : null,
  });
}
