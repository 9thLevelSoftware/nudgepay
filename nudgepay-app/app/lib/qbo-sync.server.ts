import type { SupabaseClient } from "@supabase/supabase-js";
import { getValidAccessToken } from "./qbo-connection.server";
import { qboQuery, qboReadEntity, qboCdc, type QboApiConfig } from "./qbo-api.server";
import {
  mapQboCustomer, mapQboInvoice, mapQboPayment,
  type CustomerUpsert, type InvoiceUpsert, type PaymentUpsert,
} from "./qbo-mappers.server";
import type { QboHttpConfig } from "./qbo-client.server";
import { applyCaseReconciliation } from "./case-lifecycle.server";
import { applyPromiseEvaluation, type BrokenPromiseDetail } from "./promise-evaluation.server";
import { loadOrgConfig } from "./org-config.server";
import { DEFAULT_ORG_CONFIG } from "./org-config";

export type NotifyFn = (orgId: string, brokenDetails: BrokenPromiseDetail[], today: string) => Promise<void>;

export type SyncDeps = {
  fetchFn: typeof fetch;
  service: SupabaseClient;
  cfg: QboHttpConfig;   // for token refresh inside getValidAccessToken
  api: QboApiConfig;    // data API base url
  key: string;          // AES key for token decrypt
  notify?: NotifyFn;    // optional broken-promise alert callback
};

// QBO query page cap. Chancey carries 125-175 overdue invoices; CDC caps at
// 1000. A single page of 1000 covers this org; >1000 is flagged (truncated).
export const QUERY_LIMIT = 1000;

export async function upsertCustomers(service: SupabaseClient, rows: CustomerUpsert[]): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await service.from("customers").upsert(rows, { onConflict: "org_id,qbo_id" });
  if (error) throw error;
}

export async function upsertInvoices(service: SupabaseClient, rows: InvoiceUpsert[]): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await service.from("invoices").upsert(rows, { onConflict: "org_id,qbo_id" });
  if (error) throw error;
}

export async function upsertPayments(service: SupabaseClient, rows: PaymentUpsert[]): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await service.from("payments").upsert(rows, { onConflict: "org_id,qbo_id,type" });
  if (error && (error as any).code !== "23505") throw error;
}

// Resolve QBO customer ids -> our customer UUIDs for an org (covers both
// just-upserted and pre-existing customers).
export async function customerIdMap(
  service: SupabaseClient, orgId: string, qboCustomerIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const ids = [...new Set(qboCustomerIds.filter(Boolean))];
  if (ids.length === 0) return map;
  const { data, error } = await service.from("customers")
    .select("id, qbo_id").eq("org_id", orgId).in("qbo_id", ids);
  if (error) throw error;
  for (const row of data ?? []) map.set(row.qbo_id as string, row.id as string);
  return map;
}

// B3-bug fix: re-pull ALL invoices for the given QBO customers (no Balance>0
// filter) so an invoice paid outside the periodic-overdue window updates to its
// real balance and its case can auto-resolve.
export async function repullCustomerInvoices(
  deps: SyncDeps, orgId: string, accessToken: string, realmId: string, qboCustomerIds: string[],
): Promise<void> {
  const ids = [...new Set(qboCustomerIds.filter(Boolean))];
  if (ids.length === 0) return;
  const idList = ids.map((id) => `'${id}'`).join(",");
  const invoices = await qboQuery(
    deps.fetchFn, deps.api, accessToken, realmId,
    `select * from Invoice where CustomerRef in (${idList}) startposition 1 maxresults ${QUERY_LIMIT}`,
    "Invoice",
  );
  if (invoices.length === 0) return;
  const idMap = await customerIdMap(deps.service, orgId, ids);
  const now = new Date();
  const rows = invoices.map((inv) =>
    mapQboInvoice(inv, orgId, idMap.get(String(inv?.CustomerRef?.value)) ?? null, now));
  await upsertInvoices(deps.service, rows);
}

export async function applyPaymentsAndEvaluate(
  deps: SyncDeps, orgId: string, accessToken: string, realmId: string,
  paymentRaws: { raw: any; type: "payment" | "credit_memo" }[],
  today: string, now: Date,
): Promise<void> {
  const allPayCustQboIds = paymentRaws.map((e) => e?.raw?.CustomerRef?.value);
  const droppedIds = paymentRaws
    .filter((e) => !e?.raw?.CustomerRef?.value)
    .map((e) => e?.raw?.Id ?? "(unknown)");
  if (droppedIds.length > 0) {
    console.warn("[6b] payment with no CustomerRef; skipping re-pull", droppedIds);
  }
  const payCustQboIds = allPayCustQboIds.filter(Boolean).map(String);
  const payIdMap = await customerIdMap(deps.service, orgId, payCustQboIds);
  const paymentRows = paymentRaws.map((e) =>
    mapQboPayment(e.raw, e.type, orgId, payIdMap.get(String(e?.raw?.CustomerRef?.value)) ?? null, now));
  await upsertPayments(deps.service, paymentRows);

  if (payCustQboIds.length > 0) {
    try { await repullCustomerInvoices(deps, orgId, accessToken, realmId, payCustQboIds); }
    catch (e) { console.error("[6b] payment re-pull failed", e); }
  }
  try { await applyCaseReconciliation(deps.service, orgId, today); }
  catch (e) { console.error("[6b] reconciliation failed (payments)", e); }
  try {
    const evalResult = await applyPromiseEvaluation(deps.service, orgId, today);
    if (evalResult.brokenDetails.length > 0 && deps.notify) {
      try { await deps.notify(orgId, evalResult.brokenDetails, today); }
      catch (e) { console.error("[6b] broken-promise notification failed (non-fatal)", e); }
    }
  }
  catch (e) { console.error("[6b] promise evaluation failed (payments)", e); }
}

export async function applyPaymentWebhook(
  deps: SyncDeps, orgId: string, qboId: string, type: "payment" | "credit_memo",
): Promise<void> {
  const { accessToken, realmId } = await getValidAccessToken(
    deps.fetchFn, deps.service, deps.cfg, deps.key, orgId,
  );
  const entity = type === "payment" ? "Payment" : "CreditMemo";
  const raw = await qboReadEntity(deps.fetchFn, deps.api, accessToken, realmId, entity, qboId);
  if (!raw) return;

  const today = new Date().toISOString().slice(0, 10);
  await applyPaymentsAndEvaluate(deps, orgId, accessToken, realmId, [{ raw, type }], today, new Date());
}

export async function syncOverdueInvoices(
  deps: SyncDeps, orgId: string,
): Promise<{ customers: number; invoices: number; truncated: boolean }> {
  const { accessToken, realmId } = await getValidAccessToken(
    deps.fetchFn, deps.service, deps.cfg, deps.key, orgId,
  );
  const today = new Date().toISOString().slice(0, 10);

  // Overdue invoices (critical path — feeds case pipeline). Separate query
  // so coming-due rows can never displace overdue rows at the cap.
  const overdueInvoices = await qboQuery(
    deps.fetchFn, deps.api, accessToken, realmId,
    `select * from Invoice where Balance > '0' and DueDate < '${today}' startposition 1 maxresults ${QUERY_LIMIT}`,
    "Invoice",
  );

  // Coming-due invoices (awareness only — org-configured lookahead window,
  // separate capped query).
  const orgConfig = await loadOrgConfig(deps.service, orgId).catch(() => DEFAULT_ORG_CONFIG);
  const plus7 = new Date(Date.now() + orgConfig.workflow.comingDueDays * 86_400_000).toISOString().slice(0, 10);
  const comingDueInvoices = await qboQuery(
    deps.fetchFn, deps.api, accessToken, realmId,
    `select * from Invoice where Balance > '0' and DueDate >= '${today}' and DueDate <= '${plus7}' startposition 1 maxresults ${QUERY_LIMIT}`,
    "Invoice",
  );

  // Merge and deduplicate by QBO Id (defensive — queries are disjoint by
  // date range but a QBO edge case could return the same invoice in both).
  const seen = new Set<string>();
  const invoices: any[] = [];
  for (const inv of [...overdueInvoices, ...comingDueInvoices]) {
    const id = String(inv?.Id ?? "");
    if (id && !seen.has(id)) { seen.add(id); invoices.push(inv); }
  }
  // Hydrate customers in two passes so overdue customers (critical for case
  // pipeline) are never displaced by coming-due customers at the query cap.
  const overdueCustIds = [...new Set(
    overdueInvoices.map((i) => i?.CustomerRef?.value).filter(Boolean).map(String),
  )];
  const comingDueCustIds = [...new Set(
    comingDueInvoices.map((i) => i?.CustomerRef?.value).filter(Boolean).map(String),
  )];
  // Only fetch coming-due customers not already covered by the overdue set.
  const overdueCustSet = new Set(overdueCustIds);
  const extraCustIds = comingDueCustIds.filter((id) => !overdueCustSet.has(id));

  let customerRows: CustomerUpsert[] = [];
  if (overdueCustIds.length > 0) {
    const idList = overdueCustIds.map((id) => `'${id}'`).join(",");
    const customers = await qboQuery(
      deps.fetchFn, deps.api, accessToken, realmId,
      `select * from Customer where Id in (${idList}) startposition 1 maxresults ${QUERY_LIMIT}`,
      "Customer",
    );
    customerRows.push(...customers.map((c) => mapQboCustomer(c, orgId)));
  }
  if (extraCustIds.length > 0) {
    const idList = extraCustIds.map((id) => `'${id}'`).join(",");
    const customers = await qboQuery(
      deps.fetchFn, deps.api, accessToken, realmId,
      `select * from Customer where Id in (${idList}) startposition 1 maxresults ${QUERY_LIMIT}`,
      "Customer",
    );
    customerRows.push(...customers.map((c) => mapQboCustomer(c, orgId)));
  }
  await upsertCustomers(deps.service, customerRows);

  const custIds = invoices.map((i) => i?.CustomerRef?.value).filter(Boolean).map(String);

  const idMap = await customerIdMap(deps.service, orgId, custIds);
  const now = new Date();
  const invoiceRows = invoices.map((inv) =>
    mapQboInvoice(inv, orgId, idMap.get(String(inv?.CustomerRef?.value)) ?? null, now),
  );
  await upsertInvoices(deps.service, invoiceRows);

  const reconcileToday = new Date().toISOString().slice(0, 10);
  try {
    await applyPaymentsAndEvaluate(deps, orgId, accessToken, realmId, [], reconcileToday, now);
  } catch (e) {
    console.error("[6b] payments/eval failed; cron will re-converge", e);
  }

  const { error } = await deps.service.from("qbo_connections")
    .update({ last_sync_at: now.toISOString() }).eq("org_id", orgId);
  if (error) throw error;

  return {
    customers: customerRows.length,
    invoices: invoiceRows.length,
    truncated: overdueInvoices.length >= QUERY_LIMIT,
  };
}

// --- Webhook single-entity apply --------------------------------------------

export async function applyCustomerWebhook(
  deps: SyncDeps, orgId: string, qboCustomerId: string,
): Promise<void> {
  const { accessToken, realmId } = await getValidAccessToken(
    deps.fetchFn, deps.service, deps.cfg, deps.key, orgId,
  );
  const c = await qboReadEntity(deps.fetchFn, deps.api, accessToken, realmId, "Customer", qboCustomerId);
  if (!c) return; // deleted/unreadable — nothing to upsert
  await upsertCustomers(deps.service, [mapQboCustomer(c, orgId)]);
}

export async function applyInvoiceWebhook(
  deps: SyncDeps, orgId: string, qboInvoiceId: string,
): Promise<void> {
  const { accessToken, realmId } = await getValidAccessToken(
    deps.fetchFn, deps.service, deps.cfg, deps.key, orgId,
  );
  const inv = await qboReadEntity(deps.fetchFn, deps.api, accessToken, realmId, "Invoice", qboInvoiceId);
  if (!inv) return;

  // Ensure the invoice's customer exists locally so the FK resolves.
  const qboCustomerId = inv?.CustomerRef?.value ? String(inv.CustomerRef.value) : null;
  let customerId: string | null = null;
  if (qboCustomerId) {
    const c = await qboReadEntity(deps.fetchFn, deps.api, accessToken, realmId, "Customer", qboCustomerId);
    if (c) await upsertCustomers(deps.service, [mapQboCustomer(c, orgId)]);
    const idMap = await customerIdMap(deps.service, orgId, [qboCustomerId]);
    customerId = idMap.get(qboCustomerId) ?? null;
  }
  const now = new Date();
  await upsertInvoices(deps.service, [mapQboInvoice(inv, orgId, customerId, now)]);

  const reconcileToday = now.toISOString().slice(0, 10);
  try {
    await applyPaymentsAndEvaluate(deps, orgId, accessToken, realmId, [], reconcileToday, now);
  } catch (e) {
    console.error("[6b] payments/eval failed; cron will re-converge", e);
  }
}

// --- CDC catch-up -----------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

export async function runCdcCatchup(
  deps: SyncDeps, orgId: string,
): Promise<{ customers: number; invoices: number }> {
  const { accessToken, realmId } = await getValidAccessToken(
    deps.fetchFn, deps.service, deps.cfg, deps.key, orgId,
  );
  const { data: conn } = await deps.service.from("qbo_connections")
    .select("last_cdc_time").eq("org_id", orgId).maybeSingle();

  // Default to a 7-day window on first run; never request beyond CDC's 30-day
  // lookback limit.
  const sinceMs = conn?.last_cdc_time
    ? new Date(conn.last_cdc_time as string).getTime()
    : Date.now() - 7 * DAY_MS;
  const minMs = Date.now() - 30 * DAY_MS;
  const changedSince = new Date(Math.max(sinceMs, minMs)).toISOString();

  const { invoices, customers, payments, creditMemos } = await qboCdc(deps.fetchFn, deps.api, accessToken, realmId, changedSince);

  const customerRows = customers.map((c) => mapQboCustomer(c, orgId));
  await upsertCustomers(deps.service, customerRows);

  const custIds = invoices.map((i) => i?.CustomerRef?.value).filter(Boolean).map(String);
  const idMap = await customerIdMap(deps.service, orgId, custIds);
  const now = new Date();
  const invoiceRows = invoices.map((inv) =>
    mapQboInvoice(inv, orgId, idMap.get(String(inv?.CustomerRef?.value)) ?? null, now),
  );
  await upsertInvoices(deps.service, invoiceRows);

  const reconcileToday = new Date().toISOString().slice(0, 10);
  const paymentRaws = [
    ...payments.map((p) => ({ raw: p, type: "payment" as const })),
    ...creditMemos.map((c) => ({ raw: c, type: "credit_memo" as const })),
  ];
  try {
    await applyPaymentsAndEvaluate(deps, orgId, accessToken, realmId, paymentRaws, reconcileToday, now);
  } catch (e) {
    console.error("[6b] payments/eval failed (cdc); cron will re-converge", e);
  }

  const { error } = await deps.service.from("qbo_connections")
    .update({ last_cdc_time: now.toISOString(), last_sync_at: now.toISOString() })
    .eq("org_id", orgId);
  if (error) throw error;

  return { customers: customerRows.length, invoices: invoiceRows.length };
}
