import { expect, test, vi } from "vitest";

vi.mock("../app/lib/case-lifecycle.server", () => ({
  applyCaseReconciliation: vi.fn(async () => {
    throw new Error("reconciliation truncated: overdue invoice page is incomplete");
  }),
}));

import { serviceClient } from "./helpers";
import { storeConnection } from "../app/lib/qbo-connection.server";
import { runCdcCatchup, type SyncDeps } from "../app/lib/qbo-sync.server";

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
  const { data } = await svc.from("organizations").insert({ name: "CDC Recon Org" }).select("id").single();
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
  expect(conn!.last_cdc_time).toBe("2026-01-01T00:00:00Z");
});
