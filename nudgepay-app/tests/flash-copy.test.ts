import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import {
  QBO_FLASH, SMS_FLASH, SYNC_FLASH, smsFlash, smsFlashCopy,
  BULK_ERROR_NAME_CAP, encodeBulkErrorNames, parseBulkErrorNames, bulkSmsFailureSummary,
} from "../app/lib/flash-copy";
import { SMS_SEND_REASON_CODES } from "../app/lib/sms-send-reason";

test("QBO_FLASH covers connect result flags", () => {
  for (const key of ["connected", "disconnected", "confirm", "error", "forbidden", "unconfigured", "sync_error", "unsupported"]) {
    expect(QBO_FLASH[key], key).toBeTruthy();
    expect(QBO_FLASH[key].text.length).toBeGreaterThan(10);
  }
  expect(QBO_FLASH.unsupported.tone).toBe("err");
  expect(QBO_FLASH.unsupported.text).toMatch(/US/);
  expect(QBO_FLASH.unsupported.text).toMatch(/USD/);
});

test("SYNC_FLASH covers refresh result flags", () => {
  for (const key of ["ok", "error"]) {
    expect(SYNC_FLASH[key], key).toBeTruthy();
  }
});

test("every smsSendReason code has human copy", () => {
  for (const code of SMS_SEND_REASON_CODES) {
    const copy = smsFlashCopy(code);
    expect(copy, code).toBeTruthy();
    expect(copy.length, code).toBeGreaterThan(10);
    expect(copy.toLowerCase(), code).not.toBe(code);
    expect(copy, code).not.toBe(`Text failed: ${code}`);
  }
  expect(smsFlashCopy("sent")).toBe("Text sent.");
});

test("unknown SMS result code falls back to generic human copy", () => {
  expect(smsFlashCopy("not-a-real-code")).toBe("Could not send the text.");
  expect(smsFlashCopy("")).toBe("Could not send the text.");
  expect(smsFlash("mystery")?.text).toBe("Could not send the text.");
  expect(smsFlash(null)).toBeNull();
  expect(smsFlash(undefined)).toBeNull();
});

test("SMS_FLASH sent and error entries keep the dashboard banner copy", () => {
  expect(SMS_FLASH.sent.tone).toBe("text-cool");
  expect(SMS_FLASH.error.tone).toBe("text-hot");
  expect(SMS_FLASH.quiet.tone).toBe("text-warm");
  expect(SMS_FLASH.error.text).toBe("Could not send the text.");
  expect(SMS_FLASH.consent_locked.tone).toBe("text-hot");
  expect(SMS_FLASH.consent_locked.text).toMatch(/owner override/i);
});

test("Focus SMS toasts use human copy, not the raw result code", () => {
  const src = readFileSync(new URL("../app/routes/focus.tsx", import.meta.url), "utf8");
  expect(src).toContain("smsFlashCopy");
  expect(src).toContain("addToast(smsFlashCopy(code))");
  expect(src).not.toMatch(/Text failed:\s*\$\{/);
  expect(src).not.toMatch(/addToast\(`[^`]*\$\{code\}[^`]*`\)/);
});

test("dashboard and inbox SMS banners import the shared map", () => {
  for (const rel of ["../app/components/DetailPanel.tsx", "../app/components/MessageThreadPanel.tsx"]) {
    const src = readFileSync(new URL(rel, import.meta.url), "utf8");
    expect(src, rel).toContain("smsFlash");
    expect(src, rel).not.toMatch(/const SMS_BANNER/);
  }
});

test("bulkSmsFailureSummary lists up to N names and the remainder", () => {
  expect(bulkSmsFailureSummary(0, [])).toBeNull();
  expect(bulkSmsFailureSummary(0, ["Acme"])).toBeNull();
  expect(bulkSmsFailureSummary(1, ["Acme"])).toBe("1 failed: Acme");
  expect(bulkSmsFailureSummary(3, ["Acme", "Beta"])).toBe("3 failed: Acme, Beta, +1 more");
  expect(bulkSmsFailureSummary(7, ["A", "B", "C", "D", "E"])).toBe("7 failed: A, B, C, D, E, +2 more");
  expect(bulkSmsFailureSummary(2, [])).toBe("2 failed");
  expect(bulkSmsFailureSummary(2, ["", "  "])).toBe("2 failed");
});

test("encodeBulkErrorNames caps names and strips commas so the query stays split-safe", () => {
  expect(encodeBulkErrorNames([])).toBe("");
  expect(encodeBulkErrorNames(["Acme", "Beta, Inc", "Gamma"])).toBe("Acme,Beta Inc,Gamma");
  const six = ["A", "B", "C", "D", "E", "F"];
  expect(encodeBulkErrorNames(six)).toBe("A,B,C,D,E");
  expect(encodeBulkErrorNames(six).split(",")).toHaveLength(BULK_ERROR_NAME_CAP);
  expect(parseBulkErrorNames(encodeBulkErrorNames(["Acme", "Beta, Inc"]))).toEqual(["Acme", "Beta Inc"]);
  expect(parseBulkErrorNames(null)).toEqual([]);
  expect(parseBulkErrorNames("")).toEqual([]);
});

test("bulk SMS redirect and dashboard flash use the shared name encoder/summary", () => {
  const route = readFileSync(new URL("../app/routes/api.bulk-sms.tsx", import.meta.url), "utf8");
  expect(route).toContain("encodeBulkErrorNames");
  expect(route).toContain("bulkErrors");
  const dash = readFileSync(new URL("../app/routes/dashboard.tsx", import.meta.url), "utf8");
  expect(dash).toContain("bulkSmsFailureSummary");
  expect(dash).toContain("parseBulkErrorNames");
  expect(dash).toContain("bulkErrors");
  const cleanup = readFileSync(new URL("../app/lib/use-flash-cleanup.ts", import.meta.url), "utf8");
  expect(cleanup).toContain("bulkErrors");
});
