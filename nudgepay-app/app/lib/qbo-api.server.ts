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
export const QBO_API_REQUEST_TIMEOUT_MS = 20_000;

export class QboApiTimeoutError extends Error {
  readonly name = "QboApiTimeoutError";

  constructor() {
    super("QBO API request timed out");
  }
}

export type QboRetryClock = {
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  now?: () => number;
  /** null means the caller owns the deadline through RequestInit.signal. */
  timeoutMs?: number | null;
};

export function qboApiBaseUrl(sandbox: boolean): string {
  return sandbox
    ? "https://sandbox-quickbooks.api.intuit.com"
    : "https://quickbooks.api.intuit.com";
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The operation was aborted", "AbortError");
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortReason(signal));
      return;
    }
    const timer = setTimeout(done, ms);
    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      reject(abortReason(signal!));
    };
    function cleanup() {
      signal?.removeEventListener("abort", onAbort);
    }
    function done() {
      cleanup();
      resolve();
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function sleepWithAbort(
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>,
  ms: number,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) return Promise.reject(abortReason(signal));
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      fn();
    };
    const onAbort = () => finish(() => reject(abortReason(signal)));
    signal.addEventListener("abort", onAbort, { once: true });
    let pendingSleep: Promise<void>;
    try {
      pendingSleep = sleep(ms, signal);
    } catch (error) {
      finish(() => reject(error));
      return;
    }
    Promise.resolve(pendingSleep).then(
      () => finish(resolve),
      (error) => finish(() => reject(error)),
    );
  });
}

function raceWithAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortReason(signal));
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      fn();
    };
    const onAbort = () => finish(() => reject(abortReason(signal)));
    signal.addEventListener("abort", onAbort, { once: true });
    operation.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    );
  });
}

async function withQboRequestDeadline<T>(
  clock: QboRetryClock,
  callerSignal: AbortSignal | null | undefined,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const onCallerAbort = () => controller.abort(abortReason(callerSignal!));
  if (callerSignal?.aborted) onCallerAbort();
  else callerSignal?.addEventListener("abort", onCallerAbort, { once: true });

  const timeoutMs = clock.timeoutMs === undefined ? QBO_API_REQUEST_TIMEOUT_MS : clock.timeoutMs;
  const timeout = timeoutMs === null
    ? undefined
    : setTimeout(() => {
      if (controller.signal.aborted) return;
      timedOut = true;
      controller.abort();
    }, Math.max(1, timeoutMs));

  try {
    if (controller.signal.aborted) throw abortReason(controller.signal);
    return await raceWithAbort(operation(controller.signal), controller.signal);
  } catch (error) {
    if (timedOut) throw new QboApiTimeoutError();
    throw error;
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    callerSignal?.removeEventListener("abort", onCallerAbort);
  }
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
  return withQboRequestDeadline(clock, init.signal, async (signal) => {
    const sleep = clock.sleep ?? defaultSleep;
    const now = clock.now ?? Date.now;
    let res: Response | undefined;
    for (let attempt = 0; attempt <= QBO_429_MAX_RETRIES; attempt++) {
      res = await fetchFn(input, { ...init, signal });
      if (res.status !== 429 || attempt === QBO_429_MAX_RETRIES) return res;
      const waitMs = retryAfterWaitMs(res.headers?.get("Retry-After"));
      // Wait is a delta from Retry-After, not an HTTP-date. `now` is the test clock.
      if (waitMs > 0) {
        now();
        await sleepWithAbort(sleep, waitMs, signal);
      }
    }
    return res!;
  });
}

async function getJson(
  fetchFn: typeof fetch, url: string, accessToken: string, clock: QboRetryClock = {},
): Promise<any> {
  return withQboRequestDeadline(clock, undefined, async (signal) => {
    const res = await fetchWithIntuitRetry(fetchFn, url, {
      method: "GET",
      headers: qboGetHeaders(accessToken),
      signal,
    }, { ...clock, timeoutMs: null });
    if (!res.ok) throw new Error(`QBO API request failed: ${res.status}`);
    return res.json();
  });
}

function qboFaultCodes(body: unknown): string[] {
  if (body == null || typeof body !== "object") return [];
  const err = (body as { Fault?: { Error?: unknown } }).Fault?.Error;
  const list = Array.isArray(err) ? err : err != null ? [err] : [];
  return list.map((e) => String((e as { code?: unknown })?.code ?? "")).filter(Boolean);
}

/** HTTP 404, or HTTP 400 Fault 610 (Intuit "object not found" / deleted). */
export function isQboObjectNotFound(status: number, body: unknown): boolean {
  if (status === 404) return true;
  if (status !== 400) return false;
  return qboFaultCodes(body).includes("610");
}

function qboGetHeaders(accessToken: string): HeadersInit {
  return { Authorization: `Bearer ${accessToken}`, Accept: "application/json" };
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
export const QBO_QUERY_MAX_PAGES = 50;

export type QboQueryAllResult = { rows: any[]; truncated: boolean };

/**
 * Page Intuit queries until a short page. `selectClause` must not include
 * startposition/maxresults — those are appended here.
 * `truncated` is true when the 50-page loop exits on a full last page.
 */
export async function qboQueryAll(
  fetchFn: typeof fetch, api: QboApiConfig, accessToken: string,
  realmId: string, selectClause: string, entityName: "Invoice" | "Customer" | "Payment" | "CreditMemo",
  clock: QboRetryClock = {},
  pageSize: number = QBO_QUERY_PAGE,
): Promise<QboQueryAllResult> {
  const size = Math.max(1, Math.floor(pageSize));
  const all: any[] = [];
  let start = 1;
  for (let n = 0; n < QBO_QUERY_MAX_PAGES; n++) {
    const q = `${selectClause} startposition ${start} maxresults ${size}`;
    const page = await qboQuery(fetchFn, api, accessToken, realmId, q, entityName, clock);
    all.push(...page);
    if (page.length < size) return { rows: all, truncated: false };
    start += size;
  }
  return { rows: all, truncated: true };
}

export async function qboReadEntity(
  fetchFn: typeof fetch, api: QboApiConfig, accessToken: string,
  realmId: string, entityName: "Invoice" | "Customer" | "Payment" | "CreditMemo" | "CompanyInfo", id: string,
  clock: QboRetryClock = {},
): Promise<any | null> {
  const url = `${api.baseUrl}/v3/company/${realmId}/${entityName.toLowerCase()}/${id}`
    + `?minorversion=${MINOR_VERSION}`;
  return withQboRequestDeadline(clock, undefined, async (signal) => {
    const res = await fetchWithIntuitRetry(fetchFn, url, {
      method: "GET",
      headers: qboGetHeaders(accessToken),
      signal,
    }, { ...clock, timeoutMs: null });
    if (res.ok) {
      const data = (await res.json()) as Record<string, unknown>;
      return data[entityName] ?? null;
    }
    const body = await res.json().catch(() => null);
    if (isQboObjectNotFound(res.status, body)) return null;
    throw new Error(`QBO API request failed: ${res.status}`);
  });
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
