import type { SupabaseClient } from "@supabase/supabase-js";
import { getValidAccessToken } from "./qbo-connection.server";
import { qboQuery, qboReadEntity, qboCdc, type QboApiConfig } from "./qbo-api.server";
import {
  mapQboCustomer, mapQboInvoice,
  type CustomerUpsert, type InvoiceUpsert,
} from "./qbo-mappers.server";
import type { QboHttpConfig } from "./qbo-client.server";

export type SyncDeps = {
  fetchFn: typeof fetch;
  service: SupabaseClient;
  cfg: QboHttpConfig;   // for token refresh inside getValidAccessToken
  api: QboApiConfig;    // data API base url
  key: string;          // AES key for token decrypt
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

export async function syncOverdueInvoices(
  deps: SyncDeps, orgId: string,
): Promise<{ customers: number; invoices: number; truncated: boolean }> {
  const { accessToken, realmId } = await getValidAccessToken(
    deps.fetchFn, deps.service, deps.cfg, deps.key, orgId,
  );
  const today = new Date().toISOString().slice(0, 10);
  const invoices = await qboQuery(
    deps.fetchFn, deps.api, accessToken, realmId,
    `select * from Invoice where Balance > '0' and DueDate < '${today}' startposition 1 maxresults ${QUERY_LIMIT}`,
    "Invoice",
  );

  const custIds = invoices.map((i) => i?.CustomerRef?.value).filter(Boolean).map(String);
  let customerRows: CustomerUpsert[] = [];
  const uniqueCustIds = [...new Set(custIds)];
  if (uniqueCustIds.length > 0) {
    const idList = uniqueCustIds.map((id) => `'${id}'`).join(",");
    const customers = await qboQuery(
      deps.fetchFn, deps.api, accessToken, realmId,
      `select * from Customer where Id in (${idList}) startposition 1 maxresults ${QUERY_LIMIT}`,
      "Customer",
    );
    customerRows = customers.map((c) => mapQboCustomer(c, orgId));
  }
  await upsertCustomers(deps.service, customerRows);

  const idMap = await customerIdMap(deps.service, orgId, custIds);
  const now = new Date();
  const invoiceRows = invoices.map((inv) =>
    mapQboInvoice(inv, orgId, idMap.get(String(inv?.CustomerRef?.value)) ?? null, now),
  );
  await upsertInvoices(deps.service, invoiceRows);

  const { error } = await deps.service.from("qbo_connections")
    .update({ last_sync_at: now.toISOString() }).eq("org_id", orgId);
  if (error) throw error;

  return {
    customers: customerRows.length,
    invoices: invoiceRows.length,
    truncated: invoices.length >= QUERY_LIMIT,
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
  await upsertInvoices(deps.service, [mapQboInvoice(inv, orgId, customerId, new Date())]);
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

  const { invoices, customers } = await qboCdc(deps.fetchFn, deps.api, accessToken, realmId, changedSince);

  const customerRows = customers.map((c) => mapQboCustomer(c, orgId));
  await upsertCustomers(deps.service, customerRows);

  const custIds = invoices.map((i) => i?.CustomerRef?.value).filter(Boolean).map(String);
  const idMap = await customerIdMap(deps.service, orgId, custIds);
  const now = new Date();
  const invoiceRows = invoices.map((inv) =>
    mapQboInvoice(inv, orgId, idMap.get(String(inv?.CustomerRef?.value)) ?? null, now),
  );
  await upsertInvoices(deps.service, invoiceRows);

  const { error } = await deps.service.from("qbo_connections")
    .update({ last_cdc_time: now.toISOString(), last_sync_at: now.toISOString() })
    .eq("org_id", orgId);
  if (error) throw error;

  return { customers: customerRows.length, invoices: invoiceRows.length };
}
