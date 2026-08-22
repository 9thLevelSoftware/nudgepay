import { expect, test } from "vitest";
import { chaseRecipientsFrom } from "../app/lib/chase-recipients";
import { DEFAULT_COMM_PREFS } from "../app/lib/comm-prefs";
import { smsGateFor } from "../app/lib/sms-gate";

const BASE = {
  phone: "+15551234567" as string | null,
  email: "ap@acme.test" as string | null,
  commPrefs: DEFAULT_COMM_PREFS,
  smsConsent: true,
  contactBlocked: false,
  exceptionReason: null,
  smsEnabled: true,
  hasInvoice: true,
};

test("empty address omits the row", () => {
  expect(chaseRecipientsFrom({ ...BASE, phone: null, email: null })).toEqual([]);
  expect(chaseRecipientsFrom({ ...BASE, phone: "", email: "" }).map((r) => r.channel)).toEqual([]);
  const smsOnly = chaseRecipientsFrom({ ...BASE, email: null });
  expect(smsOnly.map((r) => r.channel)).toEqual(["sms", "call"]);
  const emailOnly = chaseRecipientsFrom({ ...BASE, phone: null });
  expect(emailOnly.map((r) => r.channel)).toEqual(["email"]);
});

test("sms enabled matches smsGateFor returning null", () => {
  const gate = smsGateFor({
    smsEnabled: true,
    contactBlocked: false,
    exceptionReason: null,
    doNotText: false,
    hasInvoice: true,
    consent: true,
    phone: BASE.phone,
  });
  expect(gate).toBeNull();
  const [sms] = chaseRecipientsFrom(BASE);
  expect(sms.channel).toBe("sms");
  expect(sms.enabled).toBe(gate == null);
  expect(sms.reasonDisabled).toBeNull();
});

test("sms disabled reason comes from smsGateFor", () => {
  const rows = chaseRecipientsFrom({ ...BASE, smsConsent: false });
  const sms = rows.find((r) => r.channel === "sms")!;
  expect(sms.enabled).toBe(false);
  expect(sms.reasonDisabled).toContain("consent");
});

test("email blocked by contact-block vs opt-out", () => {
  const blocked = chaseRecipientsFrom({ ...BASE, contactBlocked: true });
  expect(blocked.find((r) => r.channel === "email")).toEqual({
    channel: "email",
    address: "ap@acme.test",
    enabled: false,
    reasonDisabled: "Case is marked do-not-contact / legal",
  });
  const opted = chaseRecipientsFrom({
    ...BASE,
    commPrefs: { ...DEFAULT_COMM_PREFS, doNotEmail: true },
  });
  expect(opted.find((r) => r.channel === "email")).toEqual({
    channel: "email",
    address: "ap@acme.test",
    enabled: false,
    reasonDisabled: "Customer opted out of email",
  });
});

test("call live vs blocked; hidden when no phone", () => {
  const live = chaseRecipientsFrom(BASE).find((r) => r.channel === "call")!;
  expect(live).toEqual({
    channel: "call", address: "+15551234567", enabled: true, reasonDisabled: null,
  });
  const blocked = chaseRecipientsFrom({ ...BASE, contactBlocked: true }).find((r) => r.channel === "call")!;
  expect(blocked.enabled).toBe(false);
  expect(blocked.reasonDisabled).toContain("do-not-contact");
  expect(chaseRecipientsFrom({ ...BASE, phone: null }).some((r) => r.channel === "call")).toBe(false);
});
