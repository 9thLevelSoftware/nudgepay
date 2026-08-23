import { afterEach, describe, expect, it, vi } from "vitest";
import {
  authRateLimited,
  authRateLimitKey,
  memoryAuthRateLimited,
  resetMemoryAuthRateLimit,
} from "../app/lib/auth-rate-limit.server";
import { humanAuthError } from "../app/lib/auth-errors";
import { action as loginAction } from "../app/routes/login";
import { action as signupAction } from "../app/routes/signup";
import { action as forgotPasswordAction } from "../app/routes/forgot-password";

const TOO_MANY = "Too many attempts. Wait a few minutes and try again.";

afterEach(() => {
  vi.restoreAllMocks();
  resetMemoryAuthRateLimit();
});

function ctx(env: Record<string, unknown> = {}) {
  return { cloudflare: { env } };
}

function post(path: string, headers: Record<string, string> = {}) {
  const form = new FormData();
  form.set("email", "user@example.com");
  form.set("password", "password12");
  form.set("name", "Test User");
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { Origin: "http://localhost", ...headers },
    body: form,
  });
}

function rejectLimiter() {
  return { limit: vi.fn(async () => ({ success: false as const })) };
}

describe("authRateLimited", () => {
  it("rejects when the limiter returns success: false", async () => {
    const limiter = rejectLimiter();
    await expect(authRateLimited({ AUTH_RATE_LIMIT: limiter }, "203.0.113.1")).resolves.toBe(true);
    expect(limiter.limit).toHaveBeenCalledWith({ key: "203.0.113.1" });
  });

  it("allows when the limiter returns success: true", async () => {
    await expect(
      authRateLimited({ AUTH_RATE_LIMIT: { limit: async () => ({ success: true }) } }, "1.1.1.1"),
    ).resolves.toBe(false);
  });

  it("missing limiter in local/dev allows", async () => {
    await expect(authRateLimited({}, "1.1.1.1")).resolves.toBe(false);
  });

  it("Cloudflare production without a binding fails closed", async () => {
    await expect(
      authRateLimited({ AUTH_RATE_LIMIT_REQUIRED: "true" }, "203.0.113.1"),
    ).resolves.toBe(true);
  });

  it("missing limiter + AUTH_RATE_LIMIT_WAF=true allows", async () => {
    await expect(
      authRateLimited({ NODE_ENV: "production", AUTH_RATE_LIMIT_WAF: "true" }, "1.1.1.1"),
    ).resolves.toBe(false);
  });

  it("Render/Node (BUILD_TARGET=node) uses the in-memory limiter", async () => {
    const env = { BUILD_TARGET: "node", QBO_SANDBOX: "false" };
    for (let i = 0; i < 20; i++) {
      await expect(authRateLimited(env, "203.0.113.8")).resolves.toBe(false);
    }
    await expect(authRateLimited(env, "203.0.113.8")).resolves.toBe(true);
    await expect(authRateLimited(env, "203.0.113.9")).resolves.toBe(false);
  });

  it("does not evict an existing blocked bucket just to inspect it", () => {
    const blocked = "203.0.113.50";
    const now = Date.now();
    for (let i = 0; i < 20; i++) expect(memoryAuthRateLimited(blocked, now)).toBe(false);
    expect(memoryAuthRateLimited(blocked, now)).toBe(true);
    for (let i = 0; i < 9_999; i++) {
      expect(memoryAuthRateLimited(`fill-${i}`, now)).toBe(false);
    }
    expect(memoryAuthRateLimited(blocked, now)).toBe(true);
  });

  it("NODE_ENV=production without a CF binding uses the in-memory limiter", async () => {
    const env = { NODE_ENV: "production" };
    for (let i = 0; i < 20; i++) {
      await expect(authRateLimited(env, "198.51.100.8")).resolves.toBe(false);
    }
    await expect(authRateLimited(env, "198.51.100.8")).resolves.toBe(true);
  });
});

describe("authRateLimitKey", () => {
  it("prefers CF-Connecting-IP over X-Forwarded-For", () => {
    const request = post("/login", {
      "CF-Connecting-IP": "203.0.113.9",
      "x-forwarded-for": "198.51.100.1, 10.0.0.1",
    });
    expect(authRateLimitKey(request)).toBe("203.0.113.9");
  });

  it("uses the last X-Forwarded-For hop on Node/Render (trusted proxy)", () => {
    const request = post("/login", {
      "CF-Connecting-IP": "203.0.113.9",
      "x-forwarded-for": "198.51.100.1, 10.0.0.1",
    });
    expect(authRateLimitKey(request, { BUILD_TARGET: "node" })).toBe("10.0.0.1");
  });

  it("uses the first X-Forwarded-For hop when CF-Connecting-IP is absent", () => {
    const request = post("/login", { "x-forwarded-for": "198.51.100.2, 10.0.0.1" });
    expect(authRateLimitKey(request)).toBe("198.51.100.2");
  });
});

function expectRateLimitedAction(result: unknown) {
  expect(result).not.toBeInstanceOf(Response);
  const payload = result as { data?: { error?: string }; init?: { status?: number } };
  expect(payload.data?.error).toBe(TOO_MANY);
  expect(payload.data?.error).toBe(humanAuthError("email rate limit exceeded"));
  expect(payload.init?.status).toBe(429);
}

describe("auth route actions", () => {
  it("login limiter { success: false } returns 429 action data with generic error", async () => {
    const limiter = rejectLimiter();
    const result = await loginAction({
      request: post("/login", { "CF-Connecting-IP": "203.0.113.9" }),
      context: ctx({ AUTH_RATE_LIMIT: limiter }),
      params: {},
    } as any);
    expectRateLimitedAction(result);
    expect(limiter.limit).toHaveBeenCalledWith({ key: "203.0.113.9" });
  });

  it("signup limiter { success: false } returns 429 action data with generic error", async () => {
    const limiter = rejectLimiter();
    const result = await signupAction({
      request: post("/signup", { "CF-Connecting-IP": "203.0.113.9" }),
      context: ctx({ AUTH_RATE_LIMIT: limiter }),
      params: {},
    } as any);
    expectRateLimitedAction(result);
  });

  it("forgot-password limiter { success: false } returns 429 action data with generic error", async () => {
    const limiter = rejectLimiter();
    const result = await forgotPasswordAction({
      request: post("/forgot-password", { "x-forwarded-for": "198.51.100.7, 10.0.0.1" }),
      context: ctx({ AUTH_RATE_LIMIT: limiter }),
      params: {},
    } as any);
    expectRateLimitedAction(result);
    expect(limiter.limit).toHaveBeenCalledWith({ key: "198.51.100.7" });
  });
});
