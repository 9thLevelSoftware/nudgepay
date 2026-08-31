import { describe, expect, it, vi } from "vitest";
import {
  operatorAlertPayload,
  operatorAlertWebhookOk,
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
  it("truncates message and includes cron", () => {
    const payload = operatorAlertPayload({
      handler: "scheduled",
      cron: "*/30 * * * *",
      err: new Error("x".repeat(600)),
    });
    expect(payload.source).toBe("nudgepay");
    expect(payload.event).toBe("unhandled_worker_error");
    expect(payload.handler).toBe("scheduled");
    expect(payload.cron).toBe("*/30 * * * *");
    expect(payload.message.length).toBe(500);
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
      message: "cdc down",
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
