// Read-side QBO Accounting API client. Separate from the OAuth client
// (qbo-client.server.ts). Every call takes an injectable fetchFn so tests
// pass a mock; routes/cron pass the global fetch. No live calls in tests.

export type QboApiConfig = { baseUrl: string };
export type QboCdcResult = { invoices: any[]; customers: any[]; payments: any[]; creditMemos: any[] };

const MINOR_VERSION = "65";

export function qboApiBaseUrl(sandbox: boolean): string {
  return sandbox
    ? "https://sandbox-quickbooks.api.intuit.com"
    : "https://quickbooks.api.intuit.com";
}

async function getJson(fetchFn: typeof fetch, url: string, accessToken: string): Promise<any> {
  const res = await fetchFn(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`QBO API request failed: ${res.status}`);
  return res.json();
}

export async function qboQuery(
  fetchFn: typeof fetch, api: QboApiConfig, accessToken: string,
  realmId: string, query: string, entityName: "Invoice" | "Customer" | "Payment" | "CreditMemo",
): Promise<any[]> {
  const url = `${api.baseUrl}/v3/company/${realmId}/query`
    + `?query=${encodeURIComponent(query)}&minorversion=${MINOR_VERSION}`;
  const data = await getJson(fetchFn, url, accessToken);
  return (data?.QueryResponse?.[entityName] ?? []) as any[];
}

export async function qboReadEntity(
  fetchFn: typeof fetch, api: QboApiConfig, accessToken: string,
  realmId: string, entityName: "Invoice" | "Customer" | "Payment" | "CreditMemo", id: string,
): Promise<any | null> {
  const url = `${api.baseUrl}/v3/company/${realmId}/${entityName.toLowerCase()}/${id}`
    + `?minorversion=${MINOR_VERSION}`;
  const data = await getJson(fetchFn, url, accessToken);
  return data?.[entityName] ?? null;
}

export async function qboCdc(
  fetchFn: typeof fetch, api: QboApiConfig, accessToken: string,
  realmId: string, changedSinceIso: string,
): Promise<QboCdcResult> {
  const url = `${api.baseUrl}/v3/company/${realmId}/cdc`
    + `?entities=Invoice,Customer,Payment,CreditMemo&changedSince=${encodeURIComponent(changedSinceIso)}`
    + `&minorversion=${MINOR_VERSION}`;
  const data = await getJson(fetchFn, url, accessToken);
  const groups = (data?.CDCResponse?.[0]?.QueryResponse ?? []) as any[];
  return {
    invoices: groups.flatMap((g) => g.Invoice ?? []),
    customers: groups.flatMap((g) => g.Customer ?? []),
    payments: groups.flatMap((g) => g.Payment ?? []),
    creditMemos: groups.flatMap((g) => g.CreditMemo ?? []),
  };
}
