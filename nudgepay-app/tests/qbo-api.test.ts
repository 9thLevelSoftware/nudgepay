import { expect, test, vi } from "vitest";
import {
  qboApiBaseUrl, qboQuery, qboQueryAll, qboReadEntity, qboReadCompanyInfo, qboCdc,
  retryAfterWaitMs, QBO_429_WAIT_CAP_MS, QBO_QUERY_MAX_PAGES,
} from "../app/lib/qbo-api.server";

const api = { baseUrl: "https://sandbox-quickbooks.api.intuit.com" };

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

test("qboApiBaseUrl switches between sandbox and production", () => {
  expect(qboApiBaseUrl(true)).toContain("sandbox-quickbooks");
  expect(qboApiBaseUrl(false)).toBe("https://quickbooks.api.intuit.com");
});

test("qboQuery hits the query endpoint with bearer auth and returns the entity array", async () => {
  const fetchFn = vi.fn(async () =>
    jsonResponse({ QueryResponse: { Invoice: [{ Id: "1" }, { Id: "2" }] } }));
  const rows = await qboQuery(fetchFn as any, api, "AT", "realm-9", "select * from Invoice", "Invoice");
  expect(rows.map((r) => r.Id)).toEqual(["1", "2"]);
  const [url, init] = fetchFn.mock.calls[0];
  expect(String(url)).toContain("/v3/company/realm-9/query?query=");
  expect(String(url)).toContain("minorversion=");
  expect((init as any).headers.Authorization).toBe("Bearer AT");
});

test("qboQueryAll pages until a short page", async () => {
  const page1 = Array.from({ length: 2 }, (_, i) => ({ Id: String(i + 1) }));
  const page2 = [{ Id: "3" }];
  const fetchFn = vi.fn(async (url: string) => {
    const decoded = decodeURIComponent(String(url));
    if (decoded.includes("startposition 3")) return jsonResponse({ QueryResponse: { Invoice: page2 } });
    return jsonResponse({ QueryResponse: { Invoice: page1 } });
  });
  const { rows, truncated } = await qboQueryAll(fetchFn as any, api, "AT", "r", "select * from Invoice", "Invoice", {}, 2);
  expect(rows.map((r) => r.Id)).toEqual(["1", "2", "3"]);
  expect(truncated).toBe(false);
  expect(fetchFn).toHaveBeenCalledTimes(2);
});

test("qboQueryAll is truncated after 50 full pages", async () => {
  const fetchFn = vi.fn(async () => jsonResponse({ QueryResponse: { Invoice: [{ Id: "1" }, { Id: "2" }] } }));
  const { rows, truncated } = await qboQueryAll(
    fetchFn as any, api, "AT", "r", "select * from Invoice", "Invoice", {}, 2,
  );
  expect(truncated).toBe(true);
  expect(rows).toHaveLength(QBO_QUERY_MAX_PAGES * 2);
  expect(fetchFn).toHaveBeenCalledTimes(QBO_QUERY_MAX_PAGES);
});

test("qboQuery returns [] when the entity key is absent", async () => {
  const fetchFn = vi.fn(async () => jsonResponse({ QueryResponse: {} }));
  expect(await qboQuery(fetchFn as any, api, "AT", "r", "select * from Customer", "Customer")).toEqual([]);
});

test("qboReadEntity reads one entity by id and unwraps it", async () => {
  const fetchFn = vi.fn(async () => jsonResponse({ Invoice: { Id: "42", Balance: 10 } }));
  const inv = await qboReadEntity(fetchFn as any, api, "AT", "realm-1", "Invoice", "42");
  expect(inv.Id).toBe("42");
  expect(String(fetchFn.mock.calls[0][0])).toContain("/v3/company/realm-1/invoice/42");
});

test("qboReadEntity returns null when the entity is missing", async () => {
  const fetchFn = vi.fn(async () => jsonResponse({ time: "now" }));
  expect(await qboReadEntity(fetchFn as any, api, "AT", "r", "Customer", "99")).toBeNull();
});

test("qboReadCompanyInfo reads CompanyInfo id 1 and unwraps it", async () => {
  const fetchFn = vi.fn(async () => jsonResponse({
    CompanyInfo: { Id: "1", Country: "US", CompanyName: "Acme HVAC" },
  }));
  const info = await qboReadCompanyInfo(fetchFn as any, api, "AT", "realm-1");
  expect(info.Country).toBe("US");
  expect(info.CompanyName).toBe("Acme HVAC");
  const [url, init] = fetchFn.mock.calls[0];
  expect(String(url)).toContain("/v3/company/realm-1/companyinfo/1");
  expect(String(url)).toContain("minorversion=");
  expect((init as any).headers.Authorization).toBe("Bearer AT");
});

test("qboReadCompanyInfo returns null when CompanyInfo is missing", async () => {
  const fetchFn = vi.fn(async () => jsonResponse({ time: "now" }));
  expect(await qboReadCompanyInfo(fetchFn as any, api, "AT", "r")).toBeNull();
});

test("qboReadCompanyInfo throws on a non-2xx response", async () => {
  const fetchFn = vi.fn(async () => jsonResponse({ Fault: {} }, 401));
  await expect(qboReadCompanyInfo(fetchFn as any, api, "AT", "r")).rejects.toThrow();
});

test("qboCdc groups changed invoices and customers", async () => {
  const fetchFn = vi.fn(async () =>
    jsonResponse({ CDCResponse: [{ QueryResponse: [{ Invoice: [{ Id: "1" }] }, { Customer: [{ Id: "7" }] }] }] }));
  const out = await qboCdc(fetchFn as any, api, "AT", "realm-2", "2026-06-01T00:00:00Z");
  expect(out.invoices.map((i) => i.Id)).toEqual(["1"]);
  expect(out.customers.map((c) => c.Id)).toEqual(["7"]);
  expect(String(fetchFn.mock.calls[0][0])).toContain("/cdc?entities=Invoice,Customer,Payment,CreditMemo&changedSince=");
});

test("qboQuery throws on a non-2xx response", async () => {
  const fetchFn = vi.fn(async () => jsonResponse({ Fault: {} }, 401));
  await expect(qboQuery(fetchFn as any, api, "AT", "r", "q", "Invoice")).rejects.toThrow();
});

test("retryAfterWaitMs reads delta-seconds and caps at 2s", () => {
  expect(retryAfterWaitMs("1")).toBe(1000);
  expect(retryAfterWaitMs("30")).toBe(QBO_429_WAIT_CAP_MS);
  expect(retryAfterWaitMs("0")).toBe(0);
  expect(retryAfterWaitMs(null)).toBe(0);
  expect(retryAfterWaitMs("Wed, 21 Oct 2015 07:28:00 GMT")).toBe(0);
});

test("qboQuery retries a 429 that honors Retry-After, then succeeds", async () => {
  const waits: number[] = [];
  const clock = {
    now: () => 0,
    sleep: async (ms: number) => { waits.push(ms); },
  };
  const fetchFn = vi.fn()
    .mockResolvedValueOnce(new Response("throttled", { status: 429, headers: { "Retry-After": "30" } }))
    .mockResolvedValueOnce(jsonResponse({ QueryResponse: { Invoice: [{ Id: "9" }] } }));
  const rows = await qboQuery(fetchFn as any, api, "AT", "r", "q", "Invoice", clock);
  expect(rows.map((r) => r.Id)).toEqual(["9"]);
  expect(fetchFn).toHaveBeenCalledTimes(2);
  expect(waits).toEqual([QBO_429_WAIT_CAP_MS]);
});

test("qboQuery throws after 3 attempts when 429 persists", async () => {
  const waits: number[] = [];
  const clock = {
    now: () => 0,
    sleep: async (ms: number) => { waits.push(ms); },
  };
  const fetchFn = vi.fn(async () =>
    new Response("throttled", { status: 429, headers: { "Retry-After": "1" } }));
  await expect(qboQuery(fetchFn as any, api, "AT", "r", "q", "Invoice", clock))
    .rejects.toThrow("QBO API request failed: 429");
  expect(fetchFn).toHaveBeenCalledTimes(3);
  expect(waits).toEqual([1000, 1000]);
});

test("qboQuery does not retry 401", async () => {
  const sleep = vi.fn(async () => {});
  const fetchFn = vi.fn(async () => jsonResponse({ Fault: {} }, 401));
  await expect(qboQuery(fetchFn as any, api, "AT", "r", "q", "Invoice", { sleep, now: () => 0 }))
    .rejects.toThrow("QBO API request failed: 401");
  expect(fetchFn).toHaveBeenCalledTimes(1);
  expect(sleep).not.toHaveBeenCalled();
});

test("qboCdc requests payments + credit memos and flattens all four entities", async () => {
  let requestedUrl = "";
  const fetchFn = (async (url: string) => {
    requestedUrl = url;
    return {
      ok: true,
      json: async () => ({
        CDCResponse: [{
          QueryResponse: [
            { Invoice: [{ Id: "1" }] },
            { Customer: [{ Id: "9" }] },
            { Payment: [{ Id: "501" }] },
            { CreditMemo: [{ Id: "777" }] },
          ],
        }],
      }),
    } as any;
  }) as unknown as typeof fetch;

  const res = await qboCdc(fetchFn, { baseUrl: "https://x" }, "tok", "RID", "2026-06-01T00:00:00Z");
  expect(decodeURIComponent(requestedUrl)).toContain("entities=Invoice,Customer,Payment,CreditMemo");
  expect(res.invoices.map((i) => i.Id)).toEqual(["1"]);
  expect(res.customers.map((c) => c.Id)).toEqual(["9"]);
  expect(res.payments.map((p) => p.Id)).toEqual(["501"]);
  expect(res.creditMemos.map((c) => c.Id)).toEqual(["777"]);
});
