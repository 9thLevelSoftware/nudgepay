import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { unmatchedStopsFromQuery, UNMATCHED_STOP_LOAD_ERROR } from "../app/lib/inbound-orphans.server";

function read(rel: string): string {
  return readFileSync(new URL(rel, import.meta.url), "utf8");
}

test("unmatched STOP list error is not a healthy empty", () => {
  expect(unmatchedStopsFromQuery({ data: null, error: { message: "db down" } })).toEqual({
    rows: [],
    loadError: UNMATCHED_STOP_LOAD_ERROR,
  });
  expect(unmatchedStopsFromQuery({ data: [], error: null })).toEqual({ rows: [], loadError: null });
  expect(unmatchedStopsFromQuery({
    data: [{ id: "1", from_number: "+15551212", to_number: "+15550000", created_at: "2026-06-01T00:00:00Z" }],
    error: null,
  }).rows).toHaveLength(1);
  const ui = read("../app/components/UnmatchedStopList.tsx");
  expect(ui).toContain("loadError");
  expect(ui).toContain('role="alert"');
});

test("owner unmatched STOP chrome and shared-sender warning are wired", () => {
  const copy = "STOP received from an unknown number — not applied to a customer.";
  const shared = "All workspaces share this sender. STOP applies to every customer with this phone.";
  expect(read("../app/components/UnmatchedStopList.tsx")).toContain(copy);
  expect(read("../app/routes/messages.tsx")).toContain("listRecentUnmatchedStops");
  expect(read("../app/routes/messages.tsx")).toContain("UnmatchedStopList");
  expect(read("../app/routes/messages.tsx")).toContain(shared);
  expect(read("../app/routes/settings.tsx")).toContain("listRecentUnmatchedStops");
  expect(read("../app/routes/settings.tsx")).toContain("UnmatchedStopList");
  expect(read("../app/components/SmsSettingsSection.tsx")).toContain(shared);
});

test("inbound STOP apply is pinned to the resolved org", () => {
  const src = read("../app/lib/twilio-messaging.server.ts");
  const resolveIdx = src.indexOf("resolveInboundOrgId(service");
  const applyIdx = src.indexOf("applyKeywordByPhone(service");
  expect(resolveIdx).toBeGreaterThan(0);
  expect(applyIdx).toBeGreaterThan(resolveIdx);
  expect(src).toContain('.eq("org_id", orgId)');
  expect(src).toContain("applyKeywordByPhone(service, fromNorm, keyword, orgId)");
});

test("prefs re-read STOP source before clearing do_not_text", () => {
  const src = read("../app/routes/api.comm-prefs.tsx");
  expect(src).toContain("sms_consent_source");
  expect(src).toContain("inbound_stop");
  expect(src).toContain('withSms(returnTo, "consent_locked")');
  expect(src).not.toMatch(/confirm_resubscribe_sms"\) !== "true"/);
});

test("sendInvoiceEmail re-checks allowlist and quiet hours", () => {
  const src = read("../app/lib/email-messaging.server.ts");
  expect(src).toContain("assertFromAddressAllowed");
  expect(src).toContain("isWithinSendWindow");
  expect(src).toContain("Quiet hours:");
});

test("bulk SMS pages overdue invoices and fails truncated totals", () => {
  const src = read("../app/lib/bulk-send.server.ts");
  expect(src).toContain("pageAll");
  expect(src).toContain("totalsTruncated");
});

test("sendIdempotencyKey has no minute bucket", () => {
  const src = read("../app/lib/send-limits.ts");
  expect(src).not.toMatch(/Math\.floor\(now\.getTime\(\) \/ 60_000\)/);
  expect(src).toContain("fnv1a64Hex");
});
