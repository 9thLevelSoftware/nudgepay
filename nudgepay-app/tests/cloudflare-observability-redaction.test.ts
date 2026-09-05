import { describe, expect, it, vi } from "vitest";
import {
  enforceObservabilityQueryRedaction,
  resolveCloudflareCredentials,
} from "../scripts/enforce-observability-redaction.mjs";

const accountId = "a".repeat(32);
const token = "test-token-that-must-not-leak";

function cloudflareResponse(result: unknown, ok = true) {
  return {
    ok,
    json: async () => ({ success: ok, result }),
  } as Response;
}

describe("Cloudflare observability query redaction", () => {
  it("preserves current observability fields, patches redaction, and verifies readback", async () => {
    const existing = {
      enabled: true,
      head_sampling_rate: 0.25,
      logs: {
        enabled: true,
        invocation_logs: true,
        head_sampling_rate: 0.5,
        persist: true,
        destinations: ["cloudflare"],
      },
      traces: {
        enabled: true,
        head_sampling_rate: 0.1,
        persist: false,
        destinations: ["external"],
        propagation_policy: "authenticated",
      },
      redact_query_string: false,
    };
    const redacted = { ...existing, redact_query_string: true };
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(cloudflareResponse({ observability: existing }))
      .mockResolvedValueOnce(cloudflareResponse({ observability: redacted }))
      .mockResolvedValueOnce(cloudflareResponse({ observability: redacted }));

    await enforceObservabilityQueryRedaction({
      accountId,
      scriptName: "nudgepay-app",
      token,
      fetchFn,
    });

    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(fetchFn.mock.calls[1][0]).toBe(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/nudgepay-app/script-settings`,
    );
    expect(fetchFn.mock.calls[1][1]).toMatchObject({
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ observability: redacted }),
    });
  });

  it("fails when Cloudflare returns false after the independent readback", async () => {
    const enabled = { enabled: true, redact_query_string: true };
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(cloudflareResponse({ observability: { enabled: true } }))
      .mockResolvedValueOnce(cloudflareResponse({ observability: enabled }))
      .mockResolvedValueOnce(cloudflareResponse({ observability: { enabled: true, redact_query_string: false } }));

    await expect(enforceObservabilityQueryRedaction({
      accountId,
      scriptName: "nudgepay-app",
      token,
      fetchFn,
    })).rejects.toThrow(/false after readback/);
  });

  it("fails when readback loses a pre-existing nested observability setting", async () => {
    const existing = {
      enabled: true,
      logs: { enabled: true, invocation_logs: true, persist: true },
      redact_query_string: false,
    };
    const patched = { ...existing, redact_query_string: true };
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(cloudflareResponse({ observability: existing }))
      .mockResolvedValueOnce(cloudflareResponse({ observability: patched }))
      .mockResolvedValueOnce(cloudflareResponse({
        observability: {
          enabled: true,
          logs: { enabled: true, invocation_logs: true },
          redact_query_string: true,
          future_server_field: "allowed",
        },
      }));

    await expect(enforceObservabilityQueryRedaction({
      accountId,
      scriptName: "nudgepay-app",
      token,
      fetchFn,
    })).rejects.toThrow(/changed existing observability settings/);
  });

  it("bounds API calls and does not expose the token in timeout errors", async () => {
    const fetchFn = vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new Error(`request used ${token}`)));
    }));

    let failure: Error | undefined;
    try {
      await enforceObservabilityQueryRedaction({
        accountId,
        scriptName: "nudgepay-app",
        token,
        fetchFn,
        timeoutMs: 5,
      });
    } catch (error) {
      failure = error as Error;
    }
    expect(failure?.message).toMatch(/timed out/);
    expect(failure?.message).not.toContain(token);
  });

  it("uses Wrangler's supported credential commands without printing credentials", () => {
    const execFile = vi.fn((_executable, args: string[]) => {
      if (args.includes("auth")) return JSON.stringify({ type: "oauth", token });
      return JSON.stringify({ accounts: [{ id: accountId, name: "test" }] });
    });
    expect(resolveCloudflareCredentials({ env: {}, execFile })).toEqual({ accountId, token });
    expect(execFile.mock.calls.every((call) => call[0] === process.execPath)).toBe(true);
    expect(execFile.mock.calls.map((call) => call[1])).toEqual([
      [expect.stringMatching(/wrangler[\\/]bin[\\/]wrangler\.js$/), "auth", "token", "--json"],
      [expect.stringMatching(/wrangler[\\/]bin[\\/]wrangler\.js$/), "whoami", "--json"],
    ]);
    expect(execFile.mock.calls[0][2]).toMatchObject({
      maxBuffer: 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 15_000,
      windowsHide: true,
    });
  });

  it("requires an explicit account id when Wrangler has multiple accounts", () => {
    const execFile = vi.fn((_executable, args: string[]) => {
      if (args.includes("auth")) return JSON.stringify({ token });
      return JSON.stringify({ accounts: [{ id: accountId }, { id: "b".repeat(32) }] });
    });
    expect(() => resolveCloudflareCredentials({ env: {}, execFile })).toThrow(/CLOUDFLARE_ACCOUNT_ID/);
  });
});
