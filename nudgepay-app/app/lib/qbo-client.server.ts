const AUTH_URL = "https://appcenter.intuit.com/connect/oauth2";
const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const REVOKE_URL = "https://developer.api.intuit.com/v2/oauth2/tokens/revoke";
const SCOPE = "com.intuit.quickbooks.accounting";

export type QboTokens = { accessToken: string; refreshToken: string; expiresIn: number };
export type QboHttpConfig = { clientId: string; clientSecret: string; redirectUri: string };

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
  fetchFn: typeof fetch, cfg: QboHttpConfig, body: URLSearchParams,
): Promise<QboTokens> {
  const res = await fetchFn(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      Authorization: basicAuth(cfg),
    },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`QBO token request failed: ${res.status}`);
  const data = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number };
  return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresIn: data.expires_in };
}

export function exchangeCodeForTokens(fetchFn: typeof fetch, cfg: QboHttpConfig, code: string) {
  return postForTokens(fetchFn, cfg, new URLSearchParams({
    grant_type: "authorization_code", code, redirect_uri: cfg.redirectUri,
  }));
}

export function refreshTokens(fetchFn: typeof fetch, cfg: QboHttpConfig, refreshToken: string) {
  return postForTokens(fetchFn, cfg, new URLSearchParams({
    grant_type: "refresh_token", refresh_token: refreshToken,
  }));
}

export async function revokeToken(fetchFn: typeof fetch, cfg: QboHttpConfig, token: string): Promise<void> {
  const res = await fetchFn(REVOKE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: basicAuth(cfg) },
    body: JSON.stringify({ token }),
  });
  if (!res.ok) throw new Error(`QBO revoke failed: ${res.status}`);
}
