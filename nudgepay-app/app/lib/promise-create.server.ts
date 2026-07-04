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
// All writes go through the supplied (user/RLS) client. Returns ok/error so the
// action can surface a single banner. Links all of the case's currently-overdue
// invoices and snapshots their summed balance as the baseline.
export async function createPromiseForLog(
  client: SupabaseClient, input: CreatePromiseInput,
): Promise<{ ok: true; promiseId: string } | { ok: false }> {
  const { data: cse, error: caseSelErr } = await client
    .from("collection_cases")
    .select("id, customer_id")
    .eq("org_id", input.orgId)
    .eq("id", input.caseId)
    .maybeSingle();
  if (caseSelErr || !cse || cse.customer_id !== input.customerId) return { ok: false };

  // Links all open-balance invoices (not just the overdue subset) because balance-delta
  // counts any payment against the customer's balance, and baseline+eval use the identical stored set.
  const { data: invs, error: iErr } = await client
    .from("invoices")
    .select("id, balance")
    .eq("org_id", input.orgId)
    .eq("customer_id", input.customerId)
    .gt("balance", 0);
  if (iErr) return { ok: false };
  const linked = (invs ?? []).map((r) => ({ id: r.id as string, balance: Number(r.balance) || 0 }));
  const baseline = linked.reduce((s, r) => s + r.balance, 0);
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

  // Supersede any existing pending promise to free the partial-unique slot.
  const { data: priors, error: sErr } = await client
    .from("promises")
    .update({ status: "renegotiated", resolved_at: new Date().toISOString() })
    .eq("org_id", input.orgId).eq("case_id", input.caseId).eq("status", "pending")
    .select("id");
  if (sErr) return { ok: false };

  const { data: created, error: cErr } = await client.from("promises").insert({
    org_id: input.orgId, case_id: input.caseId, customer_id: input.customerId,
    status: "pending", promised_amount: input.promisedAmount, promised_date: input.promisedDate,
    grace_until: graceUntil, baseline_balance: baseline, contact_log_id: input.contactLogId,
    created_by: input.userId,
  }).select("id").single();
  if (cErr || !created) return { ok: false };
  const promiseId = created.id as string;

  if (linked.length > 0) {
    const { error: liErr } = await client.from("promise_invoices").insert(
      linked.map((r) => ({ promise_id: promiseId, invoice_id: r.id, org_id: input.orgId, baseline_balance: r.balance })),
    );
    if (liErr) return { ok: false };
  }

  // Point the (single) superseded promise at the replacement.
  if (priors && priors.length > 0) {
    const { error: rErr } = await client.from("promises")
      .update({ replacement_promise_id: promiseId })
      .eq("org_id", input.orgId)
      .eq("id", priors[0].id as string);
    if (rErr) return { ok: false };
  }

  // Reflect into the case state machine.
  const { error: caseErr } = await client.from("collection_cases")
    .update({ status: "promised", next_action_type: "promise", next_action_at: graceUntil, exception_reason: null, exception_note: null })
    .eq("org_id", input.orgId)
    .eq("id", input.caseId);
  if (caseErr) return { ok: false };

  return { ok: true, promiseId };
}
