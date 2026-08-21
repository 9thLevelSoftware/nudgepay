import { describe, expect, it } from "vitest";
import { applySecurityHeaders, SECURITY_HEADERS, withSecurityHeaders } from "../app/lib/security-headers";

describe("security headers", () => {
  it("sets CSP frame-ancestors none and nosniff", () => {
    const headers = applySecurityHeaders(new Headers());
    expect(headers.get("Content-Security-Policy")).toBe("frame-ancestors 'none'");
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(Object.keys(SECURITY_HEADERS).length).toBeGreaterThan(4);
  });

  it("does not overwrite an existing header", () => {
    const headers = new Headers({ "X-Content-Type-Options": "keep" });
    applySecurityHeaders(headers);
    expect(headers.get("X-Content-Type-Options")).toBe("keep");
  });

  it("copies status onto the wrapped response", () => {
    const wrapped = withSecurityHeaders(new Response("x", { status: 201 }));
    expect(wrapped.status).toBe(201);
    expect(wrapped.headers.get("Referrer-Policy")).toBeTruthy();
  });
});
