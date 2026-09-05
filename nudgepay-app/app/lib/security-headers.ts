// Pure header policy applied at the Worker edge. The Node entry mirrors this
// policy because server.js cannot import TypeScript before the app is built.

export type CspMode = "report-only" | "enforce";

export const CSP_REPORT_PATH = "/__csp-report";
const THEME_BOOTSTRAP_HASH = "'sha256-k/WeqlU+P1OMnGy0Wr3QmHYLyxHHENjrrNHJgBXSVQU='";

// Direct callers without an SSR nonce fall back to report-only compatibility.
// Both production entry points pass a fresh nonce and can enforce this policy.
const BASE_SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy": "frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
};

function configuredSupabaseConnectSources(value?: string): string[] {
  if (!value) return [];
  try {
    const url = new URL(value);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
      return [];
    }
    const websocketUrl = new URL(url.origin);
    websocketUrl.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    return [url.origin, websocketUrl.origin];
  } catch {
    return [];
  }
}

export function getCspPolicy(nonce?: string, supabaseUrl?: string): string {
  const scriptSource = nonce ? `'nonce-${nonce}'` : "'unsafe-inline'";
  const connectSources = [
    "'self'",
    ...configuredSupabaseConnectSources(supabaseUrl),
  ];
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self' https://checkout.stripe.com https://billing.stripe.com https://appcenter.intuit.com",
    `script-src 'self' ${scriptSource} ${THEME_BOOTSTRAP_HASH}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    `connect-src ${connectSources.join(" ")}`,
    `report-uri ${CSP_REPORT_PATH}`,
  ].join("; ");
}

function resolveCspMode(value: string | undefined): CspMode {
  return value === "enforce" ? "enforce" : "report-only";
}

export function getSecurityHeaders(opts?: {
  cspMode?: string;
  nonce?: string;
  supabaseUrl?: string;
}): Record<string, string> {
  const mode = resolveCspMode(opts?.cspMode);
  const cspPolicy = getCspPolicy(opts?.nonce, opts?.supabaseUrl);
  if (mode === "enforce") {
    return { ...BASE_SECURITY_HEADERS, "Content-Security-Policy": cspPolicy };
  }
  return {
    ...BASE_SECURITY_HEADERS,
    "Content-Security-Policy-Report-Only": cspPolicy,
  };
}

export function applySecurityHeaders(
  headers: Headers,
  opts?: { cspMode?: string; nonce?: string; supabaseUrl?: string },
): Headers {
  for (const [key, value] of Object.entries(getSecurityHeaders(opts))) {
    if (!headers.has(key)) headers.set(key, value);
  }
  return headers;
}

export function withSecurityHeaders(
  response: Response,
  opts?: { cspMode?: string; nonce?: string; supabaseUrl?: string },
): Response {
  const headers = applySecurityHeaders(new Headers(response.headers), opts);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
