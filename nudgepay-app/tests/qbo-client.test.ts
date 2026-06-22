import { expect, test, vi } from "vitest";
import {
  buildAuthorizeUrl, exchangeCodeForTokens, refreshTokens, revokeToken,
} from "../app/lib/qbo-client.server";

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

test("revokeToken posts the token and resolves on 200", async () => {
  const fetchFn = vi.fn(async () => new Response(null, { status: 200 }));
  await revokeToken(fetchFn as any, cfg, "rt");
  expect(fetchFn).toHaveBeenCalledOnce();
});
