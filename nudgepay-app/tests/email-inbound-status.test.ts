import { describe, it, expect, vi } from "vitest";
import { serviceClient } from "./helpers";
import { alreadyRecordedInboundEmail, updateEmailStatus, recordInboundEmail } from "../app/lib/email-messaging.server";

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

  it("recordInboundEmail matches a stored display-name customer email", async () => {
    const addr = `cust-display-${Math.random()}@x.com`;
    const { customerId, invoiceId, orgFromAddress } = await seedWithOutbound(
      `Acme AR <${addr}>`,
      `re_out_disp_${Math.random()}`,
      `billing-disp-${Math.random()}@chancey.test`,
    );
    const r = await recordInboundEmail(svc, {
      from: addr,
      to: orgFromAddress,
      subject: "Re",
      body: "ok",
      providerMessageId: `in_disp_${Math.random()}`,
    });
    expect(r.matched).toBe(true);
    const { data: row } = await svc.from("customers").select("email_norm").eq("id", customerId).single();
    expect(row!.email_norm).toBe(addr);
    const { data: inbound } = await svc
      .from("email_messages")
      .select("customer_id, invoice_id")
      .eq("customer_id", customerId)
      .eq("direction", "inbound");
    expect(inbound!.some((m) => m.invoice_id === invoiceId)).toBe(true);
  });

  it("unmatched sender persists inbound_orphans and returns matched:false", async () => {
    const orgFrom = `billing-unmatched-${Math.random()}@chancey.test`;
    await seedWithOutbound("cust-known-unm@x.com", `re_out_unm_${Math.random()}`, orgFrom);
    const pid = `in_es_stranger_${Math.random()}`;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const r = await recordInboundEmail(svc, {
        from: "stranger@nowhere-es.com",
        to: orgFrom,
        subject: "x",
        body: "y",
        providerMessageId: pid,
      });
      expect(r.matched).toBe(false);
      const { data: rows } = await svc
        .from("email_messages")
        .select("id")
        .eq("provider_message_id", pid);
      expect(rows ?? []).toHaveLength(0);
      const { data: orphan } = await svc
        .from("inbound_orphans")
        .select("channel, from_address, to_address, from_number, to_number, provider_message_id, subject, body")
        .eq("provider_message_id", pid)
        .single();
      expect(orphan).toMatchObject({
        channel: "email",
        from_address: "stranger@nowhere-es.com",
        to_address: orgFrom,
        from_number: null,
        to_number: null,
        provider_message_id: pid,
        subject: "x",
        body: "y",
      });
      expect(spy).toHaveBeenCalledWith({
        event: "inbound_orphan_email",
        from: "stranger@nowhere-es.com",
        to: orgFrom,
        sid: pid,
      });
    } finally {
      spy.mockRestore();
    }
  });

  it("unmatched inbound unique violation is matched:false (webhook still 204)", async () => {
    const orgFrom = `billing-dup-${Math.random()}@chancey.test`;
    await seedWithOutbound("cust-dup@x.com", `re_out_dup_${Math.random()}`, orgFrom);
    const pid = `in_es_dup_${Math.random()}`;
    const args = {
      from: "ghost@nowhere-es.com",
      to: orgFrom,
      subject: "x",
      body: "y",
      providerMessageId: pid,
    };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const first = await recordInboundEmail(svc, args);
      const second = await recordInboundEmail(svc, args);
      expect(first.matched).toBe(false);
      expect(second.matched).toBe(false);
      expect(await alreadyRecordedInboundEmail(svc, pid)).toEqual({ matched: false });
      const { data: orphans } = await svc
        .from("inbound_orphans")
        .select("id")
        .eq("provider_message_id", pid);
      expect(orphans).toHaveLength(1);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  it("ambiguous customer email is unmatched and persisted as orphan", async () => {
    const orgFrom = `billing-amb-${Math.random()}@chancey.test`;
    const shared = `same-amb-${Math.random()}@x.com`;
    const { orgId } = await seedWithOutbound(shared, `re_out_amb_${Math.random()}`, orgFrom);
    await svc.from("customers").insert({ org_id: orgId, name: "Twin", email: shared });
    const pid = `in_amb_${Math.random()}`;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const r = await recordInboundEmail(svc, {
        from: shared,
        to: orgFrom,
        subject: "Re",
        body: "hi",
        providerMessageId: pid,
      });
      expect(r.matched).toBe(false);
      const { data: msgs } = await svc.from("email_messages").select("id").eq("provider_message_id", pid);
      expect(msgs ?? []).toHaveLength(0);
      const { data: orphans } = await svc
        .from("inbound_orphans")
        .select("channel")
        .eq("provider_message_id", pid);
      expect(orphans).toHaveLength(1);
      expect(orphans![0].channel).toBe("email");
    } finally {
      spy.mockRestore();
    }
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

  it("idempotent: a replayed inbound event does not create a duplicate row", async () => {
    const { orgFromAddress } = await seedWithOutbound(
      "cust-idem@x.com",
      "re_out_idem",
      `billing-idem-${Math.random()}@chancey.test`,
    );
    const pid = `in_idem_${Math.random()}`;
    const args = {
      from: "Cust <cust-idem@x.com>",
      to: orgFromAddress,
      subject: "Re",
      body: "ok",
      providerMessageId: pid,
    };
    const first = await recordInboundEmail(svc, args);
    const second = await recordInboundEmail(svc, args); // replay/retry
    expect(first.matched).toBe(true);
    expect(second.matched).toBe(true);
    expect(await alreadyRecordedInboundEmail(svc, pid)).toEqual({ matched: true });
    const { data: rows } = await svc
      .from("email_messages")
      .select("id")
      .eq("provider_message_id", pid);
    expect(rows).toHaveLength(1); // exactly one, not two
  });

  it("cross-tenant: unknown recipient address returns matched:false (not a DB leak)", async () => {
    // An inbound email whose To: address is not registered in any org's
    // email_config must be silently dropped, never attributed to a random org.
    const pid = `ct-unknown-${Math.random()}`;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const r = await recordInboundEmail(svc, {
        from: "anyone@external.example",
        to: "unknown-domain@nobody.example",
        subject: "Spam",
        body: "Hello",
        providerMessageId: pid,
      });
      expect(r.matched).toBe(false);
      const { data: orphans } = await svc
        .from("inbound_orphans")
        .select("channel, from_address, to_address")
        .eq("provider_message_id", pid);
      expect(orphans).toHaveLength(1);
      expect(orphans![0]).toMatchObject({
        channel: "email",
        from_address: "anyone@external.example",
        to_address: "unknown-domain@nobody.example",
      });
    } finally {
      spy.mockRestore();
    }
  });

  it("treats the inbound recipient as a literal address, not an ILIKE pattern", async () => {
    const fromAddress = `billing-wild-${Math.random()}@chancey.test`;
    await seedWithOutbound("wildcard-sender@x.com", `re_wild_${Math.random()}`, fromAddress);

    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const r = await recordInboundEmail(svc, {
        from: "wildcard-sender@x.com",
        to: "%",
        subject: "Pattern attempt",
        body: "This must not route.",
        providerMessageId: `in_wild_${Math.random()}`,
      });

      expect(r.matched).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });
});
