import { fetchWithIntuitRetry, type QboRetryClock } from "./qbo-api.server";

const AUTH_URL = "https://appcenter.intuit.com/connect/oauth2";
const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const REVOKE_URL = "https://developer.api.intuit.com/v2/oauth2/tokens/revoke";
const SCOPE = "com.intuit.quickbooks.accounting";
export const QBO_TOKEN_REQUEST_TIMEOUT_MS = 20_000;
export const QBO_REVOKE_TIMEOUT_MS = 20_000;

export type QboTokens = { accessToken: string; refreshToken: string; expiresIn: number };
export type QboHttpConfig = { clientId: string; clientSecret: string; redirectUri: string };

export class QboTokenRequestError extends Error {
  readonly name = "QboTokenRequestError";

  constructor(readonly status: number, readonly errorCode?: string) {
    super(`QBO token request failed: ${status}`);
  }
}

export class QboTokenTimeoutError extends Error {
  readonly name = "QboTokenTimeoutError";

  constructor() {
    super("QBO token request timed out");
  }
}

export class QboRevokeTimeoutError extends Error {
  readonly name = "QboRevokeTimeoutError";

  constructor() {
    super("QBO revoke request timed out");
  }
}

export function isDefinitiveQboRefreshFailure(error: unknown): boolean {
  return error instanceof QboTokenRequestError
    && error.status === 400
    && error.errorCode === "invalid_grant";
}

function basicAuth(cfg: QboHttpConfig): string {
  return "Basic " + btoa(`${cfg.clientId}:${cfg.clientSecret}`);
}

export function buildAuthorizeUrl(cfg: QboHttpConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    scope: SCOPE,
    redirect_uri: cfg.redirectUri,
    response_type: "code",
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

async function postForTokens(
  fetchFn: typeof fetch, cfg: QboHttpConfig, body: URLSearchParams, clock: QboRetryClock = {},
): Promise<QboTokens> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), QBO_TOKEN_REQUEST_TIMEOUT_MS);
  try {
    const res = await fetchWithIntuitRetry(fetchFn, TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        Authorization: basicAuth(cfg),
      },
      body: body.toString(),
      signal: controller.signal,
    }, { ...clock, timeoutMs: null });
    if (!res.ok) {
      const payload = await res.json().catch(() => null) as { error?: unknown } | null;
      const errorCode = typeof payload?.error === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(payload.error)
        ? payload.error
        : undefined;
      throw new QboTokenRequestError(res.status, errorCode);
    }
    const data = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number };
    return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresIn: data.expires_in };
  } catch (error) {
    if (controller.signal.aborted) throw new QboTokenTimeoutError();
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function exchangeCodeForTokens(
  fetchFn: typeof fetch, cfg: QboHttpConfig, code: string, clock: QboRetryClock = {},
) {
  return postForTokens(fetchFn, cfg, new URLSearchParams({
    grant_type: "authorization_code", code, redirect_uri: cfg.redirectUri,
  }), clock);
}

export function refreshTokens(
  fetchFn: typeof fetch, cfg: QboHttpConfig, refreshToken: string, clock: QboRetryClock = {},
) {
  return postForTokens(fetchFn, cfg, new URLSearchParams({
    grant_type: "refresh_token", refresh_token: refreshToken,
  }), clock);
}

export async function revokeToken(fetchFn: typeof fetch, cfg: QboHttpConfig, token: string): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), QBO_REVOKE_TIMEOUT_MS);
  try {
    const res = await fetchFn(REVOKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: basicAuth(cfg) },
      body: JSON.stringify({ token }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`QBO revoke failed: ${res.status}`);
  } catch (error) {
    if (controller.signal.aborted) throw new QboRevokeTimeoutError();
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
