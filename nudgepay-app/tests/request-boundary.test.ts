import { describe, expect, it } from "vitest";
import {
  APP_BODY_LIMIT_BYTES,
  CSP_REPORT_BODY_LIMIT_BYTES,
  PROVIDER_WEBHOOK_BODY_LIMIT_BYTES,
  applyRequestBoundary,
} from "../app/lib/request-boundary";

describe("request boundary", () => {
  it("leaves safe requests untouched", async () => {
    const request = new Request("https://app.example/dashboard");
    const result = await applyRequestBoundary(request);
    expect(result).toEqual({ ok: true, request });
  });

  it("preserves signed webhook bytes exactly", async () => {
    const bytes = new Uint8Array([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xc3, 0xa9, 0x22, 0x7d]);
    const request = new Request("https://app.example/webhooks/stripe", {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: bytes,
    });

    const result = await applyRequestBoundary(request);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(new Uint8Array(await result.request.arrayBuffer())).toEqual(bytes);
    }
  });

  it("rejects a webhook with the wrong media type before route parsing", async () => {
    const result = await applyRequestBoundary(new Request("https://app.example/webhooks/twilio/inbound", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(415);
  });

  it("rejects a declared oversized body without reading it", async () => {
    const request = new Request("https://app.example/api/assign", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "content-length": String(APP_BODY_LIMIT_BYTES + 1),
      },
      body: "x=1",
    });
    const result = await applyRequestBoundary(request);
    expect(result.ok).toBe(false);
    expect(request.bodyUsed).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(413);
  });

  it("rejects an oversized streamed body when content-length is absent", async () => {
    const body = new Uint8Array(APP_BODY_LIMIT_BYTES + 1);
    const result = await applyRequestBoundary(new Request("https://app.example/api/assign", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(413);
  });

  it("uses a bounded report endpoint and a larger provider allowance", async () => {
    const report = await applyRequestBoundary(new Request("https://app.example/__csp-report", {
      method: "POST",
      headers: {
        "content-type": "application/csp-report",
        "content-length": String(CSP_REPORT_BODY_LIMIT_BYTES + 1),
      },
      body: "{}",
    }));
    expect(report.ok).toBe(false);

    const webhook = await applyRequestBoundary(new Request("https://app.example/webhooks/qbo", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(PROVIDER_WEBHOOK_BODY_LIMIT_BYTES),
      },
      body: "{}",
    }));
    expect(webhook.ok).toBe(true);
  });

  it("accepts Reporting API JSON envelopes on the CSP endpoint", async () => {
    const report = await applyRequestBoundary(new Request("https://app.example/__csp-report", {
      method: "POST",
      headers: { "content-type": "application/reports+json" },
      body: "[]",
    }));
    expect(report.ok).toBe(true);
  });

  it("allows an empty mutation but rejects an untyped non-empty mutation", async () => {
    const empty = await applyRequestBoundary(new Request("https://app.example/logout", { method: "POST" }));
    expect(empty.ok).toBe(true);

    const untyped = await applyRequestBoundary(new Request("https://app.example/api/assign", {
      method: "POST",
      body: new Uint8Array([1]),
    }));
    expect(untyped.ok).toBe(false);
    if (!untyped.ok) expect(untyped.response.status).toBe(415);
  });
});
