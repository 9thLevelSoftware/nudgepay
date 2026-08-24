import { beforeAll, expect, test, vi } from "vitest";
import { serviceClient, makeUserClient } from "./helpers";
import { sendInvoiceEmail, type EmailDeps } from "../app/lib/email-messaging.server";

let userId: string;
beforeAll(async () => { ({ userId } = await makeUserClient("email-sender@example.com")); });

const svc = serviceClient();

async function seed(email: string | null, doNotEmail = false) {
  const { data: org } = await svc.from("organizations")
    .insert({ name: `Email Org ${Math.random()}` }).select("id").single();
  const orgId = org!.id as string;
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
