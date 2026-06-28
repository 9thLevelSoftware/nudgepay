import { describe, it, expect } from "vitest";
import { serviceClient } from "./helpers";
import { updateEmailStatus, recordInboundEmail } from "../app/lib/email-messaging.server";

const svc = serviceClient();

// Each org gets its own from_address so the recipient-scoping logic can
// distinguish tenants.  The caller must pass a unique orgFromAddress per org so
// tests don't collide when run in parallel within a single global-setup pass.
async function seedWithOutbound(
  email: string,
  providerMessageId: string,
  orgFromAddress = "billing@chancey.test",
) {
  const { data: org } = await svc
    .from("organizations")
    .insert({ name: `InboundEmail Org ${Math.random()}` })
    .select("id")
    .single();
  const orgId = org!.id as string;

  // Register the org's sending address so recordInboundEmail can scope the
  // candidate lookup to this tenant via the inbound recipient address.
  await svc
    .from("email_config")
    .insert({ org_id: orgId, email_enabled: true, from_address: orgFromAddress });

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
    from_address: orgFromAddress,
    to_address: email,
    subject: "Invoice",
    body: "Please pay",
  });
  return { orgId, customerId, invoiceId, orgFromAddress };
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
    const { customerId, invoiceId, orgFromAddress } = await seedWithOutbound(
      "cust-inbound-3@x.com",
      "re_out_es3",
      `billing-ib3-${Math.random()}@chancey.test`,
    );
    const r = await recordInboundEmail(svc, {
      from: "Cust <cust-inbound-3@x.com>",
      to: orgFromAddress,
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

  it("cross-tenant: inbound routes only to the org that owns the recipient address", async () => {
    // Two orgs share a customer email address — a common scenario with billing
    // contacts.  Inbound email addressed to Org A's sending domain must be
    // attributed to Org A's customer only; Org B's copy of that email must never
    // be matched, even though its customer row has the same email value.
    const sharedEmail = `shared-ct-${Math.random()}@crosstest.example`;

    const fromAddrA = `billing-ct-a-${Math.random()}@chancey.test`;
    const { data: orgA } = await svc
      .from("organizations")
      .insert({ name: `CrossA ${Math.random()}` })
      .select("id")
      .single();
    const orgAId = orgA!.id as string;
    await svc
      .from("email_config")
      .insert({ org_id: orgAId, email_enabled: true, from_address: fromAddrA });
    const { data: custA } = await svc
      .from("customers")
      .insert({ org_id: orgAId, name: "SharedA", email: sharedEmail })
      .select("id")
      .single();

    const fromAddrB = `billing-ct-b-${Math.random()}@chancey.test`;
    const { data: orgB } = await svc
      .from("organizations")
      .insert({ name: `CrossB ${Math.random()}` })
      .select("id")
      .single();
    const orgBId = orgB!.id as string;
    await svc
      .from("email_config")
      .insert({ org_id: orgBId, email_enabled: true, from_address: fromAddrB });
    await svc
      .from("customers")
      .insert({ org_id: orgBId, name: "SharedB", email: sharedEmail });

    const pid = `cross-ct-${Math.random()}`;
    const r = await recordInboundEmail(svc, {
      from: sharedEmail,
      to: fromAddrA, // addressed to Org A's sending address
      subject: "Re: Invoice",
      body: "Payment enclosed.",
      providerMessageId: pid,
    });

    expect(r.matched).toBe(true);

    const { data: rows } = await svc
      .from("email_messages")
      .select("org_id, customer_id")
      .eq("provider_message_id", pid);
    expect(rows).toHaveLength(1);
    // Must land in Org A, on Org A's customer — not Org B's.
    expect(rows![0].org_id).toBe(orgAId);
    expect(rows![0].customer_id).toBe(custA!.id as string);
  });

  it("cross-tenant: unknown recipient address returns matched:false (not a DB leak)", async () => {
    // An inbound email whose To: address is not registered in any org's
    // email_config must be silently dropped, never attributed to a random org.
    const r = await recordInboundEmail(svc, {
      from: "anyone@external.example",
      to: "unknown-domain@nobody.example",
      subject: "Spam",
      body: "Hello",
      providerMessageId: `ct-unknown-${Math.random()}`,
    });
    expect(r.matched).toBe(false);
  });
});
