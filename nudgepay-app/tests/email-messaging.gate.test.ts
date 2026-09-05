import { beforeAll, expect, test, vi } from "vitest";
import { serviceClient, makeUserClient } from "./helpers";
import { sendInvoiceEmail, type EmailDeps } from "../app/lib/email-messaging.server";
import { EMAIL_CUSTOMER_DAY_CAP, EMAIL_ORG_HOUR_CAP } from "../app/lib/send-limits";

let userId: string;
let userClient: Awaited<ReturnType<typeof makeUserClient>>["client"];
beforeAll(async () => {
  ({ userId, client: userClient } = await makeUserClient("email-sender@example.com"));
});

const svc = serviceClient();

async function seed(email: string | null, doNotEmail = false) {
  const { data: org } = await svc.from("organizations")
    .insert({ name: `Email Org ${Math.random()}` }).select("id").single();
  const orgId = org!.id as string;
  await svc.from("memberships").insert({ org_id: orgId, user_id: userId, role: "owner" });
  const { data: cust } = await svc.from("customers")
    .insert({ org_id: orgId, name: "Acme", email }).select("id").single();
  const customerId = cust!.id as string;
  if (doNotEmail) {
    await svc.from("customers").update({ do_not_email: true }).eq("id", customerId);
  }
  const { data: inv } = await svc.from("invoices")
    .insert({
      org_id: orgId,
      qbo_id: `i-${Math.random()}`,
      qbo_doc_number: "1001",
      customer_id: customerId,
      balance: 100,
    }).select("id").single();
  const invoiceId = inv!.id as string;
  return { orgId, customerId, invoiceId };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function uniqueFrom(): string {
  return `billing-${Math.random().toString(16).slice(2)}@chancey.test`;
}

async function enableEmail(orgId: string, extra?: { from_name?: string; postal_address?: string | null }) {
  const from = uniqueFrom();
  const { error } = await svc.from("email_config").insert({
    org_id: orgId,
    email_enabled: true,
    from_address: from,
    from_name: extra?.from_name ?? null,
    postal_address: extra?.postal_address ?? "1 Main St",
  });
  expect(error).toBeNull();
  return from;
}

const DAYTIME_NOW = new Date("2026-06-15T18:00:00Z");
function deps(fetchFn: any, allowedFrom: string, extra?: Partial<EmailDeps>): EmailDeps {
  return {
    fetchFn,
    service: svc,
    email: { apiKey: "test-key", allowedFrom },
    unsubscribeBaseUrl: "https://app.example.com",
    unsubscribeSecret: "test-secret",
    now: DAYTIME_NOW,
    ...extra,
  };
}

test("throws + no provider call + no row when email disabled (absent config)", async () => {
  const { orgId, customerId, invoiceId } = await seed("customer@example.com");
  const f = vi.fn();
  await expect(sendInvoiceEmail(deps(f, uniqueFrom()), { orgId, invoiceId, userId, subject: "Hi", body: "Pay" }))
    .rejects.toThrow(/disabled/i);
  expect(f).not.toHaveBeenCalled();
  const { data: rows } = await svc.from("email_messages").select("id").eq("customer_id", customerId);
  expect(rows ?? []).toHaveLength(0);
});

test("throws when customer has no email", async () => {
  const { orgId, customerId, invoiceId } = await seed(null);
  const from = await enableEmail(orgId);
  const f = vi.fn();
  await expect(sendInvoiceEmail(deps(f, from), { orgId, invoiceId, userId, subject: "Hi", body: "Pay" }))
    .rejects.toThrow(/email/i);
  expect(f).not.toHaveBeenCalled();
  const { data: rows } = await svc.from("email_messages").select("id").eq("customer_id", customerId);
  expect(rows ?? []).toHaveLength(0);
});

test("throws when do_not_email", async () => {
  const { orgId, customerId, invoiceId } = await seed("dnc@chancey.test", true);
  const from = await enableEmail(orgId);
  const f = vi.fn();
  await expect(sendInvoiceEmail(deps(f, from), { orgId, invoiceId, userId, subject: "Hi", body: "Pay" }))
    .rejects.toThrow(/opted out/i);
  expect(f).not.toHaveBeenCalled();
  const { data: rows } = await svc.from("email_messages").select("id").eq("customer_id", customerId);
  expect(rows ?? []).toHaveLength(0);
});

test("throws when contact-blocked", async () => {
  const { orgId, customerId, invoiceId } = await seed("blocked@chancey.test");
  const from = await enableEmail(orgId);
  await svc.from("collection_cases").insert({
    org_id: orgId,
    customer_id: customerId,
    status: "on_hold",
    next_action_type: "exception",
    exception_reason: "do_not_contact",
  });
  const f = vi.fn();
  await expect(sendInvoiceEmail(deps(f, from), { orgId, invoiceId, userId, subject: "Hi", body: "Pay" }))
    .rejects.toThrow(/blocked/i);
  expect(f).not.toHaveBeenCalled();
  const { data: rows } = await svc.from("email_messages").select("id").eq("customer_id", customerId);
  expect(rows ?? []).toHaveLength(0);
});

test("throws when From allowlist is empty (no provider call)", async () => {
  const { orgId, customerId, invoiceId } = await seed("empty-allow@chancey.test");
  await enableEmail(orgId);
  const f = vi.fn();
  await expect(sendInvoiceEmail(deps(f, "", { email: { apiKey: "test-key", allowedFrom: "" } }), {
    orgId, invoiceId, userId, subject: "Hi", body: "Pay",
  })).rejects.toThrow(/allowlist/i);
  expect(f).not.toHaveBeenCalled();
  const { data: rows } = await svc.from("email_messages").select("id").eq("customer_id", customerId);
  expect(rows ?? []).toHaveLength(0);
});

test("throws when outside quiet hours (no provider call)", async () => {
  const { orgId, customerId, invoiceId } = await seed("quiet@chancey.test");
  const from = await enableEmail(orgId);
  const f = vi.fn();
  await expect(sendInvoiceEmail(deps(f, from, { now: new Date("2026-06-15T04:00:00Z") }), {
    orgId, invoiceId, userId, subject: "Hi", body: "Pay",
  })).rejects.toThrow(/quiet hours/i);
  expect(f).not.toHaveBeenCalled();
  const { data: rows } = await svc.from("email_messages").select("id").eq("customer_id", customerId);
  expect(rows ?? []).toHaveLength(0);
});

test("sendInvoiceEmail refuses when the customer day cap is already full", async () => {
  const { orgId, customerId, invoiceId } = await seed("daycap@chancey.test");
  const from = await enableEmail(orgId);
  const rows = Array.from({ length: EMAIL_CUSTOMER_DAY_CAP }, (_, i) => ({
    org_id: orgId,
    invoice_id: invoiceId,
    customer_id: customerId,
    direction: "outbound",
    to_address: "daycap@chancey.test",
    subject: `prior ${i}`,
    body: `prior ${i}`,
    status: "sent",
  }));
  const { error } = await svc.from("email_messages").insert(rows);
  expect(error).toBeNull();
  const f = vi.fn();
  await expect(sendInvoiceEmail(deps(f, from), { orgId, invoiceId, userId, subject: "Hi", body: "Pay" }))
    .rejects.toThrow(/rate cap/i);
  expect(f).not.toHaveBeenCalled();
});

test("sendInvoiceEmail still sends when prior customer emails are older than 24h", async () => {
  const { orgId, customerId, invoiceId } = await seed("stale-day@chancey.test");
  const from = await enableEmail(orgId);
  const stale = new Date(DAYTIME_NOW.getTime() - 25 * 60 * 60 * 1000).toISOString();
  const rows = Array.from({ length: EMAIL_CUSTOMER_DAY_CAP }, (_, i) => ({
    org_id: orgId,
    invoice_id: invoiceId,
    customer_id: customerId,
    direction: "outbound",
    to_address: "stale-day@chancey.test",
    subject: `stale ${i}`,
    body: `stale ${i}`,
    status: "sent",
    created_at: stale,
  }));
  const { error } = await svc.from("email_messages").insert(rows);
  expect(error).toBeNull();
  const providerId = `re_stale_${Math.random().toString(16).slice(2)}`;
  const f = vi.fn(async () => jsonResponse({ id: providerId }));
  const res = await sendInvoiceEmail(deps(f, from), { orgId, invoiceId, userId, subject: "Hi", body: "Pay" });
  expect(res.providerMessageId).toBe(providerId);
  expect(f).toHaveBeenCalledTimes(1);
});

test("sendInvoiceEmail refuses when the workspace hour cap is already full", async () => {
  const { orgId, invoiceId } = await seed("hourcap@chancey.test");
  const from = await enableEmail(orgId);
  const { data: other } = await svc.from("customers")
    .insert({ org_id: orgId, name: "Other", email: "other-hour@chancey.test" }).select("id").single();
  const { data: otherInv } = await svc.from("invoices")
    .insert({
      org_id: orgId,
      qbo_id: `i-hour-${Math.random()}`,
      qbo_doc_number: "2099",
      customer_id: other!.id,
      balance: 50,
    }).select("id").single();
  const rows = Array.from({ length: EMAIL_ORG_HOUR_CAP }, (_, i) => ({
    org_id: orgId,
    invoice_id: otherInv!.id,
    customer_id: other!.id,
    direction: "outbound",
    to_address: "other-hour@chancey.test",
    subject: `prior ${i}`,
    body: `prior ${i}`,
    status: "sent",
  }));
  const { error } = await svc.from("email_messages").insert(rows);
  expect(error).toBeNull();
  const f = vi.fn();
  await expect(sendInvoiceEmail(deps(f, from), { orgId, invoiceId, userId, subject: "Hi", body: "Pay" }))
    .rejects.toThrow(/workspace/i);
  expect(f).not.toHaveBeenCalled();
});

test("sendInvoiceEmail still sends when workspace-hour emails are older than 1h", async () => {
  const { orgId, invoiceId } = await seed("stale-hour@chancey.test");
  const from = await enableEmail(orgId);
  const { data: other } = await svc.from("customers")
    .insert({ org_id: orgId, name: "Other", email: "other-stale-hour@chancey.test" }).select("id").single();
  const { data: otherInv } = await svc.from("invoices")
    .insert({
      org_id: orgId,
      qbo_id: `i-stale-hour-${Math.random()}`,
      qbo_doc_number: "2100",
      customer_id: other!.id,
      balance: 50,
    }).select("id").single();
  const stale = new Date(DAYTIME_NOW.getTime() - 65 * 60_000).toISOString();
  const rows = Array.from({ length: EMAIL_ORG_HOUR_CAP }, (_, i) => ({
    org_id: orgId,
    invoice_id: otherInv!.id,
    customer_id: other!.id,
    direction: "outbound",
    to_address: "other-stale-hour@chancey.test",
    subject: `stale ${i}`,
    body: `stale ${i}`,
    status: "sent",
    created_at: stale,
  }));
  const { error } = await svc.from("email_messages").insert(rows);
  expect(error).toBeNull();
  const providerId = `re_hour_stale_${Math.random().toString(16).slice(2)}`;
  const f = vi.fn(async () => jsonResponse({ id: providerId }));
  const res = await sendInvoiceEmail(deps(f, from), { orgId, invoiceId, userId, subject: "Hi", body: "Pay" });
  expect(res.providerMessageId).toBe(providerId);
  expect(f).toHaveBeenCalledTimes(1);
});

test("Resend 400 releases the reserved outbound row", async () => {
  const { orgId, customerId, invoiceId } = await seed("outage@chancey.test");
  const from = await enableEmail(orgId);
  const f = vi.fn(async () => jsonResponse({ message: "invalid" }, 400));
  await expect(sendInvoiceEmail(deps(f, from), { orgId, invoiceId, userId, subject: "Hi", body: "Pay" }))
    .rejects.toThrow(/Resend send failed \(400\)/);
  expect(f).toHaveBeenCalledTimes(1);
  const { data: rows } = await svc.from("email_messages").select("id").eq("customer_id", customerId);
  expect(rows ?? []).toHaveLength(0);
});

test("membership removal before reservation denies the email provider call", async () => {
  const { orgId, customerId, invoiceId } = await seed("removed@chancey.test");
  const from = await enableEmail(orgId);
  const backup = await makeUserClient(`email-backup-${crypto.randomUUID()}@example.com`);
  await svc.from("memberships").insert({ org_id: orgId, user_id: backup.userId, role: "owner" });
  const { error: removeError } = await svc.from("memberships")
    .delete().eq("org_id", orgId).eq("user_id", userId);
  expect(removeError).toBeNull();
  const fetchFn = vi.fn();
  await expect(sendInvoiceEmail(deps(fetchFn, from), {
    orgId, invoiceId, userId, subject: "Hi", body: "Pay",
  })).rejects.toMatchObject({ code: "42501" });
  expect(fetchFn).not.toHaveBeenCalled();
  const { data: rows } = await svc.from("email_messages").select("id").eq("customer_id", customerId);
  expect(rows ?? []).toHaveLength(0);
});

test("authenticated owners cannot mutate outbound email provider-attempt fields", async () => {
  const { orgId, invoiceId } = await seed("immutable@chancey.test");
  const from = await enableEmail(orgId);
  const fetchFn = vi.fn(async () => jsonResponse({ id: "re_immutable" }));
  const sent = await sendInvoiceEmail(deps(fetchFn, from), {
    orgId, invoiceId, userId, subject: "Hi", body: "Original",
  });
  const { data: changed, error } = await userClient.from("email_messages").update({
    body: "tampered",
    customer_id: null,
    send_dedupe_key: "cleared",
    submission_id: crypto.randomUUID(),
    created_at: "2000-01-01T00:00:00.000Z",
  }).eq("id", sent.id).select("id");
  expect(error?.code === "42501" || (changed ?? []).length === 0).toBe(true);
  const { data: preserved } = await svc.from("email_messages")
    .select("body, customer_id, send_dedupe_key, created_at").eq("id", sent.id).single();
  expect(preserved?.body).not.toBe("tampered");
  expect(preserved?.customer_id).not.toBeNull();
  expect(preserved?.send_dedupe_key).not.toBe("cleared");
  expect(preserved?.created_at).not.toBe("2000-01-01T00:00:00+00:00");
});

test("a Resend 503 is durable and blocks a blind retry", async () => {
  const { orgId, customerId, invoiceId } = await seed("server-error@chancey.test");
  const from = await enableEmail(orgId);
  const firstFetch = vi.fn(async () => jsonResponse({ message: "unavailable" }, 503));
  const args = { orgId, invoiceId, userId, subject: "Hi", body: "Provider 500 reminder" };
  await expect(sendInvoiceEmail(deps(firstFetch, from), args)).rejects.toThrow(/status is unknown/i);
  const { data: rows } = await svc.from("email_messages")
    .select("status, error_code").eq("customer_id", customerId);
  expect(rows).toEqual([{ status: "unknown", error_code: "transport_ambiguous" }]);

  const retryFetch = vi.fn();
  await expect(sendInvoiceEmail(deps(retryFetch, from), args)).rejects.toThrow(/status is unknown/i);
  expect(retryFetch).not.toHaveBeenCalled();
});

test("an ambiguous email transport failure is durable and blocks a blind retry", async () => {
  const { orgId, customerId, invoiceId } = await seed("ambiguous@chancey.test");
  const from = await enableEmail(orgId);
  const firstFetch = vi.fn(async () => {
    throw new TypeError("connection closed after request write");
  });
  await expect(sendInvoiceEmail(
    deps(firstFetch, from),
    { orgId, invoiceId, userId, subject: "Hi", body: "Ambiguous reminder" },
  )).rejects.toThrow(/status is unknown/i);

  const { data: attempts } = await svc.from("email_messages")
    .select("status")
    .eq("customer_id", customerId);
  expect(attempts).toEqual([{ status: "unknown" }]);

  const retryFetch = vi.fn();
  await expect(sendInvoiceEmail(
    deps(retryFetch, from, {
      unsubscribeBaseUrl: "https://new.example.com",
      unsubscribeSecret: "rotated-secret",
    }),
    { orgId, invoiceId, userId, subject: "Hi", body: "Ambiguous reminder" },
  )).rejects.toThrow(/status is unknown/i);
  expect(retryFetch).not.toHaveBeenCalled();
});

test("concurrent duplicate email actions reserve one provider send", async () => {
  const { orgId, customerId, invoiceId } = await seed("concurrent@chancey.test");
  const from = await enableEmail(orgId);
  const fetchFn = vi.fn(async () => {
    await new Promise((resolve) => setTimeout(resolve, 25));
    return jsonResponse({ id: "re_concurrent" });
  });
  const args = { orgId, invoiceId, userId, subject: "Hi", body: "Concurrent reminder", submissionId: crypto.randomUUID() };
  const outcomes = await Promise.allSettled([
    sendInvoiceEmail(deps(fetchFn, from), args),
    sendInvoiceEmail(deps(fetchFn, from), args),
  ]);

  expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
  expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
  expect(fetchFn).toHaveBeenCalledOnce();
  const { data: rows } = await svc.from("email_messages")
    .select("status, provider_message_id").eq("customer_id", customerId);
  expect(rows).toEqual([{ status: "sent", provider_message_id: "re_concurrent" }]);
});

test("the same email submission replayed after UTC midnight returns the recorded send", async () => {
  const { orgId, invoiceId } = await seed("midnight@chancey.test");
  const from = await enableEmail(orgId);
  const submissionId = crypto.randomUUID();
  const fetchFn = vi.fn(async () => jsonResponse({ id: "re_midnight" }));
  const args = { orgId, invoiceId, userId, subject: "Hi", body: "Midnight retry", submissionId };

  const first = await sendInvoiceEmail(
    deps(fetchFn, from, { now: new Date("2026-06-15T23:59:59.000Z") }),
    args,
  );
  const replay = await sendInvoiceEmail(
    deps(fetchFn, from, { now: new Date("2026-06-16T00:00:01.000Z") }),
    args,
  );

  expect(replay).toEqual(first);
  expect(fetchFn).toHaveBeenCalledOnce();
});

test("an unknown email attempt blocks the same payload under a fresh submission identity", async () => {
  const { orgId, invoiceId } = await seed("unknown-new-id@chancey.test");
  const from = await enableEmail(orgId);
  const firstFetch = vi.fn(async () => { throw new TypeError("response lost"); });
  const base = { orgId, invoiceId, userId, subject: "Hi", body: "Unknown retry guard" };
  await expect(sendInvoiceEmail(deps(firstFetch, from), { ...base, submissionId: crypto.randomUUID() }))
    .rejects.toThrow(/status is unknown/i);

  const blindRetry = vi.fn();
  await expect(sendInvoiceEmail(deps(blindRetry, from), { ...base, submissionId: crypto.randomUUID() }))
    .rejects.toThrow(/status is unknown/i);
  expect(blindRetry).not.toHaveBeenCalled();
});

test("an email submission identity cannot be reused to retarget another customer", async () => {
  const { orgId, invoiceId } = await seed("original-target@chancey.test");
  const from = await enableEmail(orgId);
  const { data: otherCustomer } = await svc.from("customers").insert({
    org_id: orgId, name: "Other", email: "other-target@chancey.test",
  }).select("id").single();
  const { data: otherInvoice } = await svc.from("invoices").insert({
    org_id: orgId, qbo_id: `retarget-email-${crypto.randomUUID()}`,
    customer_id: otherCustomer!.id, balance: 50,
  }).select("id").single();
  const submissionId = crypto.randomUUID();
  const fetchFn = vi.fn(async () => jsonResponse({ id: "re_original_target" }));

  await sendInvoiceEmail(deps(fetchFn, from), {
    orgId, invoiceId, userId, subject: "Hi", body: "Original target", submissionId,
  });
  await expect(sendInvoiceEmail(deps(fetchFn, from), {
    orgId, invoiceId: otherInvoice!.id as string, userId,
    subject: "Hi", body: "Original target", submissionId,
  })).rejects.toThrow(/submission.*different send/i);
  await expect(sendInvoiceEmail(deps(fetchFn, from), {
    orgId, invoiceId, userId, subject: "Hi", body: "Changed payload", submissionId,
  })).rejects.toThrow(/submission.*different send/i);
  const otherUser = await makeUserClient(`email-reuse-${crypto.randomUUID()}@example.com`);
  await svc.from("memberships").insert({ org_id: orgId, user_id: otherUser.userId, role: "member" });
  await expect(sendInvoiceEmail(deps(fetchFn, from), {
    orgId, invoiceId, userId: otherUser.userId,
    subject: "Hi", body: "Original target", submissionId,
  })).rejects.toThrow(/submission.*different send/i);
  expect(fetchFn).toHaveBeenCalledOnce();
});

test("a deliberate new email operation can repeat completed content on the same day", async () => {
  const { orgId, invoiceId } = await seed("deliberate-repeat@chancey.test");
  const from = await enableEmail(orgId);
  const fetchFn = vi.fn()
    .mockResolvedValueOnce(jsonResponse({ id: "re_first_op" }))
    .mockResolvedValueOnce(jsonResponse({ id: "re_second_op" }));
  const base = { orgId, invoiceId, userId, subject: "Hi", body: "Intentional repeat" };

  await sendInvoiceEmail(deps(fetchFn, from), { ...base, submissionId: crypto.randomUUID() });
  await sendInvoiceEmail(deps(fetchFn, from), { ...base, submissionId: crypto.randomUUID() });

  expect(fetchFn).toHaveBeenCalledTimes(2);
});

test("a blocked terminal email retry keeps its submission identity bound", async () => {
  const { orgId, invoiceId } = await seed("bound-terminal@chancey.test");
  const from = await enableEmail(orgId);
  const terminalSubmissionId = crypto.randomUUID();
  const fetchFn = vi.fn(async () => jsonResponse({ id: "re_terminal_a" }));
  const args = { orgId, invoiceId, userId, subject: "Hi", body: "Bound terminal retry" };
  const terminal = await sendInvoiceEmail(deps(fetchFn, from), { ...args, submissionId: terminalSubmissionId });
  await svc.from("email_messages").update({ status: "failed", error_code: "known_failure" }).eq("id", terminal.id);

  const ambiguousFetch = vi.fn(async () => { throw new TypeError("response lost"); });
  await expect(sendInvoiceEmail(deps(ambiguousFetch, from), { ...args, submissionId: crypto.randomUUID() }))
    .rejects.toThrow(/status is unknown/i);
  await expect(sendInvoiceEmail(deps(vi.fn(), from), { ...args, submissionId: terminalSubmissionId }))
    .rejects.toThrow(/status is unknown/i);

  const { data: preserved, error } = await svc.from("email_messages")
    .select("submission_id").eq("id", terminal.id).single();
  expect(error).toBeNull();
  expect(preserved?.submission_id).toBe(terminalSubmissionId);
  await expect(sendInvoiceEmail(deps(vi.fn(), from), {
    ...args, body: "Changed after blocked retry", submissionId: terminalSubmissionId,
  })).rejects.toThrow(/submission.*different send/i);
});

test("a corrected email destination is a distinct same-day provider request", async () => {
  const { orgId, customerId, invoiceId } = await seed("old-destination@chancey.test");
  const from = await enableEmail(orgId);
  const fetchFn = vi
    .fn()
    .mockResolvedValueOnce(jsonResponse({ id: "re_old_dest" }))
    .mockResolvedValueOnce(jsonResponse({ id: "re_new_dest" }));
  const args = { orgId, invoiceId, userId, subject: "Hi", body: "Destination correction" };
  await sendInvoiceEmail(deps(fetchFn, from), args);
  await svc.from("customers").update({ email: "new-destination@chancey.test" }).eq("id", customerId);
  await sendInvoiceEmail(deps(fetchFn, from), args);
  expect(fetchFn).toHaveBeenCalledTimes(2);
});

test("a known failed email can be explicitly retried with a new provider key", async () => {
  const { orgId, invoiceId } = await seed("retryable@chancey.test");
  const from = await enableEmail(orgId);
  const fetchFn = vi
    .fn()
    .mockResolvedValueOnce(jsonResponse({ id: "re_failed" }))
    .mockResolvedValueOnce(jsonResponse({ id: "re_retry" }));
  const args = { orgId, invoiceId, userId, subject: "Hi", body: "Retryable reminder" };
  const first = await sendInvoiceEmail(deps(fetchFn, from), args);
  await svc.from("email_messages").update({ status: "failed", error_code: "bounce" }).eq("id", first.id);
  const second = await sendInvoiceEmail(deps(fetchFn, from), args);

  expect(second.providerMessageId).toBe("re_retry");
  expect(fetchFn).toHaveBeenCalledTimes(2);
  const firstHeaders = (fetchFn.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
  const retryHeaders = (fetchFn.mock.calls[1][1] as RequestInit).headers as Record<string, string>;
  expect(retryHeaders["Idempotency-Key"]).not.toBe(firstHeaders["Idempotency-Key"]);
});

test("happy path: provider called once, one outbound row, footer appended", async () => {
  const { orgId, customerId, invoiceId } = await seed("happy@chancey.test");
  const from = await enableEmail(orgId, { from_name: "Chancey" });
  const f = vi.fn(async () => jsonResponse({ id: "re_1" }));
  const res = await sendInvoiceEmail(deps(f, from), { orgId, invoiceId, userId, subject: "Hi", body: "Pay up" });
  expect(res.providerMessageId).toBe("re_1");
  expect(f).toHaveBeenCalledTimes(1);
  const sent = JSON.parse((f.mock.calls[0][1] as any).body);
  expect(sent.text).toMatch(/unsubscribe/i);
  const { data: rows } = await svc.from("email_messages")
    .select("id, direction, body").eq("customer_id", customerId);
  expect(rows ?? []).toHaveLength(1);
  expect(rows![0].direction).toBe("outbound");
  expect(rows![0].body).toMatch(/unsubscribe/i);
});
