// Read-side QBO Accounting API client. Separate from the OAuth client
// (qbo-client.server.ts). Every call takes an injectable fetchFn so tests
// pass a mock; routes/cron pass the global fetch. No live calls in tests.

export type QboApiConfig = { baseUrl: string };
export type QboCdcResult = { invoices: any[]; customers: any[]; payments: any[]; creditMemos: any[] };

const MINOR_VERSION = "65";

// Intuit 429: honor Retry-After (delta-seconds only), cap 2s, max 2 retries
// (3 attempts total). Tests inject sleep/now so they never wait wall time.
export const QBO_429_MAX_RETRIES = 2;
export const QBO_429_WAIT_CAP_MS = 2_000;

export type QboRetryClock = {
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

export function qboApiBaseUrl(sandbox: boolean): string {
  return sandbox
    ? "https://sandbox-quickbooks.api.intuit.com"
    : "https://quickbooks.api.intuit.com";
}

function defaultSleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Parse Retry-After as delta-seconds and cap the wait. Invalid/missing → 0. */
export function retryAfterWaitMs(header: string | null | undefined, capMs = QBO_429_WAIT_CAP_MS): number {
  if (header == null || header === "") return 0;
  const seconds = Number(header);
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.min(seconds * 1000, capMs);
}

export async function fetchWithIntuitRetry(
  fetchFn: typeof fetch,
  input: string,
  init: RequestInit,
  clock: QboRetryClock = {},
): Promise<Response> {
  const sleep = clock.sleep ?? defaultSleep;
  const now = clock.now ?? Date.now;
  let res: Response | undefined;
  for (let attempt = 0; attempt <= QBO_429_MAX_RETRIES; attempt++) {
    res = await fetchFn(input, init);
    if (res.status !== 429 || attempt === QBO_429_MAX_RETRIES) return res;
    const waitMs = retryAfterWaitMs(res.headers?.get("Retry-After"));
    // Wait is a delta from Retry-After, not an HTTP-date. `now` is the test clock.
    if (waitMs > 0) {
      now();
      await sleep(waitMs);
    }
  }
  return res!;
}

async function getJson(
  fetchFn: typeof fetch, url: string, accessToken: string, clock: QboRetryClock = {},
): Promise<any> {
  const res = await fetchWithIntuitRetry(fetchFn, url, {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  }, clock);
  if (!res.ok) throw new Error(`QBO API request failed: ${res.status}`);
  return res.json();
}

export async function qboQuery(
  fetchFn: typeof fetch, api: QboApiConfig, accessToken: string,
  realmId: string, query: string, entityName: "Invoice" | "Customer" | "Payment" | "CreditMemo",
  clock: QboRetryClock = {},
): Promise<any[]> {
  const url = `${api.baseUrl}/v3/company/${realmId}/query`
    + `?query=${encodeURIComponent(query)}&minorversion=${MINOR_VERSION}`;
  const data = await getJson(fetchFn, url, accessToken, clock);
  return (data?.QueryResponse?.[entityName] ?? []) as any[];
}

export const QBO_QUERY_PAGE = 1000;

/**
 * Page Intuit queries until a short page. `selectClause` must not include
 * startposition/maxresults — those are appended here.
 */
export async function qboQueryAll(
  fetchFn: typeof fetch, api: QboApiConfig, accessToken: string,
  realmId: string, selectClause: string, entityName: "Invoice" | "Customer" | "Payment" | "CreditMemo",
  clock: QboRetryClock = {},
  pageSize: number = QBO_QUERY_PAGE,
): Promise<any[]> {
  const size = Math.max(1, Math.floor(pageSize));
  const all: any[] = [];
  let start = 1;
  for (let n = 0; n < 50; n++) {
    const q = `${selectClause} startposition ${start} maxresults ${size}`;
    const page = await qboQuery(fetchFn, api, accessToken, realmId, q, entityName, clock);
    all.push(...page);
    if (page.length < size) break;
    start += size;
  }
  return all;
}

export async function qboReadEntity(
  fetchFn: typeof fetch, api: QboApiConfig, accessToken: string,
  realmId: string, entityName: "Invoice" | "Customer" | "Payment" | "CreditMemo" | "CompanyInfo", id: string,
  clock: QboRetryClock = {},
): Promise<any | null> {
  const url = `${api.baseUrl}/v3/company/${realmId}/${entityName.toLowerCase()}/${id}`
    + `?minorversion=${MINOR_VERSION}`;
  const data = await getJson(fetchFn, url, accessToken, clock);
  return data?.[entityName] ?? null;
}

/** CompanyInfo is a singleton; Intuit uses id `"1"`. */
export function qboReadCompanyInfo(
  fetchFn: typeof fetch, api: QboApiConfig, accessToken: string, realmId: string,
  clock: QboRetryClock = {},
): Promise<any | null> {
  return qboReadEntity(fetchFn, api, accessToken, realmId, "CompanyInfo", "1", clock);
}

export async function qboCdc(
  fetchFn: typeof fetch, api: QboApiConfig, accessToken: string,
  realmId: string, changedSinceIso: string,
  clock: QboRetryClock = {},
): Promise<QboCdcResult> {
  const url = `${api.baseUrl}/v3/company/${realmId}/cdc`
    + `?entities=Invoice,Customer,Payment,CreditMemo&changedSince=${encodeURIComponent(changedSinceIso)}`
    + `&minorversion=${MINOR_VERSION}`;
  const data = await getJson(fetchFn, url, accessToken, clock);
  const groups = (data?.CDCResponse?.[0]?.QueryResponse ?? []) as any[];
  return {
    invoices: groups.flatMap((g) => g.Invoice ?? []),
    customers: groups.flatMap((g) => g.Customer ?? []),
    payments: groups.flatMap((g) => g.Payment ?? []),
    creditMemos: groups.flatMap((g) => g.CreditMemo ?? []),
  };
}
