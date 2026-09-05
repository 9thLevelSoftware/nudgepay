import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { THEME_BOOTSTRAP_SCRIPT } from "../app/components/ThemeToggle";
import {
  applySecurityHeaders,
  getCspPolicy,
  getSecurityHeaders,
  withSecurityHeaders,
} from "../app/lib/security-headers";

describe("security headers", () => {
  it("rolls the full CSP out in report-only mode by default", () => {
    const headers = applySecurityHeaders(new Headers());
    const policy = getCspPolicy();
    expect(headers.get("Content-Security-Policy")).toBe("frame-ancestors 'none'");
    expect(headers.get("Content-Security-Policy-Report-Only")).toBe(policy);
    expect(policy).toContain("script-src 'self' 'unsafe-inline'");
    expect(policy).toContain("report-uri /__csp-report");
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(Object.keys(getSecurityHeaders()).length).toBeGreaterThan(4);
  });

  it("moves the same policy to the enforcing header only when explicitly enabled", () => {
    const headers = applySecurityHeaders(new Headers(), { cspMode: "enforce" });
    expect(headers.get("Content-Security-Policy")).toBe(getCspPolicy());
    expect(headers.get("Content-Security-Policy-Report-Only")).toBeNull();
  });

  it("uses a nonce instead of unsafe-inline when SSR provides one", () => {
    const policy = getCspPolicy("nonce-value");
    expect(policy).toContain("script-src 'self' 'nonce-nonce-value'");
    expect(policy).not.toContain("script-src 'self' 'unsafe-inline'");
  });

  it("allows only the app and exact provider redirect form destinations", () => {
    const policy = getCspPolicy("nonce-value");
    expect(policy).toContain(
      "form-action 'self' https://checkout.stripe.com https://billing.stripe.com https://appcenter.intuit.com",
    );
    expect(policy).not.toContain("form-action 'self' https://*.stripe.com");
    expect(policy).not.toContain("form-action 'self' https://*.intuit.com");
  });

  it("allows the exact configured Supabase HTTP and websocket origins", () => {
    const policy = getCspPolicy("nonce-value", "http://127.0.0.1:54321/rest/v1");
    expect(policy).toContain(
      "connect-src 'self' http://127.0.0.1:54321 ws://127.0.0.1:54321",
    );
  });

  it("does not allow other Supabase projects when an exact hosted origin is configured", () => {
    const policy = getCspPolicy("nonce-value", "https://project-ref.supabase.co");
    expect(policy).toContain(
      "connect-src 'self' https://project-ref.supabase.co wss://project-ref.supabase.co",
    );
    expect(policy).not.toContain("*.supabase.co");
  });

  it("ignores malformed or non-HTTP Supabase URLs", () => {
    expect(getCspPolicy("nonce-value", "javascript:alert(1)")).not.toContain("javascript:");
    expect(getCspPolicy("nonce-value", "https://user:secret@example.com")).not.toContain("example.com");
  });

  it("allows the fixed theme bootstrap by its exact hash on loader error pages", () => {
    const digest = createHash("sha256").update(THEME_BOOTSTRAP_SCRIPT).digest("base64");
    expect(getCspPolicy("nonce-value")).toContain(`'sha256-${digest}'`);
  });

  it("does not overwrite an existing header", () => {
    const headers = new Headers({ "X-Content-Type-Options": "keep" });
    applySecurityHeaders(headers, { cspMode: "enforce" });
    expect(headers.get("X-Content-Type-Options")).toBe("keep");
  });

  it("copies status onto the wrapped response", () => {
    const wrapped = withSecurityHeaders(new Response("x", { status: 201 }));
    expect(wrapped.status).toBe(201);
    expect(wrapped.headers.get("Referrer-Policy")).toBeTruthy();
  });

  it("falls back to report-only for an unknown deployment value", () => {
    const wrapped = withSecurityHeaders(new Response("x"), { cspMode: "typo" });
    expect(wrapped.headers.get("Content-Security-Policy")).toBe("frame-ancestors 'none'");
    expect(wrapped.headers.get("Content-Security-Policy-Report-Only")).toBe(getCspPolicy());
  });
});
