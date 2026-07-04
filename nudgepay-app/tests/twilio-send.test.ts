import { beforeAll, expect, test, vi } from "vitest";
import { serviceClient, makeUserClient } from "./helpers";
import { resolveSender, sendInvoiceText, normalizePhone, type MessagingDeps } from "../app/lib/twilio-messaging.server";

let userId: string;
beforeAll(async () => { ({ userId } = await makeUserClient("sms-sender@example.com")); });

const svc = serviceClient();
const twilio = { accountSid: "AC1", authToken: "tok" };

async function seed(consent: boolean, phone: string | null) {
  const { data: org } = await svc.from("organizations").insert({ name: "SMS Org" }).select("id").single();
  const orgId = org!.id as string;
  const { data: cust } = await svc.from("customers")
    .insert({ org_id: orgId, qbo_id: "c1", name: "Acme", phone, sms_consent: consent }).select("id").single();
  const { data: inv } = await svc.from("invoices")
    .insert({ org_id: orgId, qbo_id: "i1", qbo_doc_number: "1042", customer_id: cust!.id, balance: 100 }).select("id").single();
  return { orgId, customerId: cust!.id as string, invoiceId: inv!.id as string };
}

function jsonResponse(body: unknown, status = 201) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
// Fixed "now" well inside the default quiet-hours window (8-21, America/New
// York — DEFAULT_QUIET_HOURS via the default org_settings row) so tests are
// deterministic regardless of wall-clock time. 18:00 UTC = 14:00 EDT in June.
const DAYTIME_NOW = new Date("2026-06-15T18:00:00Z");
function deps(fetchFn: any, defaultSender: any = { from: "+15005550006" }): MessagingDeps {
  return { fetchFn, service: svc, twilio, defaultSender, statusCallback: null, now: DAYTIME_NOW };
}

test("normalizePhone reduces to the last 10 digits", () => {
  expect(normalizePhone("+1 (229) 555-0101")).toBe("2295550101");
  expect(normalizePhone(null)).toBe("");
});

test("resolveSender ignores tenant-managed overrides and uses env default", async () => {
  const { orgId } = await seed(true, "+12295550101");
  expect(await resolveSender(svc, orgId, { from: "+1999" })).toEqual({ from: "+1999" });
  await svc.from("messaging_config").insert({ org_id: orgId, messaging_service_sid: "MG7" });
  expect(await resolveSender(svc, orgId, { from: "+1999" })).toEqual({ from: "+1999" });
});

test("sendInvoiceText sends and inserts an outbound row when the customer consented", async () => {
  const { orgId, customerId, invoiceId } = await seed(true, "+12295550101");
  const fetchFn = vi.fn(async () => jsonResponse({ sid: "SM10", status: "queued" }));
  const res = await sendInvoiceText(deps(fetchFn), { orgId, invoiceId, userId, body: "Past due" });
  expect(res.sid).toBe("SM10");
  expect(fetchFn).toHaveBeenCalledOnce();
  const { data: msg } = await svc.from("text_messages").select("direction, twilio_message_sid, to_number, customer_id, invoice_id, body")
    .eq("twilio_message_sid", "SM10").single();
  expect(msg!.direction).toBe("outbound");
  expect(msg!.to_number).toBe("+12295550101");
  expect(msg!.customer_id).toBe(customerId);
  expect(msg!.invoice_id).toBe(invoiceId);
  expect(msg!.body).toBe("Past due");
});

test("sendInvoiceText refuses to send without consent (no Twilio call, no row)", async () => {
  const { orgId, invoiceId } = await seed(false, "+12295550101");
  const fetchFn = vi.fn();
  await expect(sendInvoiceText(deps(fetchFn), { orgId, invoiceId, userId, body: "x" }))
    .rejects.toThrow(/consent/i);
  expect(fetchFn).not.toHaveBeenCalled();
});

test("sendInvoiceText refuses when the customer has no phone", async () => {
  const { orgId, invoiceId } = await seed(true, null);
  const fetchFn = vi.fn();
  await expect(sendInvoiceText(deps(fetchFn), { orgId, invoiceId, userId, body: "x" }))
    .rejects.toThrow(/phone/i);
  expect(fetchFn).not.toHaveBeenCalled();
});

test("sendInvoiceText stamps case_id from the customer's active case", async () => {
  const { orgId, customerId, invoiceId } = await seed(true, "+12295550111");
  const { data: cse } = await svc.from("collection_cases")
    .insert({ org_id: orgId, customer_id: customerId, status: "working" }).select("id").single();
  const fetchFn = vi.fn(async () => jsonResponse({ sid: "SM-CASE", status: "queued" }));
  await sendInvoiceText(deps(fetchFn), { orgId, invoiceId, userId, body: "Past due" });
  const { data: msg } = await svc.from("text_messages").select("case_id").eq("twilio_message_sid", "SM-CASE").single();
  expect(msg!.case_id).toBe(cse!.id);
});

test("sendInvoiceText leaves case_id null when the customer has no open case", async () => {
  const { orgId, invoiceId } = await seed(true, "+12295550112");
  const fetchFn = vi.fn(async () => jsonResponse({ sid: "SM-NOCASE", status: "queued" }));
  await sendInvoiceText(deps(fetchFn), { orgId, invoiceId, userId, body: "Past due" });
  const { data: msg } = await svc.from("text_messages").select("case_id").eq("twilio_message_sid", "SM-NOCASE").single();
  expect(msg!.case_id).toBe(null);
});

test("sendInvoiceText refuses a do_not_contact case (no Twilio call, no row)", async () => {
  const { orgId, customerId, invoiceId } = await seed(true, "+12295550133");
  await svc.from("collection_cases").insert({
    org_id: orgId, customer_id: customerId, status: "on_hold",
    next_action_type: "exception", exception_reason: "do_not_contact",
  });
  const fetchFn = vi.fn();
  await expect(sendInvoiceText(deps(fetchFn), { orgId, invoiceId, userId, body: "x" }))
    .rejects.toThrow(/blocked/i);
  expect(fetchFn).not.toHaveBeenCalled();
  const { data: rows } = await svc.from("text_messages").select("id").eq("customer_id", customerId);
  expect(rows ?? []).toHaveLength(0);
});

test("sendInvoiceText refuses a do_not_text customer (no Twilio call, no row)", async () => {
  const { orgId, customerId, invoiceId } = await seed(true, "+12295550144");
  await svc.from("customers").update({ do_not_text: true }).eq("id", customerId);
  const fetchFn = vi.fn();
  await expect(sendInvoiceText(deps(fetchFn), { orgId, invoiceId, userId, body: "x" }))
    .rejects.toThrow(/opted out/i);
  expect(fetchFn).not.toHaveBeenCalled();
  const { data: rows } = await svc.from("text_messages").select("id").eq("customer_id", customerId);
  expect(rows ?? []).toHaveLength(0);
});

test("contact-block takes precedence over do_not_text in the block reason", async () => {
  // A customer who is BOTH do_not_text AND on a legal/do-not-contact case must
  // surface the case-level legal hold, not the per-customer opt-out — mirroring
  // resolveCallAction's call-path precedence. Both still block; the reason differs.
  const { orgId, customerId, invoiceId } = await seed(true, "+12295550155");
  await svc.from("customers").update({ do_not_text: true }).eq("id", customerId);
  await svc.from("collection_cases").insert({
    org_id: orgId, customer_id: customerId, status: "on_hold",
    next_action_type: "exception", exception_reason: "legal_agency",
  });
  const fetchFn = vi.fn();
  await expect(sendInvoiceText(deps(fetchFn), { orgId, invoiceId, userId, body: "x" }))
    .rejects.toThrow(/blocked/i);
  expect(fetchFn).not.toHaveBeenCalled();
  const { data: rows } = await svc.from("text_messages").select("id").eq("customer_id", customerId);
  expect(rows ?? []).toHaveLength(0);
});

test("sendInvoiceText still sends for a non-blocking exception (disputed)", async () => {
  const { orgId, customerId, invoiceId } = await seed(true, "+12295550134");
  await svc.from("collection_cases").insert({
    org_id: orgId, customer_id: customerId, status: "on_hold",
    next_action_type: "exception", next_action_at: "2026-09-01", exception_reason: "disputed",
  });
  const fetchFn = vi.fn(async () => jsonResponse({ sid: "SM-DISP", status: "queued" }));
  const res = await sendInvoiceText(deps(fetchFn), { orgId, invoiceId, userId, body: "Past due" });
  expect(res.sid).toBe("SM-DISP");
  expect(fetchFn).toHaveBeenCalledOnce();
});

test("sendInvoiceText refuses when the org has SMS disabled (no Twilio call, no row)", async () => {
  const { orgId, customerId, invoiceId } = await seed(true, "+12295550166");
  await svc.from("messaging_config").insert({ org_id: orgId, sms_enabled: false });
  const fetchFn = vi.fn();
  await expect(sendInvoiceText(deps(fetchFn), { orgId, invoiceId, userId, body: "x" }))
    .rejects.toThrow(/disabled/i);
  expect(fetchFn).not.toHaveBeenCalled();
  const { data: rows } = await svc.from("text_messages").select("id").eq("customer_id", customerId);
  expect(rows ?? []).toHaveLength(0);
});

test("sendInvoiceText sends when sms_enabled is true", async () => {
  const { orgId, invoiceId } = await seed(true, "+12295550177");
  await svc.from("messaging_config").insert({ org_id: orgId, sms_enabled: true });
  const fetchFn = vi.fn(async () => jsonResponse({ sid: "SM-ON", status: "queued" }));
  const res = await sendInvoiceText(deps(fetchFn), { orgId, invoiceId, userId, body: "ok" });
  expect(res.sid).toBe("SM-ON");
  expect(fetchFn).toHaveBeenCalledOnce();
});

// ---------------------------------------------------------------------------
// Quiet hours (Phase 7)
// ---------------------------------------------------------------------------

test("sendInvoiceText blocks a send outside the default quiet-hours window (absent org_settings row)", async () => {
  const { orgId, customerId, invoiceId } = await seed(true, "+12295550188");
  // 2026-06-15T04:00:00Z = midnight America/New_York (EDT, UTC-4) — outside
  // the default 8-21 window. No org_settings row exists, so this exercises
  // the absent-row default (America/New_York, 8-21) end to end.
  const outsideNow = new Date("2026-06-15T04:00:00Z");
  const fetchFn = vi.fn();
  await expect(sendInvoiceText({ ...deps(fetchFn), now: outsideNow }, { orgId, invoiceId, userId, body: "x" }))
    .rejects.toThrow(/quiet hours/i);
  expect(fetchFn).not.toHaveBeenCalled();
  const { data: rows } = await svc.from("text_messages").select("id").eq("customer_id", customerId);
  expect(rows ?? []).toHaveLength(0);
});

test("sendInvoiceText allows a send inside the default quiet-hours window (absent org_settings row)", async () => {
  const { orgId, invoiceId } = await seed(true, "+12295550199");
  // 2026-06-15T18:00:00Z = 14:00 EDT — inside the default 8-21 window.
  const insideNow = new Date("2026-06-15T18:00:00Z");
  const fetchFn = vi.fn(async () => jsonResponse({ sid: "SM-QUIET-OK", status: "queued" }));
  const res = await sendInvoiceText({ ...deps(fetchFn), now: insideNow }, { orgId, invoiceId, userId, body: "ok" });
  expect(res.sid).toBe("SM-QUIET-OK");
  expect(fetchFn).toHaveBeenCalledOnce();
});

test("sendInvoiceText respects an org-configured quiet-hours window (narrower than the default)", async () => {
  const { orgId, customerId, invoiceId } = await seed(true, "+12295550200");
  await svc.from("org_settings").insert({
    org_id: orgId, timezone: "America/New_York", sms_send_start_hour: 9, sms_send_end_hour: 17,
  });
  // 20:00 EDT is inside the org's DEFAULT 8-21 window but outside its
  // configured 9-17 window — proves the org override is actually read.
  const eveningNow = new Date("2026-06-16T00:00:00Z"); // 20:00 EDT
  const fetchFn = vi.fn();
  await expect(sendInvoiceText({ ...deps(fetchFn), now: eveningNow }, { orgId, invoiceId, userId, body: "x" }))
    .rejects.toThrow(/quiet hours/i);
  expect(fetchFn).not.toHaveBeenCalled();
  const { data: rows } = await svc.from("text_messages").select("id").eq("customer_id", customerId);
  expect(rows ?? []).toHaveLength(0);

  // 10:00 EDT is inside the configured 9-17 window.
  const morningNow = new Date("2026-06-15T14:00:00Z"); // 10:00 EDT
  const fetchFn2 = vi.fn(async () => jsonResponse({ sid: "SM-CONFIGURED-OK", status: "queued" }));
  const res = await sendInvoiceText({ ...deps(fetchFn2), now: morningNow }, { orgId, invoiceId, userId, body: "ok" });
  expect(res.sid).toBe("SM-CONFIGURED-OK");
});

test("sendInvoiceText uses a pre-fetched quietHoursWindow instead of re-reading org_settings", async () => {
  const { orgId, invoiceId } = await seed(true, "+12295550211");
  // A configured window that would BLOCK if org_settings were (mistakenly) re-read,
  // proves the pre-fetched window on deps is what's actually consulted.
  await svc.from("org_settings").insert({
    org_id: orgId, timezone: "America/New_York", sms_send_start_hour: 9, sms_send_end_hour: 17,
  });
  const eveningNow = new Date("2026-06-16T00:00:00Z"); // 20:00 EDT — outside 9-17, inside a wider pre-fetched window
  const fetchFn = vi.fn(async () => jsonResponse({ sid: "SM-PREFETCH-OK", status: "queued" }));
  const res = await sendInvoiceText(
    { ...deps(fetchFn), now: eveningNow, quietHoursWindow: { timezone: "America/New_York", startHour: 0, endHour: 24 } },
    { orgId, invoiceId, userId, body: "ok" },
  );
  expect(res.sid).toBe("SM-PREFETCH-OK");
});
