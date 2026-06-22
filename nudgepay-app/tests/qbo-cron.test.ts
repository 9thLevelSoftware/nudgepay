import { expect, test, vi } from "vitest";
import { serviceClient, TEST_ENV } from "./helpers";
import { storeConnection } from "../app/lib/qbo-connection.server";
import { runScheduledCdc } from "../app/lib/qbo-cron.server";

const KEY = TEST_ENV.QBO_ENCRYPTION_KEY;
const svc = serviceClient();

async function freshOrg(): Promise<string> {
  const { data } = await svc.from("organizations").insert({ name: "Cron Org" }).select("id").single();
  return data!.id as string;
}
function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

test("runScheduledCdc runs CDC for each connected org and ingests changes", async () => {
  const org = await freshOrg();
  await storeConnection(svc, KEY, org, "realm-cron-1", { accessToken: "AT", refreshToken: "RT", expiresIn: 3600 });

  const realFetch = globalThis.fetch;
  const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).includes("/cdc?")) {
      return jsonResponse({ CDCResponse: [{ QueryResponse: [
        { Invoice: [{ Id: "900", DocNumber: "1", TotalAmt: "5", Balance: "5", DueDate: "2026-01-01", CustomerRef: { value: "50" } }] },
        { Customer: [{ Id: "50", DisplayName: "Cron Cust" }] },
      ] }] });
    }
    // Pass all other requests (e.g. Supabase REST) to the real fetch.
    return realFetch(url, init);
  });
  const orig = globalThis.fetch;
  globalThis.fetch = fetchFn as any;
  try {
    const result = await runScheduledCdc(TEST_ENV);
    expect(result.orgs).toBeGreaterThanOrEqual(1);
  } finally {
    globalThis.fetch = orig;
  }

  const { data: inv } = await svc.from("invoices").select("status").eq("org_id", org).eq("qbo_id", "900").single();
  expect(inv!.status).toBe("overdue");
});
