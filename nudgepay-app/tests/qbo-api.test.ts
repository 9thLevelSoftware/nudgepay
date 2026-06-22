import { expect, test, vi } from "vitest";
import {
  qboApiBaseUrl, qboQuery, qboReadEntity, qboCdc,
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

test("qboCdc groups changed invoices and customers", async () => {
  const fetchFn = vi.fn(async () =>
    jsonResponse({ CDCResponse: [{ QueryResponse: [{ Invoice: [{ Id: "1" }] }, { Customer: [{ Id: "7" }] }] }] }));
  const out = await qboCdc(fetchFn as any, api, "AT", "realm-2", "2026-06-01T00:00:00Z");
  expect(out.invoices.map((i) => i.Id)).toEqual(["1"]);
  expect(out.customers.map((c) => c.Id)).toEqual(["7"]);
  expect(String(fetchFn.mock.calls[0][0])).toContain("/cdc?entities=Invoice,Customer&changedSince=");
});

test("qboQuery throws on a non-2xx response", async () => {
  const fetchFn = vi.fn(async () => jsonResponse({ Fault: {} }, 401));
  await expect(qboQuery(fetchFn as any, api, "AT", "r", "q", "Invoice")).rejects.toThrow();
});
