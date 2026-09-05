import { expect, test, vi } from "vitest";
import { serviceClient } from "./helpers";
import { recordInboundMessage, updateMessageStatus } from "../app/lib/twilio-messaging.server";

const svc = serviceClient();

// Each test creates its own org and asserts only on ids belonging to that org.
// No global truncate — isolation is achieved through unique phone numbers and
// org-scoped lookups, matching the pattern used in twilio-send.test.ts and
// qbo-sync.test.ts. Phones use the +1310555XXXX range which no other file uses.

async function seedCustomerWithOutbound(
  phone: string,
  outboundSid: string,
  consent = true,
  inboundTo = `+1500555${phone.replace(/\D/g, "").slice(-4)}`,
) {
  const { data: org } = await svc.from("organizations").insert({ name: "Inbound Org" }).select("id").single();
  const orgId = org!.id as string;
  const { data: cust } = await svc.from("customers")
    .insert({ org_id: orgId, qbo_id: "c1", name: "Acme", phone, sms_consent: consent }).select("id").single();
  const { data: inv } = await svc.from("invoices")
    .insert({ org_id: orgId, qbo_id: "i1", customer_id: cust!.id, balance: 50 }).select("id").single();
  await svc.from("text_messages").insert({
    org_id: orgId, invoice_id: inv!.id, customer_id: cust!.id, direction: "outbound",
    twilio_message_sid: outboundSid, from_number: inboundTo, to_number: phone, body: "ping",
  });
  return { orgId, customerId: cust!.id as string, invoiceId: inv!.id as string, inboundTo };
}

test("recordInboundMessage matches by phone and threads to the latest outbound invoice", async () => {
  const { customerId, invoiceId, inboundTo } = await seedCustomerWithOutbound("+13105550201", "SMout-201");
  const out = await recordInboundMessage(svc, { from: "(310) 555-0201", to: inboundTo, body: "ok thanks", messageSid: "SMin1-201" });
  expect(out).toMatchObject({ matched: true, optOut: false });
  const { data: msg } = await svc.from("text_messages").select("direction, customer_id, invoice_id, body")
    .eq("twilio_message_sid", "SMin1-201").single();
  expect(msg!.direction).toBe("inbound");
  expect(msg!.customer_id).toBe(customerId);
  expect(msg!.invoice_id).toBe(invoiceId);
  expect(msg!.body).toBe("ok thanks");
});

test("recordInboundMessage STOP flips sms_consent off and do_not_text", async () => {
  const { customerId, inboundTo } = await seedCustomerWithOutbound("+13105550202", "SMout-202", true);
  const out = await recordInboundMessage(svc, { from: "+13105550202", to: inboundTo, body: "STOP", messageSid: "SMin2-202" });
  expect(out.optOut).toBe(true);
  expect(out.twiml).toContain("unsubscribed");
  const { data: cust } = await svc.from("customers").select("sms_consent, do_not_text, sms_consent_source").eq("id", customerId).single();
  expect(cust!.sms_consent).toBe(false);
  expect(cust!.do_not_text).toBe(true);
  expect(cust!.sms_consent_source).toBe("inbound_stop");
});

test("recordInboundMessage START re-enables sms_consent", async () => {
  const { customerId, inboundTo } = await seedCustomerWithOutbound("+13105550203", "SMout-203", false);
  await recordInboundMessage(svc, { from: "+13105550203", to: inboundTo, body: "START", messageSid: "SMin3-203" });
  const { data: cust } = await svc.from("customers").select("sms_consent").eq("id", customerId).single();
  expect(cust!.sms_consent).toBe(true);
});

test("recordInboundMessage persists unmatched inbound including STOP (NP-AUD-2026-004)", async () => {
  const onOrphanStop = vi.fn();
  const out = await recordInboundMessage(svc, {
    from: "+13105559999",
    to: "+15005550006",
    body: "STOP",
    messageSid: "SMin4-9999",
    onOrphanStop,
  });
  expect(out.matched).toBe(false);
  expect(out.optOut).toBe(true);
  const { data } = await svc.from("text_messages").select("id").eq("twilio_message_sid", "SMin4-9999");
  expect(data!.length).toBe(0);
  const { data: orphan } = await svc.from("inbound_orphans").select("keyword, body").eq("twilio_message_sid", "SMin4-9999").single();
  expect(orphan!.keyword).toBe("stop");
  expect(orphan!.body).toBe("STOP");
  expect(onOrphanStop).toHaveBeenCalledWith({
    event: "inbound_orphan_stop",
    from: "+13105559999",
    to: "+15005550006",
    sid: "SMin4-9999",
  });
});

test("recordInboundMessage logs inbound_orphan_stop via console.error by default", async () => {
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await recordInboundMessage(svc, {
      from: "+13105559995",
      to: "+15005550010",
      body: "STOP",
      messageSid: "SMin-orphan-console",
    });
    expect(spy).toHaveBeenCalledWith({
      event: "inbound_orphan_stop",
      sid: "SMin-orphan-console",
    });
  } finally {
    spy.mockRestore();
  }
});

test("recordInboundMessage does not re-alert STOP on MessageSid replay", async () => {
  const onOrphanStop = vi.fn();
  const args = {
    from: "+13105559996",
    to: "+15005550009",
    body: "STOP",
    messageSid: "SMin-orphan-replay",
    onOrphanStop,
  };
  const first = await recordInboundMessage(svc, args);
  const second = await recordInboundMessage(svc, args);
  expect(first.matched).toBe(false);
  expect(second.matched).toBe(true);
  expect(onOrphanStop).toHaveBeenCalledTimes(1);
});

test("updateMessageStatus updates status and error_code by sid", async () => {
  await seedCustomerWithOutbound("+13105550205", "SMout-205");
  await updateMessageStatus(svc, { messageSid: "SMout-205", status: "delivered", errorCode: null });
  const { data } = await svc.from("text_messages").select("status, error_code").eq("twilio_message_sid", "SMout-205").single();
  expect(data!.status).toBe("delivered");
  expect(data!.error_code).toBeNull();
});

test("Twilio status callbacks progress atomically and ignore out-of-order regressions", async () => {
  await seedCustomerWithOutbound("+13105551241", "SM-status-order-delivered");
  await updateMessageStatus(svc, {
    messageSid: "SM-status-order-delivered", status: "delivered", errorCode: null,
  });
  await updateMessageStatus(svc, {
    messageSid: "SM-status-order-delivered", status: "sent", errorCode: "late-sent",
  });
  const { data: delivered } = await svc.from("text_messages")
    .select("status, error_code").eq("twilio_message_sid", "SM-status-order-delivered").single();
  expect(delivered).toEqual({ status: "delivered", error_code: null });

  await seedCustomerWithOutbound("+13105551242", "SM-status-order-concurrent");
  await updateMessageStatus(svc, {
    messageSid: "SM-status-order-concurrent", status: "accepted", errorCode: null,
  });
  await Promise.all([
    updateMessageStatus(svc, {
      messageSid: "SM-status-order-concurrent", status: "sent", errorCode: null,
    }),
    updateMessageStatus(svc, {
      messageSid: "SM-status-order-concurrent", status: "delivered", errorCode: null,
    }),
  ]);
  const { data: concurrent } = await svc.from("text_messages")
    .select("status").eq("twilio_message_sid", "SM-status-order-concurrent").single();
  expect(concurrent?.status).toBe("delivered");

  await seedCustomerWithOutbound("+13105551243", "SM-status-order-failed");
  await updateMessageStatus(svc, {
    messageSid: "SM-status-order-failed", status: "failed", errorCode: "30001",
  });
  await updateMessageStatus(svc, {
    messageSid: "SM-status-order-failed", status: "queued", errorCode: null,
  });
  const { data: failed } = await svc.from("text_messages")
    .select("status, error_code").eq("twilio_message_sid", "SM-status-order-failed").single();
  expect(failed).toEqual({ status: "failed", error_code: "30001" });
});

test("recordInboundMessage stamps case_id from the customer's active case", async () => {
  const { orgId, customerId, inboundTo } = await seedCustomerWithOutbound("+13105550206", "SMout-206");
  const { data: cse } = await svc.from("collection_cases")
    .insert({ org_id: orgId, customer_id: customerId, status: "working" }).select("id").single();
  const caseId = cse!.id as string;
  await recordInboundMessage(svc, { from: "+13105550206", to: inboundTo, body: "hello", messageSid: "SM-IN-CASE" });
  const { data } = await svc.from("text_messages").select("case_id, direction")
    .eq("twilio_message_sid", "SM-IN-CASE").single();
  expect(data!.direction).toBe("inbound");
  expect(data!.case_id).toBe(caseId);
});

test("recordInboundMessage resolves the tenant from To before matching duplicate customer phones", async () => {
  const sharedPhone = "+13105550207";
  const orgA = await seedCustomerWithOutbound(sharedPhone, "SMout-207-a", true, "+15005552071");
  const orgB = await seedCustomerWithOutbound(sharedPhone, "SMout-207-b", true, "+15005552072");

  const out = await recordInboundMessage(svc, {
    from: sharedPhone,
    to: orgB.inboundTo,
    body: "STOP",
    messageSid: "SMin-207-target-b",
  });
  expect(out).toMatchObject({ matched: true, optOut: true });

  const { data: custA } = await svc.from("customers").select("sms_consent").eq("id", orgA.customerId).single();
  const { data: custB } = await svc.from("customers").select("sms_consent").eq("id", orgB.customerId).single();
  expect(custA!.sms_consent).toBe(true);
  expect(custB!.sms_consent).toBe(false);

  const { data: rows } = await svc.from("text_messages")
    .select("org_id, customer_id")
    .eq("twilio_message_sid", "SMin-207-target-b");
  expect(rows).toHaveLength(1);
  expect(rows![0].org_id).toBe(orgB.orgId);
  expect(rows![0].customer_id).toBe(orgB.customerId);
});

test("recordInboundMessage ignores messages addressed to an unconfigured To number", async () => {
  const { customerId } = await seedCustomerWithOutbound("+13105550208", "SMout-208", true);
  const out = await recordInboundMessage(svc, {
    from: "+13105550208",
    to: "+15005559999",
    body: "STOP",
    messageSid: "SMin-208-unconfigured-to",
  });
  expect(out.matched).toBe(false);
  expect(out.optOut).toBe(true);
  expect(out.keyword).toBe("stop");

  const { data: cust } = await svc.from("customers").select("sms_consent, do_not_text").eq("id", customerId).single();
  expect(cust!.sms_consent).toBe(true);
  expect(cust!.do_not_text).toBe(false);
  const { data: rows } = await svc.from("text_messages").select("id").eq("twilio_message_sid", "SMin-208-unconfigured-to");
  expect(rows ?? []).toHaveLength(0);
});

test("unmatched STOP does not flip consent on any matching last-10", async () => {
  const phone = "+13105550910";
  const { customerId } = await seedCustomerWithOutbound(phone, "SMout-910", true, "+15005559101");
  const out = await recordInboundMessage(svc, {
    from: phone,
    to: "+15005559910",
    body: "STOP",
    messageSid: "SMin-910-unmatched-stop",
  });
  expect(out.matched).toBe(false);
  const { data: cust } = await svc.from("customers")
    .select("sms_consent, do_not_text, sms_consent_source").eq("id", customerId).single();
  expect(cust!.sms_consent).toBe(true);
  expect(cust!.do_not_text).toBe(false);
  expect(cust!.sms_consent_source).not.toBe("inbound_stop");
});

test("two-org last-10 STOP writes neither org when To does not uniquely resolve", async () => {
  const phone = "+13105550901";
  const orgA = await seedCustomerWithOutbound(phone, "SMout-901-a", true, "+15005559011");
  const orgB = await seedCustomerWithOutbound(phone, "SMout-901-b", true, "+15005559012");
  const out = await recordInboundMessage(svc, {
    from: phone,
    to: "+15005559901",
    body: "STOP",
    messageSid: "SMin-901-ambiguous",
  });
  expect(out.matched).toBe(false);
  const { data: a } = await svc.from("customers").select("sms_consent, do_not_text").eq("id", orgA.customerId).single();
  const { data: b } = await svc.from("customers").select("sms_consent, do_not_text").eq("id", orgB.customerId).single();
  expect(a!.sms_consent).toBe(true);
  expect(a!.do_not_text).toBe(false);
  expect(b!.sms_consent).toBe(true);
  expect(b!.do_not_text).toBe(false);
});

test("recordInboundMessage STOP resolves org from default sender outbound history", async () => {
  const phone = "+13105550210";
  const defaultSender = "+15005551010";
  const { data: org } = await svc.from("organizations").insert({ name: "Default Sender Org" }).select("id").single();
  const orgId = org!.id as string;
  await svc.from("messaging_config").insert({ org_id: orgId, sender: null });
  const { data: cust } = await svc.from("customers")
    .insert({ org_id: orgId, qbo_id: "c-default-sender", name: "Acme", phone, sms_consent: true }).select("id").single();
  const customerId = cust!.id as string;
  const { data: inv } = await svc.from("invoices")
    .insert({ org_id: orgId, qbo_id: "i-default-sender", customer_id: customerId, balance: 50 }).select("id").single();
  await svc.from("text_messages").insert({
    org_id: orgId,
    invoice_id: inv!.id,
    customer_id: customerId,
    direction: "outbound",
    twilio_message_sid: "SMout-210-default",
    from_number: defaultSender,
    to_number: phone,
    body: "ping",
  });

  const out = await recordInboundMessage(svc, { from: phone, to: defaultSender, body: "STOP", messageSid: "SMin-210-default-stop" });
  expect(out).toMatchObject({ matched: true, optOut: true });

  const { data: custAfter } = await svc.from("customers").select("sms_consent").eq("id", customerId).single();
  expect(custAfter!.sms_consent).toBe(false);
});

test("recordInboundMessage ignores stale tenant sender config when outbound used the default sender", async () => {
  const phone = "+13105550212";
  const defaultSender = "+15005551012";
  const staleSender = "+15005559912";
  const { data: org } = await svc.from("organizations").insert({ name: "Stale Sender Org" }).select("id").single();
  const orgId = org!.id as string;
  await svc.from("messaging_config").insert({ org_id: orgId, sender: staleSender });
  const { data: cust } = await svc.from("customers")
    .insert({ org_id: orgId, qbo_id: "c-stale-sender", name: "Acme", phone, sms_consent: true }).select("id").single();
  const customerId = cust!.id as string;
  await svc.from("text_messages").insert({
    org_id: orgId,
    customer_id: customerId,
    direction: "outbound",
    twilio_message_sid: "SMout-212-default",
    from_number: defaultSender,
    to_number: phone,
    body: "ping",
  });

  const staleOut = await recordInboundMessage(svc, { from: phone, to: staleSender, body: "STOP", messageSid: "SMin-212-stale-stop" });
  expect(staleOut).toMatchObject({ matched: false, optOut: true });

  const { data: custAfterStale } = await svc.from("customers").select("sms_consent").eq("id", customerId).single();
  expect(custAfterStale!.sms_consent).toBe(true);
  const { data: staleRows } = await svc.from("text_messages").select("id").eq("twilio_message_sid", "SMin-212-stale-stop");
  expect(staleRows ?? []).toHaveLength(0);

  const defaultOut = await recordInboundMessage(svc, { from: phone, to: defaultSender, body: "STOP", messageSid: "SMin-212-default-stop" });
  expect(defaultOut).toMatchObject({ matched: true, optOut: true });

  const { data: custAfterDefault } = await svc.from("customers").select("sms_consent").eq("id", customerId).single();
  expect(custAfterDefault!.sms_consent).toBe(false);
});

test("recordInboundMessage STOP uses normalized outbound history before recency caps", async () => {
  const phone = "+13105550213";
  const defaultSender = "+15005551013";
  const { data: org } = await svc.from("organizations").insert({ name: "Old Outbound Org" }).select("id").single();
  const orgId = org!.id as string;
  await svc.from("messaging_config").insert({ org_id: orgId, sender: null });
  const { data: cust } = await svc.from("customers")
    .insert({ org_id: orgId, qbo_id: "c-old-outbound", name: "Acme", phone, sms_consent: true }).select("id").single();
  const customerId = cust!.id as string;
  await svc.from("text_messages").insert({
    org_id: orgId,
    customer_id: customerId,
    direction: "outbound",
    twilio_message_sid: "SMout-213-old-default",
    from_number: defaultSender,
    to_number: "(310) 555-0213",
    body: "ping",
    created_at: "2026-01-01T00:00:00Z",
  });

  const { data: noiseOrgs } = await svc.from("organizations")
    .insert(Array.from({ length: 101 }, (_, i) => ({ name: `Noisy Org ${i}` })))
    .select("id");
  await svc.from("text_messages").insert(noiseOrgs!.map((noiseOrgId, i) => ({
    org_id: noiseOrgId.id as string,
    direction: "outbound",
    twilio_message_sid: `SMout-213-noise-${i}`,
    from_number: defaultSender,
    to_number: `+13105559${String(i).padStart(3, "0")}`,
    body: "noise",
    created_at: `2026-02-01T00:${String(i % 60).padStart(2, "0")}:00Z`,
  })));

  const out = await recordInboundMessage(svc, { from: phone, to: defaultSender, body: "STOP", messageSid: "SMin-213-old-stop" });
  expect(out).toMatchObject({ matched: true, optOut: true });

  const { data: custAfter } = await svc.from("customers").select("sms_consent").eq("id", customerId).single();
  expect(custAfter!.sms_consent).toBe(false);
});

test("recordInboundMessage STOP resolves org from unique messaging service outbound history", async () => {
  const phone = "+13105550211";
  const inboundTo = "+15005551011";
  const { data: org } = await svc.from("organizations").insert({ name: "Messaging Service Org" }).select("id").single();
  const orgId = org!.id as string;
  await svc.from("messaging_config").insert({ org_id: orgId, messaging_service_sid: "MGunique211", sender: null });
  const { data: cust } = await svc.from("customers")
    .insert({ org_id: orgId, qbo_id: "c-mg-sender", name: "Acme", phone, sms_consent: true }).select("id").single();
  const customerId = cust!.id as string;
  await svc.from("text_messages").insert({
    org_id: orgId,
    customer_id: customerId,
    direction: "outbound",
    twilio_message_sid: "SMout-211-mg",
    from_number: null,
    to_number: phone,
    body: "ping",
  });

  const out = await recordInboundMessage(svc, { from: phone, to: inboundTo, body: "STOP", messageSid: "SMin-211-mg-stop" });
  expect(out).toMatchObject({ matched: true, optOut: true });

  const { data: custAfter } = await svc.from("customers").select("sms_consent").eq("id", customerId).single();
  expect(custAfter!.sms_consent).toBe(false);
});

test("recordInboundMessage routes by inventory from_number_last10 and skips outbound history", async () => {
  const phone = "+13105550220";
  const inventoryFrom = "+15005552220";
  const historyFrom = "+15005552229";

  const { data: orgA } = await svc.from("organizations").insert({ name: "Inventory Org A" }).select("id").single();
  const orgAId = orgA!.id as string;
  const { data: orgB } = await svc.from("organizations").insert({ name: "History Org B" }).select("id").single();
  const orgBId = orgB!.id as string;

  const { error: invErr } = await svc.from("sms_sender_inventory").insert({
    org_id: orgAId,
    from_number: inventoryFrom,
    status: "active",
  });
  expect(invErr).toBeNull();

  const { data: custA } = await svc.from("customers")
    .insert({ org_id: orgAId, qbo_id: "c-inv-a", name: "Acme A", phone, sms_consent: true }).select("id").single();
  const { data: custB } = await svc.from("customers")
    .insert({ org_id: orgBId, qbo_id: "c-hist-b", name: "Acme B", phone, sms_consent: true }).select("id").single();

  await svc.from("text_messages").insert({
    org_id: orgBId,
    customer_id: custB!.id,
    direction: "outbound",
    twilio_message_sid: "SMout-220-hist",
    from_number: historyFrom,
    to_number: phone,
    body: "ping",
  });

  const out = await recordInboundMessage(svc, {
    from: phone,
    to: inventoryFrom,
    body: "hello",
    messageSid: "SMin-220-inventory",
  });
  expect(out.matched).toBe(true);
  expect(out.optOut).toBe(false);

  const { data: rows } = await svc.from("text_messages")
    .select("org_id, customer_id")
    .eq("twilio_message_sid", "SMin-220-inventory");
  expect(rows).toHaveLength(1);
  expect(rows![0].org_id).toBe(orgAId);
  expect(rows![0].customer_id).toBe(custA!.id);
});

test("reassigned inventory From defers to unique persisted From history", async () => {
  const phone = "+13105550232";
  const movedFrom = "+15005552232";
  const { data: orgA } = await svc.from("organizations").insert({ name: "Former From Org" }).select("id").single();
  const orgAId = orgA!.id as string;
  const { data: orgB } = await svc.from("organizations").insert({ name: "New From Inventory Org" }).select("id").single();
  const orgBId = orgB!.id as string;

  const { error: invErr } = await svc.from("sms_sender_inventory").insert({
    org_id: orgBId, from_number: movedFrom, status: "active",
  });
  expect(invErr).toBeNull();

  const { data: custA } = await svc.from("customers")
    .insert({ org_id: orgAId, qbo_id: "c-from-a", name: "Former From A", phone, sms_consent: true }).select("id").single();
  await svc.from("customers")
    .insert({ org_id: orgBId, qbo_id: "c-from-b", name: "New From B", phone, sms_consent: true });

  await svc.from("text_messages").insert({
    org_id: orgAId, customer_id: custA!.id, direction: "outbound",
    twilio_message_sid: "SMout-232-former", from_number: movedFrom, to_number: phone, body: "ping",
  });

  const out = await recordInboundMessage(svc, {
    from: phone,
    to: movedFrom,
    body: "hello",
    messageSid: "SMin-232-reassigned-from",
  });
  expect(out.matched).toBe(true);
  const { data: rows } = await svc.from("text_messages")
    .select("org_id, customer_id").eq("twilio_message_sid", "SMin-232-reassigned-from");
  expect(rows).toHaveLength(1);
  expect(rows![0].org_id).toBe(orgAId);
  expect(rows![0].customer_id).toBe(custA!.id);
});

test("reassigned From with history in both orgs is treated as ambiguous", async () => {
  const phone = "+13105550233";
  const movedFrom = "+15005552233";
  const { data: orgA } = await svc.from("organizations").insert({ name: "Ambiguous Former From Org" }).select("id").single();
  const orgAId = orgA!.id as string;
  const { data: orgB } = await svc.from("organizations").insert({ name: "Ambiguous Current From Org" }).select("id").single();
  const orgBId = orgB!.id as string;

  const { error: invErr } = await svc.from("sms_sender_inventory").insert({
    org_id: orgBId, from_number: movedFrom, status: "active",
  });
  expect(invErr).toBeNull();

  const { data: custA } = await svc.from("customers")
    .insert({ org_id: orgAId, qbo_id: "c-from-ambig-a", name: "From Ambig A", phone, sms_consent: true }).select("id").single();
  const { data: custB } = await svc.from("customers")
    .insert({ org_id: orgBId, qbo_id: "c-from-ambig-b", name: "From Ambig B", phone, sms_consent: true }).select("id").single();

  await svc.from("text_messages").insert([
    {
      org_id: orgAId, customer_id: custA!.id, direction: "outbound",
      twilio_message_sid: "SMout-233-former", from_number: movedFrom, to_number: phone, body: "a",
    },
    {
      org_id: orgBId, customer_id: custB!.id, direction: "outbound",
      twilio_message_sid: "SMout-233-current", from_number: movedFrom, to_number: phone, body: "b",
    },
  ]);

  const out = await recordInboundMessage(svc, {
    from: phone,
    to: movedFrom,
    body: "hello",
    messageSid: "SMin-233-ambiguous-from",
  });
  expect(out.matched).toBe(false);
  const { data: rows } = await svc.from("text_messages")
    .select("id").eq("twilio_message_sid", "SMin-233-ambiguous-from");
  expect(rows ?? []).toHaveLength(0);
});

test("fallback SID inbound still matches unique direct-From history", async () => {
  const phone = "+13105550234";
  const inboundTo = "+15005552234";
  const fallbackSid = "MG" + "3".repeat(32);
  const { data: orgA } = await svc.from("organizations").insert({ name: "Fallback SID Inv Org" }).select("id").single();
  const orgAId = orgA!.id as string;
  const { data: orgB } = await svc.from("organizations").insert({ name: "Direct From Hist Org" }).select("id").single();
  const orgBId = orgB!.id as string;

  expect((await svc.from("sms_sender_inventory").insert({
    org_id: orgAId, messaging_service_sid: fallbackSid, status: "active",
  })).error).toBeNull();
  expect((await svc.from("sms_sender_inventory").insert({
    org_id: orgBId, from_number: inboundTo, status: "active",
  })).error).toBeNull();

  await svc.from("customers")
    .insert({ org_id: orgAId, qbo_id: "c-fbsid-from-a", name: "FB SID A", phone, sms_consent: true });
  const { data: custB } = await svc.from("customers")
    .insert({ org_id: orgBId, qbo_id: "c-fbsid-from-b", name: "Direct From B", phone, sms_consent: true }).select("id").single();

  await svc.from("text_messages").insert({
    org_id: orgBId, customer_id: custB!.id, direction: "outbound",
    twilio_message_sid: "SMout-234-from", from_number: inboundTo, to_number: phone, body: "ping",
  });

  const out = await recordInboundMessage(svc, {
    from: phone,
    to: inboundTo,
    body: "hello",
    messageSid: "SMin-234-fallback-sid-from",
    messagingServiceSid: fallbackSid,
    fallbackMessagingServiceSid: fallbackSid,
  });
  expect(out.matched).toBe(true);
  const { data: rows } = await svc.from("text_messages")
    .select("org_id, customer_id").eq("twilio_message_sid", "SMin-234-fallback-sid-from");
  expect(rows).toHaveLength(1);
  expect(rows![0].org_id).toBe(orgBId);
  expect(rows![0].customer_id).toBe(custB!.id);
});

test("fallback SID history conflicting with direct-From history is treated as ambiguous", async () => {
  const phone = "+13105550235";
  const inboundTo = "+15005552235";
  const fallbackSid = "MG" + "4".repeat(32);
  const { data: orgA } = await svc.from("organizations").insert({ name: "Conflict SID Hist Org" }).select("id").single();
  const orgAId = orgA!.id as string;
  const { data: orgB } = await svc.from("organizations").insert({ name: "Conflict From Hist Org" }).select("id").single();
  const orgBId = orgB!.id as string;

  expect((await svc.from("sms_sender_inventory").insert({
    org_id: orgAId, messaging_service_sid: fallbackSid, status: "active",
  })).error).toBeNull();
  expect((await svc.from("sms_sender_inventory").insert({
    org_id: orgBId, from_number: inboundTo, status: "active",
  })).error).toBeNull();

  const { data: custA } = await svc.from("customers")
    .insert({ org_id: orgAId, qbo_id: "c-sid-from-conf-a", name: "SID Hist A", phone, sms_consent: true }).select("id").single();
  const { data: custB } = await svc.from("customers")
    .insert({ org_id: orgBId, qbo_id: "c-sid-from-conf-b", name: "From Hist B", phone, sms_consent: true }).select("id").single();

  await svc.from("text_messages").insert([
    {
      org_id: orgAId, customer_id: custA!.id, direction: "outbound",
      twilio_message_sid: "SMout-235-sid", from_number: null,
      messaging_service_sid: fallbackSid, to_number: phone, body: "a",
    },
    {
      org_id: orgBId, customer_id: custB!.id, direction: "outbound",
      twilio_message_sid: "SMout-235-from", from_number: inboundTo, to_number: phone, body: "b",
    },
  ]);

  const out = await recordInboundMessage(svc, {
    from: phone,
    to: inboundTo,
    body: "hello",
    messageSid: "SMin-235-sid-from-conflict",
    messagingServiceSid: fallbackSid,
    fallbackMessagingServiceSid: fallbackSid,
  });
  expect(out.matched).toBe(false);
  const { data: rows } = await svc.from("text_messages")
    .select("id").eq("twilio_message_sid", "SMin-235-sid-from-conflict");
  expect(rows ?? []).toHaveLength(0);
});

test("retired From history wins over another org's null-From Messaging Service rows", async () => {
  const phone = "+13105550236";
  const retiredFrom = "+15005552236";
  const { data: orgA } = await svc.from("organizations").insert({ name: "Retired From Hist Org" }).select("id").single();
  const orgAId = orgA!.id as string;
  const { data: orgB } = await svc.from("organizations").insert({ name: "Null From MS Hist Org" }).select("id").single();
  const orgBId = orgB!.id as string;

  expect((await svc.from("sms_sender_inventory").insert({
    org_id: orgAId, from_number: retiredFrom, status: "disabled",
  })).error).toBeNull();

  const { data: custA } = await svc.from("customers")
    .insert({ org_id: orgAId, qbo_id: "c-ret-from-a", name: "Retired From A", phone, sms_consent: true }).select("id").single();
  const { data: custB } = await svc.from("customers")
    .insert({ org_id: orgBId, qbo_id: "c-ret-from-b", name: "MS Hist B", phone, sms_consent: true }).select("id").single();

  await svc.from("text_messages").insert([
    {
      org_id: orgAId, customer_id: custA!.id, direction: "outbound",
      twilio_message_sid: "SMout-236-from", from_number: retiredFrom, to_number: phone, body: "a",
    },
    {
      org_id: orgBId, customer_id: custB!.id, direction: "outbound",
      twilio_message_sid: "SMout-236-ms", from_number: null, to_number: phone, body: "b",
    },
  ]);

  const out = await recordInboundMessage(svc, {
    from: phone,
    to: retiredFrom,
    body: "hello",
    messageSid: "SMin-236-retired-from",
  });
  expect(out.matched).toBe(true);
  const { data: rows } = await svc.from("text_messages")
    .select("org_id, customer_id").eq("twilio_message_sid", "SMin-236-retired-from");
  expect(rows).toHaveLength(1);
  expect(rows![0].org_id).toBe(orgAId);
  expect(rows![0].customer_id).toBe(custA!.id);
});

test("inventory SID on fallback From defers to unique default-From history", async () => {
  const phone = "+13105550237";
  const fallbackFrom = "+15005552237";
  const inventorySid = "MG" + "5".repeat(32);
  const envFallbackSid = "MG" + "6".repeat(32);
  const { data: orgA } = await svc.from("organizations").insert({ name: "SID On Fallback From Org" }).select("id").single();
  const orgAId = orgA!.id as string;
  const { data: orgB } = await svc.from("organizations").insert({ name: "Default From Hist Org" }).select("id").single();
  const orgBId = orgB!.id as string;

  expect((await svc.from("sms_sender_inventory").insert({
    org_id: orgAId, messaging_service_sid: inventorySid, status: "active",
  })).error).toBeNull();

  await svc.from("customers")
    .insert({ org_id: orgAId, qbo_id: "c-sid-fbfrom-a", name: "SID A", phone, sms_consent: true });
  const { data: custB } = await svc.from("customers")
    .insert({ org_id: orgBId, qbo_id: "c-sid-fbfrom-b", name: "Default From B", phone, sms_consent: true }).select("id").single();

  await svc.from("text_messages").insert({
    org_id: orgBId, customer_id: custB!.id, direction: "outbound",
    twilio_message_sid: "SMout-237-from", from_number: fallbackFrom, to_number: phone, body: "ping",
  });

  const out = await recordInboundMessage(svc, {
    from: phone,
    to: fallbackFrom,
    body: "hello",
    messageSid: "SMin-237-sid-on-fallback-from",
    messagingServiceSid: inventorySid,
    fallbackFrom,
    fallbackMessagingServiceSid: envFallbackSid,
  });
  expect(out.matched).toBe(true);
  const { data: rows } = await svc.from("text_messages")
    .select("org_id, customer_id").eq("twilio_message_sid", "SMin-237-sid-on-fallback-from");
  expect(rows).toHaveLength(1);
  expect(rows![0].org_id).toBe(orgBId);
  expect(rows![0].customer_id).toBe(custB!.id);
});

test("recordInboundMessage routes by inventory MessagingServiceSid before history", async () => {
  const phone = "+13105550221";
  const inboundTo = "+15005552221";
  const { data: orgA } = await svc.from("organizations").insert({ name: "SID Inventory Org" }).select("id").single();
  const orgAId = orgA!.id as string;
  const { data: orgB } = await svc.from("organizations").insert({ name: "SID History Org" }).select("id").single();
  const orgBId = orgB!.id as string;

  const { error: invErr } = await svc.from("sms_sender_inventory").insert({
    org_id: orgAId,
    messaging_service_sid: "MG" + "a".repeat(32),
    status: "active",
  });
  expect(invErr).toBeNull();

  const { data: custA } = await svc.from("customers")
    .insert({ org_id: orgAId, qbo_id: "c-sid-a", name: "Acme SID A", phone, sms_consent: true }).select("id").single();
  const { data: custB } = await svc.from("customers")
    .insert({ org_id: orgBId, qbo_id: "c-sid-b", name: "Acme SID B", phone, sms_consent: true }).select("id").single();

  await svc.from("text_messages").insert([
    {
      org_id: orgAId, customer_id: custA!.id, direction: "outbound",
      twilio_message_sid: "SMout-221-a", from_number: null, to_number: phone, body: "a",
    },
    {
      org_id: orgBId, customer_id: custB!.id, direction: "outbound",
      twilio_message_sid: "SMout-221-b", from_number: null, to_number: phone, body: "b",
    },
  ]);

  const out = await recordInboundMessage(svc, {
    from: phone,
    to: inboundTo,
    body: "hello",
    messageSid: "SMin-221-sid",
    messagingServiceSid: "MG" + "a".repeat(32),
  });
  expect(out.matched).toBe(true);
  const { data: rows } = await svc.from("text_messages")
    .select("org_id, customer_id").eq("twilio_message_sid", "SMin-221-sid");
  expect(rows).toHaveLength(1);
  expect(rows![0].org_id).toBe(orgAId);
  expect(rows![0].customer_id).toBe(custA!.id);
});

test("inventory From overlapping the fallback sender defers to unique outbound history", async () => {
  const phone = "+13105550222";
  const sharedFrom = "+15005552222";
  const { data: orgA } = await svc.from("organizations").insert({ name: "Fallback Inventory Org" }).select("id").single();
  const orgAId = orgA!.id as string;
  const { data: orgB } = await svc.from("organizations").insert({ name: "Fallback History Org" }).select("id").single();
  const orgBId = orgB!.id as string;

  const { error: invErr } = await svc.from("sms_sender_inventory").insert({
    org_id: orgAId, from_number: sharedFrom, status: "active",
  });
  expect(invErr).toBeNull();

  const { data: custA } = await svc.from("customers")
    .insert({ org_id: orgAId, qbo_id: "c-fb-a", name: "Acme FB A", phone, sms_consent: true }).select("id").single();
  const { data: custB } = await svc.from("customers")
    .insert({ org_id: orgBId, qbo_id: "c-fb-b", name: "Acme FB B", phone, sms_consent: true }).select("id").single();
  expect(custA).toBeTruthy();

  await svc.from("text_messages").insert({
    org_id: orgBId, customer_id: custB!.id, direction: "outbound",
    twilio_message_sid: "SMout-222-hist", from_number: sharedFrom, to_number: phone, body: "ping",
  });

  const out = await recordInboundMessage(svc, {
    from: phone,
    to: sharedFrom,
    body: "hello",
    messageSid: "SMin-222-fallback",
    fallbackFrom: sharedFrom,
  });
  expect(out.matched).toBe(true);
  const { data: rows } = await svc.from("text_messages")
    .select("org_id, customer_id").eq("twilio_message_sid", "SMin-222-fallback");
  expect(rows).toHaveLength(1);
  expect(rows![0].org_id).toBe(orgBId);
  expect(rows![0].customer_id).toBe(custB!.id);
});

test("fallback From overlap ignores Messaging Service history from another org", async () => {
  const phone = "+13105550225";
  const sharedFrom = "+15005552225";
  const { data: orgA } = await svc.from("organizations").insert({ name: "Overlap Inv Org" }).select("id").single();
  const orgAId = orgA!.id as string;
  const { data: orgB } = await svc.from("organizations").insert({ name: "Overlap MS Hist Org" }).select("id").single();
  const orgBId = orgB!.id as string;

  const { error: invErr } = await svc.from("sms_sender_inventory").insert({
    org_id: orgAId, from_number: sharedFrom, status: "active",
  });
  expect(invErr).toBeNull();

  await svc.from("customers").insert({
    org_id: orgAId, qbo_id: "c-ov-a", name: "Overlap A", phone, sms_consent: true,
  });
  const { data: custB } = await svc.from("customers")
    .insert({ org_id: orgBId, qbo_id: "c-ov-b", name: "Overlap B", phone, sms_consent: true }).select("id").single();

  await svc.from("text_messages").insert({
    org_id: orgBId, customer_id: custB!.id, direction: "outbound",
    twilio_message_sid: "SMout-225-ms", from_number: null, to_number: phone, body: "ping",
  });

  const out = await recordInboundMessage(svc, {
    from: phone,
    to: sharedFrom,
    body: "hello",
    messageSid: "SMin-225-ms-hist",
    fallbackFrom: sharedFrom,
  });
  expect(out.matched).toBe(false);
  const { data: rows } = await svc.from("text_messages")
    .select("id").eq("twilio_message_sid", "SMin-225-ms-hist");
  expect(rows ?? []).toHaveLength(0);
});

test("inventory SID overlapping the fallback SID defers to unique outbound history", async () => {
  const phone = "+13105550223";
  const inboundTo = "+15005552223";
  const sharedSid = "MG" + "b".repeat(32);
  const { data: orgA } = await svc.from("organizations").insert({ name: "Fallback SID Inventory Org" }).select("id").single();
  const orgAId = orgA!.id as string;
  const { data: orgB } = await svc.from("organizations").insert({ name: "Fallback SID History Org" }).select("id").single();
  const orgBId = orgB!.id as string;

  const { error: invErr } = await svc.from("sms_sender_inventory").insert({
    org_id: orgAId, messaging_service_sid: `  ${sharedSid}  `, status: "active",
  });
  expect(invErr).toBeNull();

  const { data: custA } = await svc.from("customers")
    .insert({ org_id: orgAId, qbo_id: "c-fbsid-a", name: "Acme FB SID A", phone, sms_consent: true }).select("id").single();
  const { data: custB } = await svc.from("customers")
    .insert({ org_id: orgBId, qbo_id: "c-fbsid-b", name: "Acme FB SID B", phone, sms_consent: true }).select("id").single();
  expect(custA).toBeTruthy();

  await svc.from("text_messages").insert({
    org_id: orgBId, customer_id: custB!.id, direction: "outbound",
    twilio_message_sid: "SMout-223-hist", from_number: null,
    messaging_service_sid: sharedSid, to_number: phone, body: "ping",
  });

  const out = await recordInboundMessage(svc, {
    from: phone,
    to: inboundTo,
    body: "hello",
    messageSid: "SMin-223-fallback-sid",
    messagingServiceSid: sharedSid,
    fallbackMessagingServiceSid: sharedSid,
  });
  expect(out.matched).toBe(true);
  const { data: rows } = await svc.from("text_messages")
    .select("org_id, customer_id").eq("twilio_message_sid", "SMin-223-fallback-sid");
  expect(rows).toHaveLength(1);
  expect(rows![0].org_id).toBe(orgBId);
  expect(rows![0].customer_id).toBe(custB!.id);
});

test("fallback SID history ignores another org's Messaging Service sends", async () => {
  const phone = "+13105550226";
  const inboundTo = "+15005552226";
  const fallbackSid = "MG" + "d".repeat(32);
  const otherSid = "MG" + "e".repeat(32);
  const { data: orgA } = await svc.from("organizations").insert({ name: "Other SID Hist Org" }).select("id").single();
  const orgAId = orgA!.id as string;
  const { data: orgB } = await svc.from("organizations").insert({ name: "Fallback SID Hist Org" }).select("id").single();
  const orgBId = orgB!.id as string;

  const { error: invErr } = await svc.from("sms_sender_inventory").insert({
    org_id: orgAId, messaging_service_sid: fallbackSid, status: "active",
  });
  expect(invErr).toBeNull();

  const { data: custA } = await svc.from("customers")
    .insert({ org_id: orgAId, qbo_id: "c-sidmix-a", name: "Mix A", phone, sms_consent: true }).select("id").single();
  const { data: custB } = await svc.from("customers")
    .insert({ org_id: orgBId, qbo_id: "c-sidmix-b", name: "Mix B", phone, sms_consent: true }).select("id").single();

  await svc.from("text_messages").insert([
    {
      org_id: orgAId, customer_id: custA!.id, direction: "outbound",
      twilio_message_sid: "SMout-226-other", from_number: null,
      messaging_service_sid: otherSid, to_number: phone, body: "a",
    },
    {
      org_id: orgBId, customer_id: custB!.id, direction: "outbound",
      twilio_message_sid: "SMout-226-fb", from_number: null,
      messaging_service_sid: fallbackSid, to_number: phone, body: "b",
    },
  ]);

  const out = await recordInboundMessage(svc, {
    from: phone,
    to: inboundTo,
    body: "hello",
    messageSid: "SMin-226-sid-filter",
    messagingServiceSid: fallbackSid,
    fallbackMessagingServiceSid: fallbackSid,
  });
  expect(out.matched).toBe(true);
  const { data: rows } = await svc.from("text_messages")
    .select("org_id, customer_id").eq("twilio_message_sid", "SMin-226-sid-filter");
  expect(rows).toHaveLength(1);
  expect(rows![0].org_id).toBe(orgBId);
  expect(rows![0].customer_id).toBe(custB!.id);
});

test("recordInboundMessage matches inventory SID stored with surrounding whitespace", async () => {
  const phone = "+13105550224";
  const inboundTo = "+15005552224";
  const sid = "MG" + "c".repeat(32);
  const { data: org } = await svc.from("organizations").insert({ name: "Padded SID Org" }).select("id").single();
  const orgId = org!.id as string;
  const { error: invErr } = await svc.from("sms_sender_inventory").insert({
    org_id: orgId, messaging_service_sid: ` ${sid} `, status: "active",
  });
  expect(invErr).toBeNull();
  const { data: cust } = await svc.from("customers")
    .insert({ org_id: orgId, qbo_id: "c-pad-sid", name: "Padded SID Co", phone, sms_consent: true }).select("id").single();

  const out = await recordInboundMessage(svc, {
    from: phone,
    to: inboundTo,
    body: "hello",
    messageSid: "SMin-224-padded-sid",
    messagingServiceSid: sid,
  });
  expect(out.matched).toBe(true);
  const { data: rows } = await svc.from("text_messages")
    .select("org_id, customer_id").eq("twilio_message_sid", "SMin-224-padded-sid");
  expect(rows).toHaveLength(1);
  expect(rows![0].org_id).toBe(orgId);
  expect(rows![0].customer_id).toBe(cust!.id);
});

test("reassigned inventory SID defers to unique persisted SID history", async () => {
  const phone = "+13105550229";
  const inboundTo = "+15005552229";
  const movedSid = "MG" + "9".repeat(32);
  const { data: orgA } = await svc.from("organizations").insert({ name: "Former SID Org" }).select("id").single();
  const orgAId = orgA!.id as string;
  const { data: orgB } = await svc.from("organizations").insert({ name: "New SID Inventory Org" }).select("id").single();
  const orgBId = orgB!.id as string;

  const { error: invErr } = await svc.from("sms_sender_inventory").insert({
    org_id: orgBId, messaging_service_sid: movedSid, status: "active",
  });
  expect(invErr).toBeNull();

  const { data: custA } = await svc.from("customers")
    .insert({ org_id: orgAId, qbo_id: "c-moved-a", name: "Former A", phone, sms_consent: true }).select("id").single();
  await svc.from("customers")
    .insert({ org_id: orgBId, qbo_id: "c-moved-b", name: "New B", phone, sms_consent: true });

  await svc.from("text_messages").insert({
    org_id: orgAId, customer_id: custA!.id, direction: "outbound",
    twilio_message_sid: "SMout-229-former", from_number: null,
    messaging_service_sid: movedSid, to_number: phone, body: "ping",
  });

  const out = await recordInboundMessage(svc, {
    from: phone,
    to: inboundTo,
    body: "hello",
    messageSid: "SMin-229-reassigned",
    messagingServiceSid: movedSid,
  });
  expect(out.matched).toBe(true);
  const { data: rows } = await svc.from("text_messages")
    .select("org_id, customer_id").eq("twilio_message_sid", "SMin-229-reassigned");
  expect(rows).toHaveLength(1);
  expect(rows![0].org_id).toBe(orgAId);
  expect(rows![0].customer_id).toBe(custA!.id);
});

test("fallback SID replies still match pre-migration null-SID outbound history", async () => {
  const phone = "+13105550227";
  const inboundTo = "+15005552227";
  const fallbackSid = "MG" + "f".repeat(32);
  const { data: orgA } = await svc.from("organizations").insert({ name: "Legacy SID Inventory Org" }).select("id").single();
  const orgAId = orgA!.id as string;
  const { data: orgB } = await svc.from("organizations").insert({ name: "Legacy SID History Org" }).select("id").single();
  const orgBId = orgB!.id as string;

  const { error: invErr } = await svc.from("sms_sender_inventory").insert({
    org_id: orgAId, messaging_service_sid: fallbackSid, status: "active",
  });
  expect(invErr).toBeNull();

  await svc.from("customers")
    .insert({ org_id: orgAId, qbo_id: "c-legacy-a", name: "Legacy A", phone, sms_consent: true });
  const { data: custB } = await svc.from("customers")
    .insert({ org_id: orgBId, qbo_id: "c-legacy-b", name: "Legacy B", phone, sms_consent: true }).select("id").single();

  await svc.from("text_messages").insert({
    org_id: orgBId, customer_id: custB!.id, direction: "outbound",
    twilio_message_sid: "SMout-227-legacy", from_number: null, to_number: phone, body: "ping",
  });

  const out = await recordInboundMessage(svc, {
    from: phone,
    to: inboundTo,
    body: "hello",
    messageSid: "SMin-227-legacy-sid",
    messagingServiceSid: fallbackSid,
    fallbackMessagingServiceSid: fallbackSid,
  });
  expect(out.matched).toBe(true);
  const { data: rows } = await svc.from("text_messages")
    .select("org_id, customer_id").eq("twilio_message_sid", "SMin-227-legacy-sid");
  expect(rows).toHaveLength(1);
  expect(rows![0].org_id).toBe(orgBId);
  expect(rows![0].customer_id).toBe(custB!.id);
});

test("retired inventory SID still routes via persisted outbound history", async () => {
  const phone = "+13105550228";
  const inboundTo = "+15005552228";
  const retiredSid = "MG" + "7".repeat(32);
  const otherSid = "MG" + "8".repeat(32);
  const { data: orgA } = await svc.from("organizations").insert({ name: "Retired SID Org" }).select("id").single();
  const orgAId = orgA!.id as string;
  const { data: orgB } = await svc.from("organizations").insert({ name: "Other SID Org" }).select("id").single();
  const orgBId = orgB!.id as string;

  const { error: invErr } = await svc.from("sms_sender_inventory").insert({
    org_id: orgAId, messaging_service_sid: retiredSid, status: "disabled",
  });
  expect(invErr).toBeNull();

  const { data: custA } = await svc.from("customers")
    .insert({ org_id: orgAId, qbo_id: "c-ret-a", name: "Retired A", phone, sms_consent: true }).select("id").single();
  const { data: custB } = await svc.from("customers")
    .insert({ org_id: orgBId, qbo_id: "c-ret-b", name: "Other B", phone, sms_consent: true }).select("id").single();

  await svc.from("text_messages").insert([
    {
      org_id: orgAId, customer_id: custA!.id, direction: "outbound",
      twilio_message_sid: "SMout-228-retired", from_number: null,
      messaging_service_sid: retiredSid, to_number: phone, body: "a",
    },
    {
      org_id: orgBId, customer_id: custB!.id, direction: "outbound",
      twilio_message_sid: "SMout-228-other", from_number: null,
      messaging_service_sid: otherSid, to_number: phone, body: "b",
    },
  ]);

  const out = await recordInboundMessage(svc, {
    from: phone,
    to: inboundTo,
    body: "hello",
    messageSid: "SMin-228-retired-sid",
    messagingServiceSid: retiredSid,
  });
  expect(out.matched).toBe(true);
  const { data: rows } = await svc.from("text_messages")
    .select("org_id, customer_id").eq("twilio_message_sid", "SMin-228-retired-sid");
  expect(rows).toHaveLength(1);
  expect(rows![0].org_id).toBe(orgAId);
  expect(rows![0].customer_id).toBe(custA!.id);
});

test("reassigned SID with history in both orgs is treated as ambiguous", async () => {
  const phone = "+13105550231";
  const inboundTo = "+15005552231";
  const movedSid = "MG" + "1".repeat(32);
  const { data: orgA } = await svc.from("organizations").insert({ name: "Ambiguous Former SID Org" }).select("id").single();
  const orgAId = orgA!.id as string;
  const { data: orgB } = await svc.from("organizations").insert({ name: "Ambiguous Current SID Org" }).select("id").single();
  const orgBId = orgB!.id as string;

  const { error: invErr } = await svc.from("sms_sender_inventory").insert({
    org_id: orgBId, messaging_service_sid: movedSid, status: "active",
  });
  expect(invErr).toBeNull();

  const { data: custA } = await svc.from("customers")
    .insert({ org_id: orgAId, qbo_id: "c-ambig-a", name: "Ambig A", phone, sms_consent: true }).select("id").single();
  const { data: custB } = await svc.from("customers")
    .insert({ org_id: orgBId, qbo_id: "c-ambig-b", name: "Ambig B", phone, sms_consent: true }).select("id").single();

  await svc.from("text_messages").insert([
    {
      org_id: orgAId, customer_id: custA!.id, direction: "outbound",
      twilio_message_sid: "SMout-231-former", from_number: null,
      messaging_service_sid: movedSid, to_number: phone, body: "a",
    },
    {
      org_id: orgBId, customer_id: custB!.id, direction: "outbound",
      twilio_message_sid: "SMout-231-current", from_number: null,
      messaging_service_sid: movedSid, to_number: phone, body: "b",
    },
  ]);

  const out = await recordInboundMessage(svc, {
    from: phone,
    to: inboundTo,
    body: "hello",
    messageSid: "SMin-231-ambiguous-sid",
    messagingServiceSid: movedSid,
  });
  expect(out.matched).toBe(false);
  const { data: rows } = await svc.from("text_messages")
    .select("id").eq("twilio_message_sid", "SMin-231-ambiguous-sid");
  expect(rows ?? []).toHaveLength(0);
});

test("unused non-fallback SID does not steal another org's pre-migration history", async () => {
  const phone = "+13105550230";
  const inboundTo = "+15005552230";
  const unusedSid = "MG" + "1".repeat(32);
  const { data: orgA } = await svc.from("organizations").insert({ name: "Unused SID Org" }).select("id").single();
  const orgAId = orgA!.id as string;
  const { data: orgB } = await svc.from("organizations").insert({ name: "Legacy Other Org" }).select("id").single();
  const orgBId = orgB!.id as string;

  await svc.from("customers")
    .insert({ org_id: orgAId, qbo_id: "c-unused-a", name: "Unused A", phone, sms_consent: true });
  const { data: custB } = await svc.from("customers")
    .insert({ org_id: orgBId, qbo_id: "c-unused-b", name: "Legacy B", phone, sms_consent: true }).select("id").single();

  await svc.from("text_messages").insert({
    org_id: orgBId, customer_id: custB!.id, direction: "outbound",
    twilio_message_sid: "SMout-230-legacy", from_number: null, to_number: phone, body: "ping",
  });

  const out = await recordInboundMessage(svc, {
    from: phone,
    to: inboundTo,
    body: "hello",
    messageSid: "SMin-230-unused-sid",
    messagingServiceSid: unusedSid,
    fallbackMessagingServiceSid: "MG" + "2".repeat(32),
  });
  expect(out.matched).toBe(false);
  const { data: rows } = await svc.from("text_messages")
    .select("id").eq("twilio_message_sid", "SMin-230-unused-sid");
  expect(rows ?? []).toHaveLength(0);
});

test("recordInboundMessage treats replayed MessageSid as idempotent", async () => {
  const { inboundTo } = await seedCustomerWithOutbound("+13105550209", "SMout-209", true);
  const args = { from: "+13105550209", to: inboundTo, body: "hello", messageSid: "SMin-209-idempotent" };

  const first = await recordInboundMessage(svc, args);
  const second = await recordInboundMessage(svc, args);

  expect(first).toMatchObject({ matched: true, optOut: false });
  expect(second).toMatchObject({ matched: true, optOut: false });
  const { data: rows } = await svc.from("text_messages").select("id").eq("twilio_message_sid", args.messageSid);
  expect(rows ?? []).toHaveLength(1);
});
