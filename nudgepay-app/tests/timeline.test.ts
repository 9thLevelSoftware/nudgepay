import { expect, test } from "vitest";
import { buildTimeline, deriveSmsOutcome, OUTCOME_LABELS } from "../app/lib/timeline";
import type { TimelineLogInput, TimelineSmsInput } from "../app/lib/timeline";

test("deriveSmsOutcome: inbound is customer-replied regardless of status", () => {
  expect(deriveSmsOutcome("inbound", null, null)).toBe("customer-replied");
  expect(deriveSmsOutcome("inbound", "received", null)).toBe("customer-replied");
});

test("deriveSmsOutcome: outbound delivered/failed/undelivered/other", () => {
  expect(deriveSmsOutcome("outbound", "delivered", null)).toBe("message-delivered");
  expect(deriveSmsOutcome("outbound", "failed", "30007")).toBe("contact-invalid");
  expect(deriveSmsOutcome("outbound", "undelivered", "30006")).toBe("contact-invalid");
  expect(deriveSmsOutcome("outbound", "sent", null)).toBe("message-sent");
  expect(deriveSmsOutcome("outbound", "queued", null)).toBe("message-sent");
  expect(deriveSmsOutcome("outbound", null, null)).toBe("message-sent");
});

test("OUTCOME_LABELS covers manual + derived keys", () => {
  expect(OUTCOME_LABELS["promise-to-pay"]).toBe("Promise to pay");
  expect(OUTCOME_LABELS["escalation-required"]).toBe("Escalation required");
  expect(OUTCOME_LABELS["customer-replied"]).toBe("Customer replied");
  expect(OUTCOME_LABELS["other"]).toBe("Other");
});

test("buildTimeline returns [] for empty inputs", () => {
  expect(buildTimeline([], [])).toEqual([]);
});

test("buildTimeline maps a log entry with its outcome label", () => {
  const logs: TimelineLogInput[] = [{
    id: "l1", at: "2026-06-20T10:00:00+00:00", method: "call", outcome: "promise-to-pay",
    notes: "spoke to AP", followUpAt: null, promisedAmount: 500, promisedDate: "2026-06-25",
  }];
  const [e] = buildTimeline(logs, []);
  expect(e.kind).toBe("log");
  if (e.kind === "log") {
    expect(e.outcomeLabel).toBe("Promise to pay");
    expect(e.promisedAmount).toBe(500);
  }
});

test("buildTimeline maps an sms entry with a derived label", () => {
  const sms: TimelineSmsInput[] = [{
    id: "m1", at: "2026-06-20T10:00:00+00:00", direction: "inbound",
    body: "I'll pay friday", status: null, errorCode: null,
  }];
  const [e] = buildTimeline([], sms);
  expect(e.kind).toBe("sms");
  if (e.kind === "sms") {
    expect(e.outcome).toBe("customer-replied");
    expect(e.outcomeLabel).toBe("Customer replied");
  }
});

test("buildTimeline merges logs + sms newest-first by timestamp", () => {
  const logs: TimelineLogInput[] = [
    { id: "l-old", at: "2026-06-18T09:00:00+00:00", method: "call", outcome: "no-answer", notes: null, followUpAt: null, promisedAmount: null, promisedDate: null },
    { id: "l-new", at: "2026-06-22T09:00:00+00:00", method: "note", outcome: "other", notes: null, followUpAt: null, promisedAmount: null, promisedDate: null },
  ];
  const sms: TimelineSmsInput[] = [
    { id: "m-mid", at: "2026-06-20T12:00:00+00:00", direction: "outbound", body: "reminder", status: "delivered", errorCode: null },
  ];
  const ids = buildTimeline(logs, sms).map((e) => e.id);
  expect(ids).toEqual(["l-new", "m-mid", "l-old"]);
});

test("buildTimeline is stable for equal timestamps (logs before sms)", () => {
  const at = "2026-06-20T10:00:00+00:00";
  const logs: TimelineLogInput[] = [{ id: "l1", at, method: "call", outcome: "no-answer", notes: null, followUpAt: null, promisedAmount: null, promisedDate: null }];
  const sms: TimelineSmsInput[] = [{ id: "m1", at, direction: "outbound", body: "hi", status: "sent", errorCode: null }];
  expect(buildTimeline(logs, sms).map((e) => e.id)).toEqual(["l1", "m1"]);
});
