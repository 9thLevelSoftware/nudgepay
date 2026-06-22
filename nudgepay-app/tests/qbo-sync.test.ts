import { expect, test, vi } from "vitest";
import { serviceClient } from "./helpers";
import { storeConnection } from "../app/lib/qbo-connection.server";
import { syncOverdueInvoices, type SyncDeps } from "../app/lib/qbo-sync.server";

const KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const cfg = { clientId: "cid", clientSecret: "secret", redirectUri: "http://x/cb" };
const api = { baseUrl: "https://sandbox-quickbooks.api.intuit.com" };
const svc = serviceClient();

async function freshOrg(): Promise<string> {
  const { data } = await svc.from("organizations").insert({ name: "Sync Org" }).select("id").single();
  return data!.id as string;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

// Routes QBO query calls by the entity named in the (encoded) query string.
function qboMock(invoices: any[], customers: any[]) {
  return vi.fn(async (url: string) => {
    const decoded = decodeURIComponent(String(url));
    if (decoded.includes("from Invoice")) return jsonResponse({ QueryResponse: { Invoice: invoices } });
    if (decoded.includes("from Customer")) return jsonResponse({ QueryResponse: { Customer: customers } });
    throw new Error(`unexpected url ${decoded}`);
  });
}

function deps(fetchFn: any): SyncDeps {
  return { fetchFn, service: svc, cfg, api, key: KEY };
}

test("syncOverdueInvoices upserts customers then invoices with resolved FK", async () => {
  const org = await freshOrg();
  await storeConnection(svc, KEY, org, "realm-sync-1", { accessToken: "AT", refreshToken: "RT", expiresIn: 3600 });

  const fetchFn = qboMock(
    [{ Id: "100", DocNumber: "1042", TotalAmt: "350.50", Balance: "120.00", DueDate: "2026-01-01", TxnDate: "2025-12-01", CustomerRef: { value: "5" } }],
    [{ Id: "5", DisplayName: "Acme HVAC", PrimaryEmailAddr: { Address: "ar@acme.test" } }],
  );
  const result = await syncOverdueInvoices(deps(fetchFn), org);
  expect(result).toEqual({ customers: 1, invoices: 1, truncated: false });

  const { data: cust } = await svc.from("customers").select("id, name").eq("org_id", org).eq("qbo_id", "5").single();
  expect(cust!.name).toBe("Acme HVAC");

  const { data: inv } = await svc.from("invoices")
    .select("qbo_doc_number, balance, status, customer_id, qbo_id").eq("org_id", org).eq("qbo_id", "100").single();
  expect(inv!.qbo_doc_number).toBe("1042");
  expect(Number(inv!.balance)).toBe(120);
  expect(inv!.status).toBe("overdue");
  expect(inv!.customer_id).toBe(cust!.id);
});

test("syncOverdueInvoices is idempotent (second run updates, does not duplicate)", async () => {
  const org = await freshOrg();
  await storeConnection(svc, KEY, org, "realm-sync-2", { accessToken: "AT", refreshToken: "RT", expiresIn: 3600 });
  const invoices = [{ Id: "200", DocNumber: "9", TotalAmt: "10", Balance: "10", DueDate: "2026-01-01", CustomerRef: { value: "8" } }];
  const customers = [{ Id: "8", DisplayName: "Repeat Co" }];

  await syncOverdueInvoices(deps(qboMock(invoices, customers)), org);
  // second run with a changed balance
  invoices[0].Balance = "4";
  await syncOverdueInvoices(deps(qboMock(invoices, customers)), org);

  const { data } = await svc.from("invoices").select("balance").eq("org_id", org).eq("qbo_id", "200");
  expect(data!.length).toBe(1);                 // no duplicate row
  expect(Number(data![0].balance)).toBe(4);     // updated in place
});

test("syncOverdueInvoices stamps last_sync_at on the connection", async () => {
  const org = await freshOrg();
  await storeConnection(svc, KEY, org, "realm-sync-3", { accessToken: "AT", refreshToken: "RT", expiresIn: 3600 });
  await syncOverdueInvoices(deps(qboMock([], [])), org);
  const { data } = await svc.from("qbo_connections").select("last_sync_at").eq("org_id", org).single();
  expect(data!.last_sync_at).not.toBeNull();
});
