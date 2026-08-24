import { expect, test, vi } from "vitest";
import { serviceClient, TEST_ENV } from "./helpers";
import { storeConnection } from "../app/lib/qbo-connection.server";
import { runScheduledCdc } from "../app/lib/qbo-cron.server";

const KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const svc = serviceClient();
const cronEnv = {
  ...TEST_ENV,
  QBO_CLIENT_ID: TEST_ENV.QBO_CLIENT_ID || "cid",
  QBO_CLIENT_SECRET: TEST_ENV.QBO_CLIENT_SECRET || "secret",
  QBO_REDIRECT_URI: TEST_ENV.QBO_REDIRECT_URI || "http://x/cb",
  QBO_ENCRYPTION_KEY: KEY,
  QBO_WEBHOOK_VERIFIER_TOKEN: TEST_ENV.QBO_WEBHOOK_VERIFIER_TOKEN || "token",
};

async function freshOrg(): Promise<string> {
  const { data, error } = await svc.from("organizations")
    .insert({ name: `Cron Org ${crypto.randomUUID()}` }).select("id").single();
  if (error) throw error;
  return data!.id as string;
}
function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

test("runScheduledCdc runs CDC for each connected org and ingests changes", async () => {
  const org = await freshOrg();
  await storeConnection(svc, KEY, org, "realm-cron-1", { accessToken: "AT", refreshToken: "RT", expiresIn: 3600 });
  await svc.from("qbo_connections").update({ last_sync_at: new Date().toISOString() }).eq("org_id", org);

  const realFetch = globalThis.fetch;
  const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("realm-cron-1") && u.includes("/cdc?")) {
      return jsonResponse({ CDCResponse: [{ QueryResponse: [
        { Invoice: [{ Id: "900", DocNumber: "1", TotalAmt: "5", Balance: "5", DueDate: "2026-01-01", CustomerRef: { value: "50" } }] },
        { Customer: [{ Id: "50", DisplayName: "Cron Cust" }] },
      ] }] });
    }
    if (u.includes("/cdc?")) return jsonResponse({ CDCResponse: [{ QueryResponse: [] }] });
    if (u.includes("/query")) return jsonResponse({ QueryResponse: {} });
    return realFetch(url, init);
  });
  const orig = globalThis.fetch;
  globalThis.fetch = fetchFn as any;
  try {
    const result = await runScheduledCdc(cronEnv);
    expect(result.orgs).toBeGreaterThanOrEqual(1);
  } finally {
    globalThis.fetch = orig;
  }

  const { data: inv } = await svc.from("invoices").select("status").eq("org_id", org).eq("qbo_id", "900").single();
  expect(inv!.status).toBe("overdue");
});

test("first-connect heal backfills overdue before CDC and skips CDC on backfill failure", async () => {
  const org = await freshOrg();
  await storeConnection(svc, KEY, org, "realm-cron-backfill", { accessToken: "AT", refreshToken: "RT", expiresIn: 3600 });

  const realFetch = globalThis.fetch;
  const urls: string[] = [];
  const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    urls.push(u);
    if (u.includes("realm-cron-backfill") && u.includes("/query")) {
      return jsonResponse({ Fault: {} }, 500);
    }
    if (u.includes("realm-cron-backfill") && u.includes("/cdc?")) {
      throw new Error("CDC must not run after backfill failure");
    }
    if (u.includes("/cdc?")) {
      return jsonResponse({ CDCResponse: [{ QueryResponse: [] }] });
    }
    if (u.includes("/query")) return jsonResponse({ QueryResponse: {} });
    return realFetch(url, init);
  });
  const orig = globalThis.fetch;
  globalThis.fetch = fetchFn as any;
  try {
    await runScheduledCdc(cronEnv);
  } finally {
    globalThis.fetch = orig;
  }

  expect(urls.some((u) => u.includes("realm-cron-backfill") && u.includes("/query"))).toBe(true);
  expect(urls.some((u) => u.includes("realm-cron-backfill") && u.includes("/cdc?"))).toBe(false);
  const { data: errs } = await svc.from("sync_errors")
    .select("scope").eq("org_id", org).eq("scope", "backfill").is("resolved_at", null);
  expect((errs ?? []).length).toBeGreaterThan(0);
  const { data: conn } = await svc.from("qbo_connections").select("last_cdc_time, last_sync_at").eq("org_id", org).single();
  expect(conn!.last_cdc_time).toBeNull();
  expect(conn!.last_sync_at).toBeNull();
});

test("cron CDC CustomerRef 404 stamps last_cdc_time and leaves scope customer unresolved", async () => {
  const org = await freshOrg();
  await storeConnection(svc, KEY, org, "realm-cron-cust404", { accessToken: "AT", refreshToken: "RT", expiresIn: 3600 });
  await svc.from("qbo_connections").update({
    last_sync_at: new Date().toISOString(),
    last_cdc_time: "2026-01-01T00:00:00Z",
  }).eq("org_id", org);

  const realFetch = globalThis.fetch;
  const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("realm-cron-cust404") && u.includes("/cdc?")) {
      return jsonResponse({ CDCResponse: [{ QueryResponse: [
        { Invoice: [{ Id: "910", DocNumber: "9", TotalAmt: "5", Balance: "0", DueDate: "2026-01-01", CustomerRef: { value: "gone" } }] },
      ] }] });
    }
    if (u.includes("realm-cron-cust404") && u.includes("/customer/gone")) {
      return jsonResponse({ Fault: {} }, 404);
    }
    if (u.includes("/cdc?")) return jsonResponse({ CDCResponse: [{ QueryResponse: [] }] });
    if (u.includes("/query")) return jsonResponse({ QueryResponse: {} });
    return realFetch(url, init);
  });
  const orig = globalThis.fetch;
  globalThis.fetch = fetchFn as any;
  try {
    await runScheduledCdc(cronEnv);
  } finally {
    globalThis.fetch = orig;
  }

  const { data: conn } = await svc.from("qbo_connections").select("last_cdc_time").eq("org_id", org).single();
  expect(new Date(conn!.last_cdc_time as string).toISOString()).not.toBe("2026-01-01T00:00:00.000Z");
  const { data: errs } = await svc.from("sync_errors")
    .select("scope, resolved_at").eq("org_id", org).eq("scope", "customer");
  expect((errs ?? []).some((e) => e.resolved_at == null)).toBe(true);
});
