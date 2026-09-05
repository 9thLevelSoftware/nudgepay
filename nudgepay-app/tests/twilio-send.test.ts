import { beforeAll, expect, test, vi } from "vitest";
import { serviceClient, makeUserClient } from "./helpers";
import { resolveSender, sendInvoiceText, normalizePhone, type MessagingDeps } from "../app/lib/twilio-messaging.server";
import { ensureStopLanguage } from "../app/lib/sms-keywords";
import { SMS_CUSTOMER_DAY_CAP, SMS_ORG_HOUR_CAP } from "../app/lib/send-limits";

let userId: string;
let userClient: Awaited<ReturnType<typeof makeUserClient>>["client"];
beforeAll(async () => {
  ({ userId, client: userClient } = await makeUserClient("sms-sender@example.com"));
});

const svc = serviceClient();
const twilio = { accountSid: "AC1", authToken: "tok" };

async function seed(consent: boolean, phone: string | null) {
  const { data: org } = await svc.from("organizations").insert({ name: "SMS Org" }).select("id").single();
  const orgId = org!.id as string;
  await svc.from("memberships").insert({ org_id: orgId, user_id: userId, role: "owner" });
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

test("resolveSender ignores tenant-managed messaging_config and uses env default", async () => {
  const { orgId } = await seed(true, "+12295550101");
  expect(await resolveSender(svc, orgId, { from: "+1999" })).toEqual({ from: "+1999" });
  await svc.from("messaging_config").insert({ org_id: orgId, messaging_service_sid: "MG7" });
  expect(await resolveSender(svc, orgId, { from: "+1999" })).toEqual({ from: "+1999" });
});

test("resolveSender prefers active inventory SID over from_number, messaging_config, and env default", async () => {
  const { orgId } = await seed(true, "+12295550301");
  await svc.from("messaging_config").insert({
    org_id: orgId, messaging_service_sid: "MGstale00301", sender: "+15550000000",
  });
  const { error } = await svc.from("sms_sender_inventory").insert({
    org_id: orgId,
    messaging_service_sid: "MGinv" + "0".repeat(27),
    from_number: "+15551230001",
    status: "active",
  });
  expect(error).toBeNull();
  expect(await resolveSender(svc, orgId, { from: "+1999" })).toEqual({
    messagingServiceSid: "MGinv" + "0".repeat(27),
  });
});

test("resolveSender uses inventory from_number when no SID is provisioned", async () => {
  const { orgId } = await seed(true, "+12295550302");
  const { error } = await svc.from("sms_sender_inventory").insert({
    org_id: orgId,
    from_number: "+15551230002",
    status: "active",
  });
  expect(error).toBeNull();
  expect(await resolveSender(svc, orgId, { from: "+1999" })).toEqual({ from: "+15551230002" });
});

test("resolveSender throws when requireInventory and no active inventory", async () => {
  const { orgId } = await seed(true, "+12295550303");
  await expect(resolveSender(svc, orgId, { from: "+1999" }, { requireInventory: true }))
    .rejects.toThrow(/SMS sender not provisioned/);
});

test("sendInvoiceText requireInventory refuses without inventory (no Twilio call)", async () => {
  const { orgId, invoiceId, customerId } = await seed(true, "+12295550304");
  const fetchFn = vi.fn();
  await expect(sendInvoiceText(
    { ...deps(fetchFn), requireInventory: true },
    { orgId, invoiceId, userId, body: "x" },
  )).rejects.toThrow(/SMS sender not provisioned/);
  expect(fetchFn).not.toHaveBeenCalled();
  const { data: rows } = await svc.from("text_messages").select("id").eq("customer_id", customerId);
  expect(rows ?? []).toHaveLength(0);
});

test("sendInvoiceText refuses when the customer day cap is already full", async () => {
  const { orgId, invoiceId, customerId } = await seed(true, "+12295550908");
  const rows = Array.from({ length: SMS_CUSTOMER_DAY_CAP }, (_, i) => ({
    org_id: orgId,
    invoice_id: invoiceId,
    customer_id: customerId,
    direction: "outbound",
    to_number: "+12295550908",
    body: `prior ${i}`,
    status: "sent",
  }));
  const { error } = await svc.from("text_messages").insert(rows);
  expect(error).toBeNull();
  const fetchFn = vi.fn();
  await expect(sendInvoiceText(deps(fetchFn), { orgId, invoiceId, userId, body: "Past due" }))
    .rejects.toThrow(/rate cap/i);
  expect(fetchFn).not.toHaveBeenCalled();
});

test("sendInvoiceText still sends when prior customer texts are older than 24h", async () => {
  const { orgId, invoiceId, customerId } = await seed(true, "+12295550925");
  const stale = new Date(DAYTIME_NOW.getTime() - 25 * 60 * 60 * 1000).toISOString();
  const rows = Array.from({ length: SMS_CUSTOMER_DAY_CAP }, (_, i) => ({
    org_id: orgId,
    invoice_id: invoiceId,
    customer_id: customerId,
    direction: "outbound",
    to_number: "+12295550925",
    body: `stale ${i}`,
    status: "sent",
    created_at: stale,
  }));
  const { error } = await svc.from("text_messages").insert(rows);
  expect(error).toBeNull();
  const sid = `SM-stale-${Math.random().toString(16).slice(2)}`;
  const fetchFn = vi.fn(async () => jsonResponse({ sid, status: "queued" }));
  const res = await sendInvoiceText(deps(fetchFn), { orgId, invoiceId, userId, body: "Past due" });
  expect(res.sid).toBe(sid);
  expect(fetchFn).toHaveBeenCalledOnce();
});

test("sendInvoiceText refuses when the workspace hour cap is already full", async () => {
  const { orgId, invoiceId } = await seed(true, "+12295550920");
  const { data: other } = await svc.from("customers")
    .insert({ org_id: orgId, qbo_id: "c-hour", name: "Other", phone: "+12295550921", sms_consent: true })
    .select("id").single();
  const { data: otherInv } = await svc.from("invoices")
    .insert({ org_id: orgId, qbo_id: "i-hour", qbo_doc_number: "2099", customer_id: other!.id, balance: 50 })
    .select("id").single();
  const rows = Array.from({ length: SMS_ORG_HOUR_CAP }, (_, i) => ({
    org_id: orgId,
    invoice_id: otherInv!.id,
    customer_id: other!.id,
    direction: "outbound",
    to_number: "+12295550921",
    body: `prior ${i}`,
    status: "sent",
  }));
  const { error } = await svc.from("text_messages").insert(rows);
  expect(error).toBeNull();
  const fetchFn = vi.fn();
  await expect(sendInvoiceText(deps(fetchFn), { orgId, invoiceId, userId, body: "Past due" }))
    .rejects.toThrow(/workspace/i);
  expect(fetchFn).not.toHaveBeenCalled();
});

test("sendInvoiceText still sends when workspace-hour texts are older than 1h", async () => {
  const { orgId, invoiceId } = await seed(true, "+12295550922");
  const { data: other } = await svc.from("customers")
    .insert({ org_id: orgId, qbo_id: "c-stale-hour", name: "Other", phone: "+12295550923", sms_consent: true })
    .select("id").single();
  const { data: otherInv } = await svc.from("invoices")
    .insert({ org_id: orgId, qbo_id: "i-stale-hour", qbo_doc_number: "2100", customer_id: other!.id, balance: 50 })
    .select("id").single();
  const stale = new Date(DAYTIME_NOW.getTime() - 65 * 60_000).toISOString();
  const rows = Array.from({ length: SMS_ORG_HOUR_CAP }, (_, i) => ({
    org_id: orgId,
    invoice_id: otherInv!.id,
    customer_id: other!.id,
    direction: "outbound",
    to_number: "+12295550923",
    body: `stale ${i}`,
    status: "sent",
    created_at: stale,
  }));
  const { error } = await svc.from("text_messages").insert(rows);
  expect(error).toBeNull();
  const sid = `SM-hour-stale-${Math.random().toString(16).slice(2)}`;
  const fetchFn = vi.fn(async () => jsonResponse({ sid, status: "queued" }));
  const res = await sendInvoiceText(deps(fetchFn), { orgId, invoiceId, userId, body: "Past due" });
  expect(res.sid).toBe(sid);
  expect(fetchFn).toHaveBeenCalledOnce();
});

test("sendInvoiceText releases its reservation when Twilio rejects with 400", async () => {
  const { orgId, invoiceId, customerId } = await seed(true, "+12295550903");
  const fetchFn = vi.fn(async () => jsonResponse({ message: "invalid" }, 400));
  await expect(sendInvoiceText(deps(fetchFn), { orgId, invoiceId, userId, body: "Past due" }))
    .rejects.toThrow("Twilio send failed: 400");
  const { data: rows } = await svc.from("text_messages").select("id").eq("customer_id", customerId);
  expect(rows ?? []).toHaveLength(0);
});

test("membership removal before reservation denies the SMS provider call", async () => {
  const { orgId, invoiceId, customerId } = await seed(true, "+12295550305");
  const backup = await makeUserClient(`sms-backup-${crypto.randomUUID()}@example.com`);
  await svc.from("memberships").insert({ org_id: orgId, user_id: backup.userId, role: "owner" });
  const { error: removeError } = await svc.from("memberships")
    .delete().eq("org_id", orgId).eq("user_id", userId);
  expect(removeError).toBeNull();
  const fetchFn = vi.fn();
  await expect(sendInvoiceText(deps(fetchFn), {
    orgId, invoiceId, userId, body: "x",
  })).rejects.toMatchObject({ code: "42501" });
  expect(fetchFn).not.toHaveBeenCalled();
  const { data: rows } = await svc.from("text_messages").select("id").eq("customer_id", customerId);
  expect(rows ?? []).toHaveLength(0);
});

test("authenticated owners cannot mutate outbound SMS provider-attempt fields", async () => {
  const { orgId, invoiceId } = await seed(true, "+12295550306");
  const fetchFn = vi.fn(async () => jsonResponse({ sid: "SM-IMMUTABLE", status: "queued" }));
  const sent = await sendInvoiceText(deps(fetchFn), { orgId, invoiceId, userId, body: "Original" });
  const { error } = await userClient.from("text_messages").update({
    body: "tampered",
    customer_id: null,
    send_dedupe_key: "cleared",
    created_at: "2000-01-01T00:00:00.000Z",
  }).eq("id", sent.id);
  expect(error?.code).toBe("42501");
});

test("a Twilio 503 is durable and blocks a blind retry", async () => {
  const { orgId, invoiceId, customerId } = await seed(true, "+12295550907");
  const firstFetch = vi.fn(async () => jsonResponse({ message: "unavailable" }, 503));
  const args = { orgId, invoiceId, userId, body: "Provider 500 reminder" };
  await expect(sendInvoiceText(deps(firstFetch), args)).rejects.toThrow(/status is unknown/i);
  const { data: rows } = await svc.from("text_messages")
    .select("status, error_code").eq("customer_id", customerId);
  expect(rows).toEqual([{ status: "unknown", error_code: "transport_ambiguous" }]);

  const retryFetch = vi.fn();
  await expect(sendInvoiceText(deps(retryFetch), args)).rejects.toThrow(/status is unknown/i);
  expect(retryFetch).not.toHaveBeenCalled();
});

test("an ambiguous SMS transport failure is durable and blocks a blind retry", async () => {
  const { orgId, invoiceId, customerId } = await seed(true, "+12295550904");
  const firstFetch = vi.fn(async () => {
    throw new TypeError("connection closed after request write");
  });
  await expect(sendInvoiceText(
    deps(firstFetch),
    { orgId, invoiceId, userId, body: "Ambiguous reminder" },
  )).rejects.toThrow(/status is unknown/i);

  const { data: attempts } = await svc.from("text_messages")
    .select("status")
    .eq("customer_id", customerId);
  expect(attempts).toEqual([{ status: "unknown" }]);

  const retryFetch = vi.fn();
  await expect(sendInvoiceText(
    { ...deps(retryFetch), statusCallback: "https://new.example/webhooks/twilio/status" },
    { orgId, invoiceId, userId, body: "Ambiguous reminder" },
  )).rejects.toThrow(/status is unknown/i);
  expect(retryFetch).not.toHaveBeenCalled();
});

test("concurrent duplicate SMS actions reserve one provider send", async () => {
  const { orgId, invoiceId, customerId } = await seed(true, "+12295550906");
  const fetchFn = vi.fn(async () => {
    await new Promise((resolve) => setTimeout(resolve, 25));
    return jsonResponse({ sid: "SM-CONCURRENT", status: "queued" });
  });
  const args = { orgId, invoiceId, userId, body: "Concurrent reminder" };
  const outcomes = await Promise.allSettled([
    sendInvoiceText(deps(fetchFn), args),
    sendInvoiceText(deps(fetchFn), args),
  ]);

  expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
  expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
  expect(fetchFn).toHaveBeenCalledOnce();
  const { data: rows } = await svc.from("text_messages")
    .select("status, twilio_message_sid").eq("customer_id", customerId);
  expect(rows).toEqual([{ status: "queued", twilio_message_sid: "SM-CONCURRENT" }]);
});

test("a successful SMS can be intentionally sent again on the next UTC day", async () => {
  const { orgId, invoiceId } = await seed(true, "+12295550905");
  const fetchFn = vi
    .fn()
    .mockResolvedValueOnce(jsonResponse({ sid: "SM-DAY-ONE", status: "queued" }))
    .mockResolvedValueOnce(jsonResponse({ sid: "SM-DAY-TWO", status: "queued" }));

  await sendInvoiceText(
    { ...deps(fetchFn), now: new Date("2026-06-15T18:00:00Z") },
    { orgId, invoiceId, userId, body: "Daily reminder" },
  );
  await sendInvoiceText(
    { ...deps(fetchFn), now: new Date("2026-06-16T18:00:00Z") },
    { orgId, invoiceId, userId, body: "Daily reminder" },
  );

  expect(fetchFn).toHaveBeenCalledTimes(2);
});

test("a corrected SMS destination is a distinct same-day provider request", async () => {
  const { orgId, invoiceId, customerId } = await seed(true, "+12295550910");
  const fetchFn = vi
    .fn()
    .mockResolvedValueOnce(jsonResponse({ sid: "SM-OLD-DEST", status: "queued" }))
    .mockResolvedValueOnce(jsonResponse({ sid: "SM-NEW-DEST", status: "queued" }));
  const args = { orgId, invoiceId, userId, body: "Destination correction" };
  await sendInvoiceText(deps(fetchFn), args);
  await svc.from("customers").update({ phone: "+12295550911" }).eq("id", customerId);
  await sendInvoiceText(deps(fetchFn), args);
  expect(fetchFn).toHaveBeenCalledTimes(2);
});

test("a known failed SMS can be explicitly retried with a new provider key", async () => {
  const { orgId, invoiceId } = await seed(true, "+12295550912");
  const fetchFn = vi
    .fn()
    .mockResolvedValueOnce(jsonResponse({ sid: "SM-FAILED", status: "queued" }))
    .mockResolvedValueOnce(jsonResponse({ sid: "SM-RETRY", status: "queued" }));
  const args = { orgId, invoiceId, userId, body: "Retryable reminder" };
  const first = await sendInvoiceText(deps(fetchFn), args);
  await svc.from("text_messages").update({ status: "failed", error_code: "30007" }).eq("id", first.id);
  const second = await sendInvoiceText(deps(fetchFn), args);

  expect(second.sid).toBe("SM-RETRY");
  expect(fetchFn).toHaveBeenCalledTimes(2);
  const firstKey = (fetchFn.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
  const retryKey = (fetchFn.mock.calls[1][1] as RequestInit).headers as Record<string, string>;
  expect(retryKey["Idempotency-Key"]).not.toBe(firstKey["Idempotency-Key"]);
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
  expect(msg!.body).toBe(ensureStopLanguage("Past due"));
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
