import type { SupabaseClient } from "@supabase/supabase-js";
import { getValidAccessToken } from "./qbo-connection.server";
import { qboQueryAll, qboReadEntity, qboCdc, type QboApiConfig } from "./qbo-api.server";
import {
  mapQboCustomer, mapQboInvoice, mapQboPayment, qboCustomerName,
  type CustomerUpsert, type InvoiceUpsert, type PaymentUpsert,
} from "./qbo-mappers.server";
import type { QboHttpConfig } from "./qbo-client.server";
import { applyCaseReconciliation } from "./case-lifecycle.server";
import { applyPromiseEvaluation, type BrokenPromiseDetail } from "./promise-evaluation.server";
import { loadOrgConfig } from "./org-config.server";
import { DEFAULT_ORG_CONFIG } from "./org-config";
import { todayInTz } from "./tz";
import { mergePaidDate, type ExistingPaidRow } from "./paid-date";
import { recordSyncError } from "./sync-errors.server";

export type NotifyFn = (orgId: string, brokenDetails: BrokenPromiseDetail[], today: string) => Promise<void>;

export type SyncDeps = {
  fetchFn: typeof fetch;
  service: SupabaseClient;
  cfg: QboHttpConfig;   // for token refresh inside getValidAccessToken
  api: QboApiConfig;    // data API base url
  key: string;          // AES key for token decrypt
  notify?: NotifyFn;    // optional broken-promise alert callback
  errorSource?: "manual" | "webhook" | "cron";
};

// QBO query page cap. Chancey carries 125-175 overdue invoices; CDC caps at
// 1000. A single page of 1000 covers this org; >1000 is flagged (truncated).
export const QUERY_LIMIT = 1000;

export async function upsertCustomers(service: SupabaseClient, rows: CustomerUpsert[]): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await service.from("customers").upsert(rows, { onConflict: "org_id,qbo_id" });
  if (error) throw error;
}

const PAID_DATE_LOOKUP_CHUNK = 200;

function existingPaidRow(row: {
  qbo_id: unknown; balance: unknown; paid_date: unknown;
}): ExistingPaidRow {
  return {
    qbo_id: String(row.qbo_id),
    balance: Number(row.balance),
    paid_date: typeof row.paid_date === "string" ? row.paid_date : null,
  };
}

export async function upsertInvoices(
  service: SupabaseClient, rows: InvoiceUpsert[], syncToday: string,
): Promise<void> {
  if (rows.length === 0) return;
  const orgId = rows[0].org_id;
  const qboIds = [...new Set(rows.map((r) => r.qbo_id))];
  const existingByQbo = new Map<string, ExistingPaidRow>();
  for (let i = 0; i < qboIds.length; i += PAID_DATE_LOOKUP_CHUNK) {
    const chunk = qboIds.slice(i, i + PAID_DATE_LOOKUP_CHUNK);
    const { data, error } = await service.from("invoices")
      .select("qbo_id, balance, paid_date")
      .eq("org_id", orgId)
      .in("qbo_id", chunk);
    if (error) throw error;
    for (const row of data ?? []) {
      existingByQbo.set(String(row.qbo_id), existingPaidRow(row));
    }
  }
  const merged = rows.map((row) => ({
    ...row,
    paid_date: mergePaidDate({
      existing: existingByQbo.get(row.qbo_id),
      incomingBalance: row.balance,
      syncToday,
    }),
  }));
  const { error } = await service.from("invoices").upsert(merged, { onConflict: "org_id,qbo_id" });
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
  syncToday: string,
): Promise<void> {
  const ids = [...new Set(qboCustomerIds.filter(Boolean))];
  if (ids.length === 0) return;
  const idList = ids.map((id) => `'${id}'`).join(",");
  const invoices = await qboQueryAll(
    deps.fetchFn, deps.api, accessToken, realmId,
    `select * from Invoice where CustomerRef in (${idList})`,
    "Invoice",
  );
  if (invoices.length === 0) return;
  const idMap = await customerIdMap(deps.service, orgId, ids);
  const now = new Date();
  const rows = invoices.map((inv) =>
    mapQboInvoice(inv, orgId, idMap.get(String(inv?.CustomerRef?.value)) ?? null, now, syncToday));
  await upsertInvoices(deps.service, rows, syncToday);
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
    try { await repullCustomerInvoices(deps, orgId, accessToken, realmId, payCustQboIds, today); }
    catch (e) { console.error("[6b] payment re-pull failed", e); }
  }
  try {
    await applyCaseReconciliation(deps.service, orgId, today);
  } catch (e) {
    console.error("[6b] reconciliation failed (payments)", e);
    await recordSyncError(deps.service, {
      orgId,
      source: deps.errorSource ?? "cron",
      scope: "recon",
      message: e instanceof Error ? e.message : String(e),
    }).catch((err) => console.error("[6b] recordSyncError failed", err));
    throw e;
  }
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

  const orgConfig = await loadOrgConfig(deps.service, orgId).catch(() => DEFAULT_ORG_CONFIG);
  const today = todayInTz(orgConfig.companyProfile.timezone);
  await applyPaymentsAndEvaluate(deps, orgId, accessToken, realmId, [{ raw, type }], today, new Date());
}

export async function syncOverdueInvoices(
  deps: SyncDeps, orgId: string,
): Promise<{ customers: number; invoices: number; truncated: boolean }> {
  const { accessToken, realmId } = await getValidAccessToken(
    deps.fetchFn, deps.service, deps.cfg, deps.key, orgId,
  );
  // Org config loaded once (org-local "today" + comingDueDays lookahead window).
  const orgConfig = await loadOrgConfig(deps.service, orgId).catch(() => DEFAULT_ORG_CONFIG);
  const today = todayInTz(orgConfig.companyProfile.timezone);

  // Overdue invoices (critical path — feeds case pipeline). Separate query
  // so coming-due rows can never displace overdue rows at the cap.
  const overdueInvoices = await qboQueryAll(
    deps.fetchFn, deps.api, accessToken, realmId,
    `select * from Invoice where Balance > '0' and DueDate < '${today}'`,
    "Invoice",
  );

  // Coming-due invoices (awareness only — org-configured lookahead window,
  // separate capped query).
  const todayMs = new Date(today + "T00:00:00Z").getTime();
  const plus7 = new Date(todayMs + orgConfig.workflow.comingDueDays * 86_400_000).toISOString().slice(0, 10);
  const comingDueInvoices = await qboQueryAll(
    deps.fetchFn, deps.api, accessToken, realmId,
    `select * from Invoice where Balance > '0' and DueDate >= '${today}' and DueDate <= '${plus7}'`,
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
    const customers = await qboQueryAll(
      deps.fetchFn, deps.api, accessToken, realmId,
      `select * from Customer where Id in (${idList})`,
      "Customer",
    );
    customerRows.push(...customers.map((c) => mapQboCustomer(c, orgId)));
  }
  if (extraCustIds.length > 0) {
    const idList = extraCustIds.map((id) => `'${id}'`).join(",");
    const customers = await qboQueryAll(
      deps.fetchFn, deps.api, accessToken, realmId,
      `select * from Customer where Id in (${idList})`,
      "Customer",
    );
    customerRows.push(...customers.map((c) => mapQboCustomer(c, orgId)));
  }
  await upsertCustomers(deps.service, customerRows);

  const custIds = invoices.map((i) => i?.CustomerRef?.value).filter(Boolean).map(String);

  const idMap = await customerIdMap(deps.service, orgId, custIds);
  const now = new Date();
  const invoiceRows = invoices.map((inv) =>
    mapQboInvoice(inv, orgId, idMap.get(String(inv?.CustomerRef?.value)) ?? null, now, today),
  );
  await upsertInvoices(deps.service, invoiceRows, today);

  // Reuse the org-local `today` computed above (same calendar day as the
  // overdue-invoice query) rather than recomputing from a fresh UTC Date.
  // Recon failure must not stamp last_sync_at — CDC retries the window.
  await applyPaymentsAndEvaluate(deps, orgId, accessToken, realmId, [], today, now);

  const { error } = await deps.service.from("qbo_connections")
    .update({ last_sync_at: now.toISOString() }).eq("org_id", orgId);
  if (error) throw error;

  return {
    customers: customerRows.length,
    invoices: invoiceRows.length,
    truncated: false,
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
  const orgConfig = await loadOrgConfig(deps.service, orgId).catch(() => DEFAULT_ORG_CONFIG);
  const now = new Date();
  const syncToday = todayInTz(orgConfig.companyProfile.timezone, now);
  const inv = await qboReadEntity(deps.fetchFn, deps.api, accessToken, realmId, "Invoice", qboInvoiceId);
  if (!inv) {
    // Missing at Intuit (deleted): zero local balance so recon can close the case.
    const { data: existingRow, error: selectError } = await deps.service.from("invoices")
      .select("qbo_id, balance, paid_date")
      .eq("org_id", orgId)
      .eq("qbo_id", qboInvoiceId)
      .maybeSingle();
    if (selectError) throw selectError;
    const existing = existingRow ? existingPaidRow(existingRow) : undefined;
    const { error } = await deps.service.from("invoices")
      .update({
        balance: 0,
        status: "paid",
        paid_date: mergePaidDate({ existing, incomingBalance: 0, syncToday }),
      })
      .eq("org_id", orgId)
      .eq("qbo_id", qboInvoiceId);
    if (error) throw error;
    return;
  }

  // Ensure the invoice's customer exists locally so the FK resolves.
  const qboCustomerId = inv?.CustomerRef?.value ? String(inv.CustomerRef.value) : null;
  let customerId: string | null = null;
  if (qboCustomerId) {
    const c = await qboReadEntity(deps.fetchFn, deps.api, accessToken, realmId, "Customer", qboCustomerId);
    if (c) await upsertCustomers(deps.service, [mapQboCustomer(c, orgId)]);
    const idMap = await customerIdMap(deps.service, orgId, [qboCustomerId]);
    customerId = idMap.get(qboCustomerId) ?? null;
  }
  await upsertInvoices(deps.service, [mapQboInvoice(inv, orgId, customerId, now, syncToday)], syncToday);

  await applyPaymentsAndEvaluate(deps, orgId, accessToken, realmId, [], syncToday, now);
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

  // Capture the CDC cursor *before* the Intuit call. Stamping a post-apply
  // clock would skip entities that changed while we were processing.
  const fetchedAt = new Date();
  const sinceMs = conn?.last_cdc_time
    ? new Date(conn.last_cdc_time as string).getTime()
    : fetchedAt.getTime() - 7 * DAY_MS;
  const minMs = fetchedAt.getTime() - 30 * DAY_MS;
  const changedSince = new Date(Math.max(sinceMs, minMs)).toISOString();

  const { invoices, customers, payments, creditMemos } = await qboCdc(deps.fetchFn, deps.api, accessToken, realmId, changedSince);
  const CDC_CAP = 1000;
  if (
    invoices.length >= CDC_CAP
    || customers.length >= CDC_CAP
    || payments.length >= CDC_CAP
    || creditMemos.length >= CDC_CAP
  ) {
    throw new Error("CDC truncated: do not advance watermark");
  }

  const customerRows = customers
    .filter((c) => qboCustomerName(c).length > 0)
    .map((c) => mapQboCustomer(c, orgId));
  await upsertCustomers(deps.service, customerRows);

  const orgConfig = await loadOrgConfig(deps.service, orgId).catch(() => DEFAULT_ORG_CONFIG);
  const reconcileToday = todayInTz(orgConfig.companyProfile.timezone, fetchedAt);

  const custIds = invoices.map((i) => i?.CustomerRef?.value).filter(Boolean).map(String);
  const idMap = await customerIdMap(deps.service, orgId, custIds);
  const invoiceRows = invoices.map((inv) =>
    mapQboInvoice(inv, orgId, idMap.get(String(inv?.CustomerRef?.value)) ?? null, fetchedAt, reconcileToday),
  );
  await upsertInvoices(deps.service, invoiceRows, reconcileToday);

  const paymentRaws = [
    ...payments.map((p) => ({ raw: p, type: "payment" as const })),
    ...creditMemos.map((c) => ({ raw: c, type: "credit_memo" as const })),
  ];
  try {
    await applyPaymentsAndEvaluate(deps, orgId, accessToken, realmId, paymentRaws, reconcileToday, fetchedAt);
  } catch (e) {
    // Do not advance last_cdc_time after a partial apply — the next catch-up
    // retries this window.
    console.error("[6b] payments/eval failed (cdc); cron will re-converge", e);
    throw e;
  }

  const { error } = await deps.service.from("qbo_connections")
    .update({ last_cdc_time: fetchedAt.toISOString(), last_sync_at: fetchedAt.toISOString() })
    .eq("org_id", orgId);
  if (error) throw error;

  return { customers: customerRows.length, invoices: invoiceRows.length };
}
