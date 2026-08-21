import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { QBO_FLASH, SMS_FLASH, SYNC_FLASH, smsFlash, smsFlashCopy } from "../app/lib/flash-copy";
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
