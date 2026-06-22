import type { SupabaseClient } from "@supabase/supabase-js";
import { getValidAccessToken } from "./qbo-connection.server";
import { qboQuery, type QboApiConfig } from "./qbo-api.server";
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
