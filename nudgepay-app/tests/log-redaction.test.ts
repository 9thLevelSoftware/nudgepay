import { describe, expect, it, vi } from "vitest";
import {
  logCspReport,
  redactSensitiveText,
  safeErrorDetails,
  safeUrlForLog,
  shouldLogCspReport,
} from "../app/lib/log-redaction";

describe("log redaction", () => {
  it("drops query strings and fragments from logged URLs", () => {
    expect(safeUrlForLog("https://app.example/auth/qbo/callback?code=secret&state=also-secret#x"))
      .toBe("https://app.example/auth/qbo/callback");
  });

  it("redacts invite tokens embedded in route paths", () => {
    expect(safeUrlForLog("https://app.example/accept/signed-invite-token"))
      .toBe("https://app.example/accept/[REDACTED]");
  });

  it("redacts credentials and email addresses in error text", () => {
    const redacted = redactSensitiveText(
      "Bearer abc.def.ghi for jane@example.com at https://x.test/a?token=secret&ok=1",
    );
    expect(redacted).not.toContain("abc.def.ghi");
    expect(redacted).not.toContain("jane@example.com");
    expect(redacted).not.toContain("token=secret");
    expect(redacted).toContain("ok=1");
  });

  it("reduces exceptions to allowlisted diagnostic fields", () => {
    const error = Object.assign(
      new Error('provider body: {"email":"customer@example.com","token":"secret"}'),
      { code: "ECONNRESET", status: 502, responseBody: "private" },
    );
    const safe = safeErrorDetails(error);
    expect(safe).toEqual({ errorName: "Error", errorCode: "ECONNRESET", status: 502 });
    expect(JSON.stringify(safe)).not.toMatch(/customer|secret|private|provider body/i);
  });

  it("logs only allowlisted, sanitized CSP report fields", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    logCspReport({
      "csp-report": {
        "document-uri": "https://app.example/reset-password?token=secret",
        "blocked-uri": "https://cdn.example/script.js?sig=secret",
        "violated-directive": "script-src-elem",
        "script-sample": "window.secret = 'do-not-log'",
      },
    }, "request-1");

    expect(warn).toHaveBeenCalledWith({
      event: "csp_violation",
      requestId: "request-1",
      documentUri: "https://app.example/reset-password",
      blockedUri: "https://cdn.example/script.js",
      violatedDirective: "script-src-elem",
      effectiveDirective: undefined,
      disposition: undefined,
    });
    expect(warn.mock.calls[0][0]).not.toHaveProperty("script-sample");
    warn.mockRestore();
  });

  it("does not log arbitrary invalid CSP URI values", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    logCspReport({
      "csp-report": {
        "document-uri": "customer@example.com token=secret",
        "blocked-uri": "inline",
      },
    }, "request-2");
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({
      documentUri: "[invalid-url]",
      blockedUri: "inline",
    }));
    warn.mockRestore();
  });

  it("samples CSP report logs deterministically at a bounded rate", () => {
    const decisions = Array.from({ length: 256 }, (_, i) => shouldLogCspReport(`request-${i}`));
    expect(decisions.filter(Boolean).length).toBeGreaterThan(0);
    expect(decisions.filter(Boolean).length).toBeLessThan(32);
    expect(shouldLogCspReport("request-42")).toBe(shouldLogCspReport("request-42"));
  });
});
