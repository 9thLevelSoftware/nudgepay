import { describe, expect, it, vi } from "vitest";
import {
  operatorAlertPayload,
  operatorAlertWebhookOk,
  providerAttemptStaleAlertPayload,
} from "../app/lib/operator-alert";
import { postOperatorAlert } from "../app/lib/operator-alert.server";

describe("operatorAlertWebhookOk", () => {
  it("accepts https URLs", () => {
    expect(operatorAlertWebhookOk("https://hooks.example/pager")).toBe(true);
  });

  it("rejects missing, http, and non-strings", () => {
    expect(operatorAlertWebhookOk(undefined)).toBe(false);
    expect(operatorAlertWebhookOk("")).toBe(false);
    expect(operatorAlertWebhookOk("http://insecure.example/pager")).toBe(false);
    expect(operatorAlertWebhookOk(1)).toBe(false);
  });
});

describe("operatorAlertPayload", () => {
  it("uses allowlisted error details and a redacted URL", () => {
    const payload = operatorAlertPayload({
      handler: "scheduled",
      cron: "*/30 * * * *",
      err: new Error("token=secret@example.com"),
      url: "https://app.example/accept/private-token?code=secret",
    });
    expect(payload.source).toBe("nudgepay");
    expect(payload.event).toBe("unhandled_worker_error");
    if (payload.event !== "unhandled_worker_error") throw new Error("wrong alert");
    expect(payload.handler).toBe("scheduled");
    expect(payload.cron).toBe("*/30 * * * *");
    expect(payload.error).toEqual({ errorName: "Error" });
    expect(payload.url).toBe("https://app.example/accept/[REDACTED]");
    expect(JSON.stringify(payload)).not.toContain("secret");
  });

  it("limits provider alerts to a channel and opaque attempt ID", () => {
    expect(providerAttemptStaleAlertPayload({ channel: "sms", attemptId: "00000000-0000-4000-8000-000000000001" })).toEqual({
      source: "nudgepay", event: "provider_attempt_stale", channel: "sms", attemptId: "00000000-0000-4000-8000-000000000001",
    });
  });
});

describe("postOperatorAlert", () => {
  it("no-ops without a webhook", async () => {
    const fetchFn = vi.fn();
    await expect(postOperatorAlert(fetchFn, "", operatorAlertPayload({
      handler: "scheduled",
      err: "x",
    }))).resolves.toBe(false);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("POSTs JSON and returns ok", async () => {
    const fetchFn = vi.fn(async () => new Response("ok", { status: 200 }));
    const payload = operatorAlertPayload({ handler: "scheduled", err: "cdc down", cron: "*/30 * * * *" });
    await expect(postOperatorAlert(fetchFn, "https://hooks.example/pager", payload)).resolves.toBe(true);
    expect(fetchFn).toHaveBeenCalledOnce();
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe("https://hooks.example/pager");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      source: "nudgepay",
      handler: "scheduled",
      error: { errorName: "UnknownError" },
    });
  });

  it("swallows fetch failures", async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error("network");
    });
    await expect(postOperatorAlert(
      fetchFn,
      "https://hooks.example/pager",
      operatorAlertPayload({ handler: "scheduled", err: "x" }),
    )).resolves.toBe(false);
  });
});
