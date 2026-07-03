import { expect, test } from "vitest";
import { smsGateFor } from "../app/lib/sms-gate";

const BASE = {
  smsEnabled: true,
  contactBlocked: false,
  exceptionReason: null as any,
  doNotText: false,
  hasInvoice: true,
  consent: true,
  phone: "+15551234567" as string | null,
};

test("all gates pass → null (sendable)", () => {
  expect(smsGateFor(BASE)).toBeNull();
});

test("sms disabled → hard gate", () => {
  const g = smsGateFor({ ...BASE, smsEnabled: false });
  expect(g?.severity).toBe("hard");
  expect(g?.reason).toContain("turned off");
});

test("contact blocked → hard gate", () => {
  const g = smsGateFor({ ...BASE, contactBlocked: true, exceptionReason: "do_not_contact" });
  expect(g?.severity).toBe("hard");
  expect(g?.reason).toContain("blocked");
});

test("doNotText → hard gate (before consent check)", () => {
  const g = smsGateFor({ ...BASE, doNotText: true, consent: false });
  expect(g?.severity).toBe("hard");
  expect(g?.reason).toContain("opted out");
});

test("no invoice → soft gate", () => {
  const g = smsGateFor({ ...BASE, hasInvoice: false });
  expect(g?.severity).toBe("soft");
  expect(g?.reason).toContain("invoice");
});

test("no consent → soft gate", () => {
  const g = smsGateFor({ ...BASE, consent: false });
  expect(g?.severity).toBe("soft");
  expect(g?.reason).toContain("consent");
});

test("no phone → soft gate", () => {
  const g = smsGateFor({ ...BASE, phone: null });
  expect(g?.severity).toBe("soft");
  expect(g?.reason).toContain("phone");
});

test("priority order: disabled before blocked", () => {
  const g = smsGateFor({ ...BASE, smsEnabled: false, contactBlocked: true });
  expect(g?.reason).toContain("turned off");
});

test("priority order: blocked before doNotText", () => {
  const g = smsGateFor({ ...BASE, contactBlocked: true, doNotText: true, exceptionReason: "legal_agency" });
  expect(g?.reason).toContain("blocked");
});

test("priority order: doNotText before consent", () => {
  const g = smsGateFor({ ...BASE, doNotText: true, consent: false });
  expect(g?.reason).toContain("opted out");
});
