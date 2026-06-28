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

function deps(fetchFn: any): EmailDeps {
  return {
    fetchFn,
    service: svc,
    email: { apiKey: "test-key" },
    unsubscribeBaseUrl: "https://app.example.com",
    unsubscribeSecret: "test-secret",
  };
}

test("throws + no provider call + no row when email disabled (absent config)", async () => {
  const { orgId, customerId, invoiceId } = await seed("customer@example.com");
  const f = vi.fn();
  await expect(sendInvoiceEmail(deps(f), { orgId, invoiceId, userId, subject: "Hi", body: "Pay" }))
    .rejects.toThrow(/disabled/i);
  expect(f).not.toHaveBeenCalled();
  const { data: rows } = await svc.from("email_messages").select("id").eq("customer_id", customerId);
  expect(rows ?? []).toHaveLength(0);
});

test("throws when customer has no email", async () => {
  const { orgId, customerId, invoiceId } = await seed(null);
  await svc.from("email_config")
    .insert({ org_id: orgId, email_enabled: true, from_address: "billing@chancey.test" });
  const f = vi.fn();
  await expect(sendInvoiceEmail(deps(f), { orgId, invoiceId, userId, subject: "Hi", body: "Pay" }))
    .rejects.toThrow(/email/i);
  expect(f).not.toHaveBeenCalled();
  const { data: rows } = await svc.from("email_messages").select("id").eq("customer_id", customerId);
  expect(rows ?? []).toHaveLength(0);
});

test("throws when do_not_email", async () => {
  const { orgId, customerId, invoiceId } = await seed("dnc@chancey.test", true);
  await svc.from("email_config")
    .insert({ org_id: orgId, email_enabled: true, from_address: "billing@chancey.test" });
  const f = vi.fn();
  await expect(sendInvoiceEmail(deps(f), { orgId, invoiceId, userId, subject: "Hi", body: "Pay" }))
    .rejects.toThrow(/opted out/i);
  expect(f).not.toHaveBeenCalled();
  const { data: rows } = await svc.from("email_messages").select("id").eq("customer_id", customerId);
  expect(rows ?? []).toHaveLength(0);
});

test("throws when contact-blocked", async () => {
  const { orgId, customerId, invoiceId } = await seed("blocked@chancey.test");
  await svc.from("email_config")
    .insert({ org_id: orgId, email_enabled: true, from_address: "billing@chancey.test" });
  await svc.from("collection_cases").insert({
    org_id: orgId,
    customer_id: customerId,
    status: "on_hold",
    next_action_type: "exception",
    exception_reason: "do_not_contact",
  });
  const f = vi.fn();
  await expect(sendInvoiceEmail(deps(f), { orgId, invoiceId, userId, subject: "Hi", body: "Pay" }))
    .rejects.toThrow(/blocked/i);
  expect(f).not.toHaveBeenCalled();
  const { data: rows } = await svc.from("email_messages").select("id").eq("customer_id", customerId);
  expect(rows ?? []).toHaveLength(0);
});

test("happy path: provider called once, one outbound row, footer appended", async () => {
  const { orgId, customerId, invoiceId } = await seed("happy@chancey.test");
  await svc.from("email_config")
    .insert({ org_id: orgId, email_enabled: true, from_address: "billing@chancey.test", from_name: "Chancey" });
  const f = vi.fn(async () => jsonResponse({ id: "re_1" }));
  const res = await sendInvoiceEmail(deps(f), { orgId, invoiceId, userId, subject: "Hi", body: "Pay up" });
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
