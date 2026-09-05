import { expect, test, vi } from "vitest";
import {
  buildAuthorizeUrl, exchangeCodeForTokens, isDefinitiveQboRefreshFailure,
  QBO_REVOKE_TIMEOUT_MS, QBO_TOKEN_REQUEST_TIMEOUT_MS, QboRevokeTimeoutError,
  QboTokenRequestError, QboTokenTimeoutError, refreshTokens, revokeToken,
} from "../app/lib/qbo-client.server";
import { QBO_429_WAIT_CAP_MS } from "../app/lib/qbo-api.server";

const cfg = { clientId: "cid", clientSecret: "secret", redirectUri: "http://localhost:5173/auth/qbo/callback" };

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

test("buildAuthorizeUrl includes client_id, redirect_uri, scope, state, response_type", () => {
  const url = new URL(buildAuthorizeUrl(cfg, "nonce123"));
  expect(url.searchParams.get("client_id")).toBe("cid");
  expect(url.searchParams.get("redirect_uri")).toBe(cfg.redirectUri);
  expect(url.searchParams.get("state")).toBe("nonce123");
  expect(url.searchParams.get("response_type")).toBe("code");
  expect(url.searchParams.get("scope")).toContain("accounting");
});

test("exchangeCodeForTokens posts auth code and parses tokens", async () => {
  const fetchFn = vi.fn(async () =>
    jsonResponse({ access_token: "at", refresh_token: "rt", expires_in: 3600 }));
  const tokens = await exchangeCodeForTokens(fetchFn as any, cfg, "auth-code");
  expect(tokens).toEqual({ accessToken: "at", refreshToken: "rt", expiresIn: 3600 });
  const [, init] = fetchFn.mock.calls[0];
  expect((init as RequestInit).method).toBe("POST");
  expect(String((init as any).body)).toContain("grant_type=authorization_code");
  expect(String((init as any).body)).toContain("auth-code");
  expect((init as any).headers.Authorization).toMatch(/^Basic /);
});

test("refreshTokens sends grant_type=refresh_token and parses rotated tokens", async () => {
  const fetchFn = vi.fn(async () =>
    jsonResponse({ access_token: "at2", refresh_token: "rt2", expires_in: 3600 }));
  const tokens = await refreshTokens(fetchFn as any, cfg, "old-rt");
  expect(tokens.refreshToken).toBe("rt2");
  expect(String((fetchFn.mock.calls[0][1] as any).body)).toContain("grant_type=refresh_token");
});

test("exchangeCodeForTokens throws on non-200", async () => {
  const fetchFn = vi.fn(async () => jsonResponse({ error: "invalid_grant" }, 400));
  await expect(exchangeCodeForTokens(fetchFn as any, cfg, "bad")).rejects.toThrow();
});

test("exchangeCodeForTokens retries 429 then succeeds", async () => {
  const waits: number[] = [];
  const clock = {
    now: () => 0,
    sleep: async (ms: number) => { waits.push(ms); },
  };
  const fetchFn = vi.fn()
    .mockResolvedValueOnce(new Response("throttled", { status: 429, headers: { "Retry-After": "5" } }))
    .mockResolvedValueOnce(jsonResponse({ access_token: "at", refresh_token: "rt", expires_in: 3600 }));
  const tokens = await exchangeCodeForTokens(fetchFn as any, cfg, "auth-code", clock);
  expect(tokens.accessToken).toBe("at");
  expect(fetchFn).toHaveBeenCalledTimes(2);
  expect(waits).toEqual([QBO_429_WAIT_CAP_MS]);
});

test("exchangeCodeForTokens does not retry invalid_grant", async () => {
  const sleep = vi.fn(async () => {});
  const fetchFn = vi.fn(async () => jsonResponse({ error: "invalid_grant" }, 400));
  await expect(exchangeCodeForTokens(fetchFn as any, cfg, "bad", { sleep, now: () => 0 }))
    .rejects.toThrow("QBO token request failed: 400");
  expect(fetchFn).toHaveBeenCalledTimes(1);
  expect(sleep).not.toHaveBeenCalled();
});

test("token failures expose only a bounded error code for refresh classification", async () => {
  const fetchFn = vi.fn(async () => jsonResponse({
    error: "invalid_grant",
    error_description: "customer@example.com token=provider-secret",
  }, 400));
  const error = await exchangeCodeForTokens(fetchFn as any, cfg, "bad").catch((cause) => cause);
  expect(error).toBeInstanceOf(QboTokenRequestError);
  expect(error).toMatchObject({ status: 400, errorCode: "invalid_grant" });
  expect(isDefinitiveQboRefreshFailure(error)).toBe(true);
  expect(JSON.stringify(error)).not.toMatch(/customer@example\.com|provider-secret/);
  expect(isDefinitiveQboRefreshFailure(new QboTokenRequestError(503))).toBe(false);
});

test("token requests abort below the refresh lease and remain transient", async () => {
  vi.useFakeTimers();
  try {
    const fetchFn = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    }));
    const pending = refreshTokens(fetchFn as any, cfg, "old-rt").catch((cause) => cause);
    await vi.advanceTimersByTimeAsync(QBO_TOKEN_REQUEST_TIMEOUT_MS);
    const error = await pending;

    expect(QBO_TOKEN_REQUEST_TIMEOUT_MS).toBeLessThan(30_000);
    expect(error).toBeInstanceOf(QboTokenTimeoutError);
    expect(isDefinitiveQboRefreshFailure(error)).toBe(false);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});

test("revokeToken posts JSON {token} with application/json and Basic auth", async () => {
  const fetchFn = vi.fn(async () => new Response(null, { status: 200 }));
  await revokeToken(fetchFn as any, cfg, "rt");
  const [, init] = fetchFn.mock.calls[0];
  expect((init as any).headers["Content-Type"]).toBe("application/json");
  expect((init as any).headers.Authorization).toMatch(/^Basic /);
  expect(JSON.parse(String((init as any).body))).toEqual({ token: "rt" });
});

test("revokeToken throws on non-200", async () => {
  const fetchFn = vi.fn(async () => new Response(null, { status: 400 }));
  await expect(revokeToken(fetchFn as any, cfg, "rt")).rejects.toThrow();
});

test("revokeToken aborts a hung provider call so callers can preserve credentials", async () => {
  vi.useFakeTimers();
  try {
    const fetchFn = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    }));
    const pending = revokeToken(fetchFn as any, cfg, "rt").catch((cause) => cause);
    await vi.advanceTimersByTimeAsync(QBO_REVOKE_TIMEOUT_MS);
    const error = await pending;

    expect(error).toBeInstanceOf(QboRevokeTimeoutError);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});
