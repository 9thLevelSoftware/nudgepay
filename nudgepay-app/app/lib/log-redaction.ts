const MAX_LOG_TEXT_LENGTH = 2_000;
const SENSITIVE_QUERY_VALUE = /([?&](?:code|token|access_token|refresh_token|key|secret|signature|state)=)[^&#\s]*/gi;
const BEARER_VALUE = /(\bBearer\s+)[A-Za-z0-9._~+/=-]+/gi;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const ASSIGNED_SECRET = /(\b(?:password|secret|token|api[_-]?key|authorization)\s*[:=]\s*)[^\s,;&]+/gi;
const SAFE_ERROR_NAMES = new Set([
  "Error",
  "TypeError",
  "RangeError",
  "SyntaxError",
  "AbortError",
  "TimeoutError",
  "ProviderSendRejectedError",
  "ProviderResponseAmbiguousError",
  "AmbiguousSendError",
  "QboTokenRequestError",
  "QboTokenTimeoutError",
  "QboRevokeTimeoutError",
  "QboApiTimeoutError",
]);
const SAFE_ERROR_CODE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const SAFE_CSP_URI_TOKENS = new Set(["inline", "eval", "wasm-eval", "self", "data", "blob"]);
const MAX_CSP_URI_LENGTH = 512;

export type SafeErrorDetails = {
  errorName: string;
  errorCode?: string;
  status?: number;
};

/** Keeps diagnostic classification while dropping exception messages, bodies, hints, and stacks. */
export function safeErrorDetails(error: unknown): SafeErrorDetails {
  const record = error && typeof error === "object" ? error as Record<string, unknown> : undefined;
  const candidateName = record && typeof record.name === "string" ? record.name : undefined;
  const errorName = candidateName && SAFE_ERROR_NAMES.has(candidateName)
    ? candidateName
    : "UnknownError";
  const candidateCode = record?.code;
  const errorCode = typeof candidateCode === "string" && SAFE_ERROR_CODE.test(candidateCode)
    ? candidateCode
    : undefined;
  const candidateStatus = record?.status ?? record?.statusCode;
  const status = typeof candidateStatus === "number"
    && Number.isInteger(candidateStatus)
    && candidateStatus >= 400
    && candidateStatus <= 599
    ? candidateStatus
    : undefined;
  return { errorName, ...(errorCode ? { errorCode } : {}), ...(status ? { status } : {}) };
}

export function requestIdFromContext(context: unknown): string | undefined {
  const value = (context as { cloudflare?: { requestId?: unknown } } | undefined)
    ?.cloudflare?.requestId;
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : undefined;
}

/** Random request IDs make this a stable 1-in-16 sample that callers cannot select. */
export function shouldLogCspReport(requestId: string): boolean {
  let hash = 0x811c9dc5;
  for (let i = 0; i < requestId.length; i += 1) {
    hash ^= requestId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % 16 === 0;
}

export function redactSensitiveText(value: string): string {
  return value
    .slice(0, MAX_LOG_TEXT_LENGTH)
    .replace(SENSITIVE_QUERY_VALUE, "$1[REDACTED]")
    .replace(BEARER_VALUE, "$1[REDACTED]")
    .replace(EMAIL, "[REDACTED_EMAIL]")
    .replace(ASSIGNED_SECRET, "$1[REDACTED]");
}

function redactSensitivePath(pathname: string): string {
  return pathname.replace(/^(\/accept\/)[^/]+/i, "$1[REDACTED]");
}

export function safeUrlForLog(value: string): string {
  try {
    const url = new URL(value);
    return `${url.origin}${redactSensitivePath(url.pathname)}`;
  } catch {
    return "[invalid-url]";
  }
}

export function safePathForLog(value: string): string {
  try {
    return redactSensitivePath(new URL(value).pathname);
  } catch {
    return "[invalid-path]";
  }
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function safeCspUri(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (SAFE_CSP_URI_TOKENS.has(value)) return value;
  try {
    const url = new URL(value);
    if (url.protocol === "data:") return "data";
    if (url.protocol === "blob:") return "blob";
    if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol)) return "[invalid-url]";
    return `${url.origin}${redactSensitivePath(url.pathname)}`.slice(0, MAX_CSP_URI_LENGTH);
  } catch {
    return "[invalid-url]";
  }
}

function safeCspDirective(value: string | undefined): string | undefined {
  const directive = value?.trim().split(/\s+/, 1)[0]?.toLowerCase();
  return directive && /^[a-z][a-z0-9-]{0,63}$/.test(directive) ? directive : undefined;
}

function safeCspDisposition(value: string | undefined): "report" | "enforce" | undefined {
  return value === "report" || value === "enforce" ? value : undefined;
}

/** Logs only CSP fields useful for rollout analysis; script samples are omitted. */
export function logCspReport(payload: unknown, requestId: string): void {
  if (!payload || typeof payload !== "object") return;
  const envelope = payload as Record<string, unknown>;
  const candidate = envelope["csp-report"] ?? payload;
  if (!candidate || typeof candidate !== "object") return;
  const report = candidate as Record<string, unknown>;

  console.warn({
    event: "csp_violation",
    requestId,
    documentUri: safeCspUri(optionalString(report, "document-uri")),
    blockedUri: safeCspUri(optionalString(report, "blocked-uri")),
    violatedDirective: safeCspDirective(optionalString(report, "violated-directive")),
    effectiveDirective: safeCspDirective(optionalString(report, "effective-directive")),
    disposition: safeCspDisposition(optionalString(report, "disposition")),
  });
}
