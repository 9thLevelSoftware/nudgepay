import { expect, test, vi } from "vitest";
import { serviceClient } from "./helpers";
import { storeConnection } from "../app/lib/qbo-connection.server";
import {
  applyInvoiceWebhook, applyCustomerWebhook, runCdcCatchup, type SyncDeps,
} from "../app/lib/qbo-sync.server";

const KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const cfg = { clientId: "cid", clientSecret: "secret", redirectUri: "http://x/cb" };
const api = { baseUrl: "https://sandbox-quickbooks.api.intuit.com" };
const svc = serviceClient();

async function freshOrg(): Promise<string> {
  const { data } = await svc.from("organizations").insert({ name: "CDC Org" }).select("id").single();
  return data!.id as string;
}
function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
function deps(fetchFn: any): SyncDeps {
  return { fetchFn, service: svc, cfg, api, key: KEY };
}

test("applyInvoiceWebhook reads invoice + customer and upserts both", async () => {
  const org = await freshOrg();
  await storeConnection(svc, KEY, org, "realm-w1", { accessToken: "AT", refreshToken: "RT", expiresIn: 3600 });

  const fetchFn = vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes("/invoice/300")) return jsonResponse({ Invoice: { Id: "300", DocNumber: "55", TotalAmt: "90", Balance: "90", DueDate: "2026-01-01", CustomerRef: { value: "12" } } });
    if (u.includes("/customer/12")) return jsonResponse({ Customer: { Id: "12", DisplayName: "Webhook Co" } });
    throw new Error(`unexpected ${u}`);
  });

  await applyInvoiceWebhook(deps(fetchFn), org, "300");

  const { data: cust } = await svc.from("customers").select("id, name").eq("org_id", org).eq("qbo_id", "12").single();
  expect(cust!.name).toBe("Webhook Co");
  const { data: inv } = await svc.from("invoices").select("status, customer_id").eq("org_id", org).eq("qbo_id", "300").single();
  expect(inv!.status).toBe("overdue");
  expect(inv!.customer_id).toBe(cust!.id);
});

test("applyCustomerWebhook upserts the single customer", async () => {
  const org = await freshOrg();
  await storeConnection(svc, KEY, org, "realm-w2", { accessToken: "AT", refreshToken: "RT", expiresIn: 3600 });
  const fetchFn = vi.fn(async () => jsonResponse({ Customer: { Id: "20", DisplayName: "Solo Cust", PrimaryPhone: { FreeFormNumber: "229-555-0199" } } }));
  await applyCustomerWebhook(deps(fetchFn), org, "20");
  const { data } = await svc.from("customers").select("name, phone").eq("org_id", org).eq("qbo_id", "20").single();
  expect(data!.name).toBe("Solo Cust");
  expect(data!.phone).toBe("229-555-0199");
});

test("runCdcCatchup upserts changed entities and advances last_cdc_time", async () => {
  const org = await freshOrg();
  await storeConnection(svc, KEY, org, "realm-w3", { accessToken: "AT", refreshToken: "RT", expiresIn: 3600 });

  const fetchFn = vi.fn(async (url: string) => {
    if (String(url).includes("/cdc?")) {
      return jsonResponse({ CDCResponse: [{ QueryResponse: [
        { Invoice: [{ Id: "400", DocNumber: "70", TotalAmt: "5", Balance: "0", DueDate: "2026-01-01", CustomerRef: { value: "30" } }] },
        { Customer: [{ Id: "30", DisplayName: "CDC Cust" }] },
      ] }] });
    }
    throw new Error(`unexpected ${url}`);
  });

  const result = await runCdcCatchup(deps(fetchFn), org);
  expect(result).toEqual({ customers: 1, invoices: 1 });

  const { data: inv } = await svc.from("invoices").select("status, customer_id").eq("org_id", org).eq("qbo_id", "400").single();
  expect(inv!.status).toBe("paid"); // balance 0
  const { data: cust } = await svc.from("customers").select("id").eq("org_id", org).eq("qbo_id", "30").single();
  expect(inv!.customer_id).toBe(cust!.id);

  const { data: conn } = await svc.from("qbo_connections").select("last_cdc_time").eq("org_id", org).single();
  expect(conn!.last_cdc_time).not.toBeNull();

  // changedSince should be present in the CDC URL
  expect(String(fetchFn.mock.calls[0][0])).toContain("changedSince=");
});
