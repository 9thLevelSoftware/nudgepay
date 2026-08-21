import { describe, expect, it } from "vitest";
import { hasSameOriginProof, isUnsafeMethod, requireSameOrigin } from "../app/lib/csrf.server";

describe("csrf origin proof", () => {
  it("allows safe methods without Origin", () => {
    expect(isUnsafeMethod("GET")).toBe(false);
    const req = new Request("https://app.example/login");
    expect(hasSameOriginProof(req)).toBe(true);
  });

  it("accepts matching Origin on POST", () => {
    const req = new Request("https://app.example/login", {
      method: "POST",
      headers: { Origin: "https://app.example" },
    });
    expect(hasSameOriginProof(req)).toBe(true);
  });

  it("rejects a cross-origin POST", () => {
    const req = new Request("https://app.example/login", {
      method: "POST",
      headers: { Origin: "https://evil.example" },
    });
    expect(hasSameOriginProof(req)).toBe(false);
    expect(() => requireSameOrigin(req)).toThrow();
  });

  it("falls back to Referer when Origin is absent", () => {
    const ok = new Request("https://app.example/logout", {
      method: "POST",
      headers: { Referer: "https://app.example/dashboard" },
    });
    expect(hasSameOriginProof(ok)).toBe(true);
    const bad = new Request("https://app.example/logout", {
      method: "POST",
      headers: { Referer: "https://evil.example/" },
    });
    expect(hasSameOriginProof(bad)).toBe(false);
  });
});
