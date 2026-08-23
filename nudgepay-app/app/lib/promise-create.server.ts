import type { SupabaseClient } from "@supabase/supabase-js";
import { addBusinessDays } from "./business-days";
import { loadOrgConfig } from "./org-config.server";

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
// Grace stays in TS; writes go through create_promise so the replacement pointer
// on an already-renegotiated row is not subject to member UPDATE (pending-only).
export async function createPromiseForLog(
  client: SupabaseClient, input: CreatePromiseInput,
): Promise<{ ok: true; promiseId: string } | { ok: false }> {
  let config;
  try {
    config = await loadOrgConfig(client, input.orgId);
  } catch {
    return { ok: false };
  }
  const graceUntil = addBusinessDays(input.promisedDate, config.promiseGraceDays, {
    workingDays: config.workingDays,
    holidays: config.holidays,
  });

  const { data, error } = await client.rpc("create_promise", {
    p_org_id: input.orgId,
    p_case_id: input.caseId,
    p_customer_id: input.customerId,
    p_user_id: input.userId,
    p_contact_log_id: input.contactLogId,
    p_promised_amount: input.promisedAmount,
    p_promised_date: input.promisedDate,
    p_grace_until: graceUntil,
  });
  if (error || !data) return { ok: false };
  return { ok: true, promiseId: data as string };
}
