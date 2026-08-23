import { expect, test, vi } from "vitest";
import { serviceClient } from "./helpers";
import { storeConnection } from "../app/lib/qbo-connection.server";
import {
  applyInvoiceWebhook, applyCustomerWebhook, runCdcCatchup, type SyncDeps,
} from "../app/lib/qbo-sync.server";
import { todayInTz } from "../app/lib/tz";

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

test("CDC remapping a customer's invoices preserves, clears, first-pays, and leaves historically-paid null", async () => {
  const org = await freshOrg();
  await storeConnection(svc, KEY, org, "realm-w4", { accessToken: "AT", refreshToken: "RT", expiresIn: 3600 });
  const { data: cust } = await svc.from("customers")
    .insert({ org_id: org, qbo_id: "40", name: "Paid Date Co" }).select("id").single();
  await svc.from("invoices").insert([
    { org_id: org, qbo_id: "401", customer_id: cust!.id, amount: 100, balance: 0, status: "paid", paid_date: "2026-01-01", due_date: "2026-01-01" },
    { org_id: org, qbo_id: "402", customer_id: cust!.id, amount: 100, balance: 0, status: "paid", paid_date: "2026-01-01", due_date: "2026-01-01" },
    { org_id: org, qbo_id: "403", customer_id: cust!.id, amount: 100, balance: 100, status: "overdue", paid_date: null, due_date: "2026-01-01" },
    { org_id: org, qbo_id: "404", customer_id: cust!.id, amount: 100, balance: 0, status: "paid", paid_date: null, due_date: "2026-01-01" },
  ]);

  const fetchFn = vi.fn(async (url: string) => {
    if (String(url).includes("/cdc?")) {
      return jsonResponse({ CDCResponse: [{ QueryResponse: [
        { Customer: [{ Id: "40", DisplayName: "Paid Date Co" }] },
        { Invoice: [
          { Id: "401", DocNumber: "p", TotalAmt: "100", Balance: "0", DueDate: "2026-01-01", TxnDate: "2025-06-01", CustomerRef: { value: "40" } },
          { Id: "402", DocNumber: "c", TotalAmt: "100", Balance: "50", DueDate: "2026-01-01", TxnDate: "2025-06-01", CustomerRef: { value: "40" } },
          { Id: "403", DocNumber: "f", TotalAmt: "100", Balance: "0", DueDate: "2026-01-01", TxnDate: "2025-06-01", CustomerRef: { value: "40" } },
          { Id: "404", DocNumber: "h", TotalAmt: "100", Balance: "0", DueDate: "2026-01-01", TxnDate: "2025-06-01", CustomerRef: { value: "40" } },
        ] },
      ] }] });
    }
    throw new Error(`unexpected ${url}`);
  });

  const syncToday = todayInTz("America/New_York");
  await runCdcCatchup(deps(fetchFn), org);

  const { data: rows } = await svc.from("invoices")
    .select("qbo_id, paid_date, balance").eq("org_id", org).in("qbo_id", ["401", "402", "403", "404"]);
  const byId = Object.fromEntries((rows ?? []).map((r) => [r.qbo_id, r]));
  expect(byId["401"].paid_date).toBe("2026-01-01"); // preserve
  expect(Number(byId["401"].balance)).toBe(0);
  expect(byId["402"].paid_date).toBeNull(); // reopened → clear
  expect(Number(byId["402"].balance)).toBe(50);
  expect(byId["403"].paid_date).toBe(syncToday); // first pay, not TxnDate
  expect(Number(byId["403"].balance)).toBe(0);
  expect(byId["404"].paid_date).toBeNull(); // historically paid, untracked
  expect(Number(byId["404"].balance)).toBe(0);
});

test("applyInvoiceWebhook deleted path stamps first transition and leaves historically-paid null", async () => {
  const org = await freshOrg();
  await storeConnection(svc, KEY, org, "realm-w5", { accessToken: "AT", refreshToken: "RT", expiresIn: 3600 });
  const { data: cust } = await svc.from("customers")
    .insert({ org_id: org, qbo_id: "50", name: "Deleted Inv Co" }).select("id").single();
  await svc.from("invoices").insert([
    { org_id: org, qbo_id: "501", customer_id: cust!.id, amount: 80, balance: 80, status: "overdue", paid_date: null, due_date: "2026-01-01" },
    { org_id: org, qbo_id: "502", customer_id: cust!.id, amount: 80, balance: 0, status: "paid", paid_date: null, due_date: "2026-01-01" },
  ]);

  const fetchFn = vi.fn(async (url: string) => {
    if (String(url).includes("/invoice/")) return jsonResponse({ time: "now" });
    throw new Error(`unexpected ${url}`);
  });

  const syncToday = todayInTz("America/New_York");
  await applyInvoiceWebhook(deps(fetchFn), org, "501");
  await applyInvoiceWebhook(deps(fetchFn), org, "502");

  const { data: first } = await svc.from("invoices").select("balance, status, paid_date").eq("org_id", org).eq("qbo_id", "501").single();
  expect(Number(first!.balance)).toBe(0);
  expect(first!.status).toBe("paid");
  expect(first!.paid_date).toBe(syncToday);

  const { data: hist } = await svc.from("invoices").select("balance, status, paid_date").eq("org_id", org).eq("qbo_id", "502").single();
  expect(Number(hist!.balance)).toBe(0);
  expect(hist!.status).toBe("paid");
  expect(hist!.paid_date).toBeNull();
});

test("applyInvoiceWebhook delete-missing path reconciles instead of returning early", async () => {
  const org = await freshOrg();
  await storeConnection(svc, KEY, org, "realm-w6", { accessToken: "AT", refreshToken: "RT", expiresIn: 3600 });
  const { data: cust } = await svc.from("customers")
    .insert({ org_id: org, qbo_id: "70", name: "Delete Recon Co" }).select("id").single();
  const { data: opened } = await svc.from("collection_cases")
    .insert({ org_id: org, customer_id: cust!.id, status: "new", next_action_type: "contact", next_action_at: "2026-01-01" })
    .select("id").single();
  await svc.from("invoices").insert({
    org_id: org, qbo_id: "701", customer_id: cust!.id, amount: 80, balance: 80, status: "overdue",
    paid_date: null, due_date: "2026-01-01",
  });

  const fetchFn = vi.fn(async (url: string) => {
    if (String(url).includes("/invoice/701")) return jsonResponse({ time: "now" });
    throw new Error(`unexpected ${url}`);
  });

  await applyInvoiceWebhook(deps(fetchFn), org, "701");

  const { data: cse } = await svc.from("collection_cases").select("status, closed_at").eq("id", opened!.id).single();
  expect(cse!.status).toBe("resolved");
  expect(cse!.closed_at).not.toBeNull();
});

test("runCdcCatchup throws on last_cdc_time read error and does not stamp", async () => {
  const org = await freshOrg();
  await storeConnection(svc, KEY, org, "realm-w7", { accessToken: "AT", refreshToken: "RT", expiresIn: 3600 });
  await svc.from("qbo_connections").update({ last_cdc_time: "2026-01-01T00:00:00Z" }).eq("org_id", org);

  const origFrom = svc.from.bind(svc);
  const wrapped = {
    ...svc,
    from(table: string) {
      const q = origFrom(table);
      if (table !== "qbo_connections") return q;
      const origSelect = q.select.bind(q);
      q.select = ((cols: string, ...rest: unknown[]) => {
        const next = origSelect(cols, ...rest);
        if (!String(cols).includes("last_cdc_time")) return next;
        return {
          eq() {
            return {
              maybeSingle: async () => ({ data: null, error: { message: "cursor read failed" } }),
            };
          },
        };
      }) as typeof q.select;
      return q;
    },
  };

  const fetchFn = vi.fn(async () => {
    throw new Error("cdc should not run after a cursor read error");
  });

  await expect(runCdcCatchup({ ...deps(fetchFn), service: wrapped as any }, org))
    .rejects.toMatchObject({ message: "cursor read failed" });

  const { data: conn } = await svc.from("qbo_connections").select("last_cdc_time").eq("org_id", org).single();
  expect(new Date(conn!.last_cdc_time as string).toISOString()).toBe("2026-01-01T00:00:00.000Z");
  expect(fetchFn).not.toHaveBeenCalled();
});

test("Intuit 404 for one CustomerRef still stamps last_cdc_time", async () => {
  const org = await freshOrg();
  await storeConnection(svc, KEY, org, "realm-w8", { accessToken: "AT", refreshToken: "RT", expiresIn: 3600 });
  await svc.from("qbo_connections").update({ last_cdc_time: "2026-01-01T00:00:00Z" }).eq("org_id", org);

  const fetchFn = vi.fn(async (url: string) => {
    if (String(url).includes("/cdc?")) {
      return jsonResponse({ CDCResponse: [{ QueryResponse: [
        { Invoice: [{ Id: "800", DocNumber: "8", TotalAmt: "5", Balance: "0", DueDate: "2026-01-01", CustomerRef: { value: "missing-cust" } }] },
      ] }] });
    }
    if (String(url).includes("/customer/missing-cust")) return jsonResponse({ Fault: {} }, 404);
    throw new Error(`unexpected ${url}`);
  });

  const result = await runCdcCatchup(deps(fetchFn), org);
  expect(result).toEqual({ customers: 0, invoices: 1 });

  const { data: inv } = await svc.from("invoices").select("customer_id, status").eq("org_id", org).eq("qbo_id", "800").single();
  expect(inv!.customer_id).toBeNull();
  expect(inv!.status).toBe("paid");

  const { data: conn } = await svc.from("qbo_connections").select("last_cdc_time").eq("org_id", org).single();
  expect(conn!.last_cdc_time).not.toBe("2026-01-01T00:00:00Z");
  expect(conn!.last_cdc_time).not.toBeNull();

  const { data: errs } = await svc.from("sync_errors").select("scope, message").eq("org_id", org).is("resolved_at", null);
  expect((errs ?? []).some((e) => e.scope === "customer")).toBe(true);
});
