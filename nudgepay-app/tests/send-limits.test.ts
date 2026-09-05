import { expect, test } from "vitest";
import {
  evaluateSendBudget, evaluateTestBudget, sendAttemptIdentity, sendIdempotencyKey,
  SMS_ORG_HOUR_CAP, SMS_CUSTOMER_DAY_CAP, TEST_HOUR_CAP,
  EMAIL_ORG_HOUR_CAP, EMAIL_CUSTOMER_DAY_CAP,
} from "../app/lib/send-limits";

test("evaluateSendBudget allows under both caps", () => {
  expect(evaluateSendBudget({
    orgCount: 0, customerCount: 0, orgCap: SMS_ORG_HOUR_CAP, customerCap: SMS_CUSTOMER_DAY_CAP,
  })).toEqual({ ok: true });
});

test("evaluateSendBudget rejects org hourly cap", () => {
  expect(evaluateSendBudget({
    orgCount: SMS_ORG_HOUR_CAP, customerCount: 0,
    orgCap: SMS_ORG_HOUR_CAP, customerCap: SMS_CUSTOMER_DAY_CAP,
  })).toEqual({ ok: false, reason: "org_cap" });
});

test("evaluateSendBudget rejects per-customer daily cap", () => {
  expect(evaluateSendBudget({
    orgCount: 1, customerCount: SMS_CUSTOMER_DAY_CAP,
    orgCap: SMS_ORG_HOUR_CAP, customerCap: SMS_CUSTOMER_DAY_CAP,
  })).toEqual({ ok: false, reason: "customer_cap" });
});

test("evaluateSendBudget applies the same helper to email caps", () => {
  expect(evaluateSendBudget({
    orgCount: EMAIL_ORG_HOUR_CAP - 1, customerCount: EMAIL_CUSTOMER_DAY_CAP - 1,
    orgCap: EMAIL_ORG_HOUR_CAP, customerCap: EMAIL_CUSTOMER_DAY_CAP,
  })).toEqual({ ok: true });
  expect(evaluateSendBudget({
    orgCount: EMAIL_ORG_HOUR_CAP, customerCount: 0,
    orgCap: EMAIL_ORG_HOUR_CAP, customerCap: EMAIL_CUSTOMER_DAY_CAP,
  })).toEqual({ ok: false, reason: "org_cap" });
  expect(evaluateSendBudget({
    orgCount: 0, customerCount: EMAIL_CUSTOMER_DAY_CAP,
    orgCap: EMAIL_ORG_HOUR_CAP, customerCap: EMAIL_CUSTOMER_DAY_CAP,
  })).toEqual({ ok: false, reason: "customer_cap" });
});

test("evaluateSendBudget checks org cap before customer cap", () => {
  expect(evaluateSendBudget({
    orgCount: SMS_ORG_HOUR_CAP, customerCount: SMS_CUSTOMER_DAY_CAP,
    orgCap: SMS_ORG_HOUR_CAP, customerCap: SMS_CUSTOMER_DAY_CAP,
  })).toEqual({ ok: false, reason: "org_cap" });
});

test("evaluateTestBudget rejects at the hourly cap", () => {
  expect(evaluateTestBudget(TEST_HOUR_CAP)).toEqual({ ok: false, reason: "test_cap" });
  expect(evaluateTestBudget(TEST_HOUR_CAP - 1)).toEqual({ ok: true });
});

test("sendIdempotencyKey is stable across minutes and hashes the body", () => {
  const a = sendIdempotencyKey("sms", ["org", "inv", "hello"]);
  const b = sendIdempotencyKey("sms", ["org", "inv", "hello"]);
  const c = sendIdempotencyKey("sms", ["org", "inv", "hello!"]);
  expect(a).toBe(b);
  expect(c).not.toBe(a);
  expect(a.startsWith("sms:org:inv:")).toBe(true);
  expect(a).not.toMatch(/:\d{5,}$/);
  expect(a.length).toBeLessThanOrEqual(128);
});

test("sendAttemptIdentity deduplicates one action day without blocking a next-day reminder", () => {
  const first = sendAttemptIdentity(
    "sms",
    ["org", "inv", "hello"],
    new Date("2027-01-15T08:00:00.000Z"),
  );
  const duplicate = sendAttemptIdentity(
    "sms",
    ["org", "inv", "hello"],
    new Date("2027-01-15T23:59:59.000Z"),
  );
  const nextDay = sendAttemptIdentity(
    "sms",
    ["org", "inv", "hello"],
    new Date("2027-01-16T00:00:00.000Z"),
  );

  expect(duplicate).toEqual(first);
  expect(nextDay.fingerprint).toBe(first.fingerprint);
  expect(nextDay.dedupeKey).not.toBe(first.dedupeKey);
});
