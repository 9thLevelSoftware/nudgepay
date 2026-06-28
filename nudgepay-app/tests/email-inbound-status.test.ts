import { describe, it, expect } from "vitest";
import { serviceClient } from "./helpers";
import { updateEmailStatus, recordInboundEmail } from "../app/lib/email-messaging.server";

const svc = serviceClient();

async function seedWithOutbound(email: string, providerMessageId: string) {
  const { data: org } = await svc
    .from("organizations")
    .insert({ name: `InboundEmail Org ${Math.random()}` })
    .select("id")
    .single();
  const orgId = org!.id as string;
  const { data: cust } = await svc
    .from("customers")
    .insert({ org_id: orgId, name: "Acme", email })
    .select("id")
    .single();
  const customerId = cust!.id as string;
  const { data: inv } = await svc
    .from("invoices")
    .insert({ org_id: orgId, qbo_id: `i-${Math.random()}`, customer_id: customerId, balance: 100 })
    .select("id")
    .single();
  const invoiceId = inv!.id as string;
  await svc.from("email_messages").insert({
    org_id: orgId,
    invoice_id: invoiceId,
    customer_id: customerId,
    direction: "outbound",
    provider_message_id: providerMessageId,
    status: "sent",
    from_address: "billing@chancey.test",
    to_address: email,
    subject: "Invoice",
    body: "Please pay",
  });
  return { orgId, customerId, invoiceId };
}

describe("email inbound + status", () => {
  it("updateEmailStatus updates the matching outbound row", async () => {
    await seedWithOutbound("cust-status-1@x.com", "re_status_es1");
    await updateEmailStatus(svc, {
      providerMessageId: "re_status_es1",
      status: "delivered",
      errorCode: null,
      optOut: false,
    });
    const { data } = await svc
      .from("email_messages")
      .select("status, error_code")
      .eq("provider_message_id", "re_status_es1")
      .single();
    expect(data!.status).toBe("delivered");
    expect(data!.error_code).toBeNull();
  });

  it("optOut flips customers.do_not_email", async () => {
    const { customerId } = await seedWithOutbound("cust-status-2@x.com", "re_status_es2");
    await updateEmailStatus(svc, {
      providerMessageId: "re_status_es2",
      status: "complained",
      errorCode: "complaint",
      optOut: true,
    });
    const { data: cust } = await svc
      .from("customers")
      .select("do_not_email")
      .eq("id", customerId)
      .single();
    expect(cust!.do_not_email).toBe(true);
  });

  it("nonexistent provider id is a safe no-op", async () => {
    await expect(
      updateEmailStatus(svc, {
        providerMessageId: "nope-es-nonexistent",
        status: "delivered",
        errorCode: null,
        optOut: false,
      }),
    ).resolves.toBeUndefined();
  });

  it("recordInboundEmail matches by sender email + threads to outbound invoice", async () => {
    const { customerId, invoiceId } = await seedWithOutbound("cust-inbound-3@x.com", "re_out_es3");
    const r = await recordInboundEmail(svc, {
      from: "Cust <cust-inbound-3@x.com>",
      to: "billing@us.com",
      subject: "Re",
      body: "ok",
      providerMessageId: "in_es3",
    });
    expect(r.matched).toBe(true);
    const { data: rows } = await svc
      .from("email_messages")
      .select("direction, customer_id, invoice_id, body")
      .eq("provider_message_id", "in_es3");
    expect(rows).toHaveLength(1);
    expect(rows![0].direction).toBe("inbound");
    expect(rows![0].customer_id).toBe(customerId);
    expect(rows![0].invoice_id).toBe(invoiceId);
    expect(rows![0].body).toBe("ok");
  });

  it("unmatched sender => no row, matched:false", async () => {
    const r = await recordInboundEmail(svc, {
      from: "stranger@nowhere-es.com",
      to: "billing@us.com",
      subject: "x",
      body: "y",
      providerMessageId: "in_es_stranger",
    });
    expect(r.matched).toBe(false);
    const { data: rows } = await svc
      .from("email_messages")
      .select("id")
      .eq("provider_message_id", "in_es_stranger");
    expect(rows ?? []).toHaveLength(0);
  });
});
