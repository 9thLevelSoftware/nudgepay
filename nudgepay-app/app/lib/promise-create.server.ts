import type { SupabaseClient } from "@supabase/supabase-js";

export type CreatePromiseInput = {
  orgId: string;
  caseId: string;
  customerId: string;
  userId: string;
  contactLogId: string | null;
  promisedAmount: number;
  promisedDate: string;
};

// Creates a pending promise for a case, superseding any prior pending promise.
// Writes go through create_promise: grace and created_by are computed in SQL
// (org config / auth.uid()), not taken from the JWT caller.
export async function createPromiseForLog(
  client: SupabaseClient, input: CreatePromiseInput,
): Promise<{ ok: true; promiseId: string } | { ok: false }> {
  const { data, error } = await client.rpc("create_promise", {
    p_org_id: input.orgId,
    p_case_id: input.caseId,
    p_customer_id: input.customerId,
    p_contact_log_id: input.contactLogId,
    p_promised_amount: input.promisedAmount,
    p_promised_date: input.promisedDate,
  });
  if (error || !data) return { ok: false };
  return { ok: true, promiseId: data as string };
}
