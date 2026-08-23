import { expect, test, vi } from "vitest";

vi.mock("../app/lib/case-lifecycle.server", () => ({
  applyCaseReconciliation: vi.fn(async () => {
    throw new Error("reconciliation truncated: overdue invoice page is incomplete");
  }),
}));

import { serviceClient } from "./helpers";
import { storeConnection } from "../app/lib/qbo-connection.server";
import { applyInvoiceWebhook, runCdcCatchup, syncOverdueInvoices, type SyncDeps } from "../app/lib/qbo-sync.server";

const KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const cfg = { clientId: "cid", clientSecret: "secret", redirectUri: "http://x/cb" };
const api = { baseUrl: "https://sandbox-quickbooks.api.intuit.com" };
const svc = serviceClient();

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
function deps(fetchFn: typeof fetch): SyncDeps {
  return { fetchFn, service: svc, cfg, api, key: KEY, errorSource: "cron" };
}

test("thrown recon error does not stamp last_cdc_time", async () => {
  const { data, error } = await svc.from("organizations")
    .insert({ name: `CDC Recon Org ${crypto.randomUUID()}` }).select("id").single();
  if (error) throw error;
  const org = data!.id as string;
  await storeConnection(svc, KEY, org, "realm-cdc-recon", { accessToken: "AT", refreshToken: "RT", expiresIn: 3600 });
  await svc.from("qbo_connections").update({ last_cdc_time: "2026-01-01T00:00:00Z" }).eq("org_id", org);

  const fetchFn = vi.fn(async (url: string) => {
    if (String(url).includes("/cdc?")) {
      return jsonResponse({ CDCResponse: [{ QueryResponse: [
        { Invoice: [{ Id: "500", DocNumber: "80", TotalAmt: "5", Balance: "5", DueDate: "2026-01-01", CustomerRef: { value: "60" } }] },
        { Customer: [{ Id: "60", DisplayName: "CDC Recon Cust" }] },
      ] }] });
    }
    throw new Error(`unexpected ${url}`);
  });

  await expect(runCdcCatchup(deps(fetchFn as unknown as typeof fetch), org)).rejects.toThrow(/reconciliation truncated/);

  const { data: conn } = await svc.from("qbo_connections").select("last_cdc_time").eq("org_id", org).single();
  expect(new Date(conn!.last_cdc_time as string).toISOString()).toBe("2026-01-01T00:00:00.000Z");
});

test("syncOverdueInvoices rethrows apply failure and does not stamp last_sync_at", async () => {
  const { data, error } = await svc.from("organizations")
    .insert({ name: `Overdue Recon Org ${crypto.randomUUID()}` }).select("id").single();
  if (error) throw error;
  const org = data!.id as string;
  await storeConnection(svc, KEY, org, "realm-overdue-recon", { accessToken: "AT", refreshToken: "RT", expiresIn: 3600 });

  const fetchFn = vi.fn(async (url: string) => {
    const decoded = decodeURIComponent(String(url));
    if (decoded.includes("from Invoice") || decoded.includes("from Customer")) {
      return jsonResponse({ QueryResponse: {} });
    }
    throw new Error(`unexpected ${url}`);
  });

  await expect(syncOverdueInvoices(deps(fetchFn as unknown as typeof fetch), org))
    .rejects.toThrow(/reconciliation truncated/);

  const { data: conn } = await svc.from("qbo_connections").select("last_sync_at").eq("org_id", org).single();
  expect(conn!.last_sync_at).toBeNull();
});

test("applyInvoiceWebhook success path rethrows apply failure", async () => {
  const { data, error } = await svc.from("organizations")
    .insert({ name: `Webhook Recon Org ${crypto.randomUUID()}` }).select("id").single();
  if (error) throw error;
  const org = data!.id as string;
  await storeConnection(svc, KEY, org, "realm-wh-recon", { accessToken: "AT", refreshToken: "RT", expiresIn: 3600 });

  const fetchFn = vi.fn(async (url: string) => {
    if (String(url).includes("/invoice/300")) {
      return jsonResponse({ Invoice: { Id: "300", DocNumber: "55", TotalAmt: "90", Balance: "90", DueDate: "2026-01-01", CustomerRef: { value: "12" } } });
    }
    if (String(url).includes("/customer/12")) {
      return jsonResponse({ Customer: { Id: "12", DisplayName: "Webhook Recon Co" } });
    }
    throw new Error(`unexpected ${url}`);
  });

  await expect(applyInvoiceWebhook(deps(fetchFn as unknown as typeof fetch), org, "300"))
    .rejects.toThrow(/reconciliation truncated/);
});
