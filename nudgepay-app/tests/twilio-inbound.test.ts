import { expect, test } from "vitest";
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
  await svc.from("messaging_config").insert({ org_id: orgId, sender: inboundTo });
  const { data: cust } = await svc.from("customers")
    .insert({ org_id: orgId, qbo_id: "c1", name: "Acme", phone, sms_consent: consent }).select("id").single();
  const { data: inv } = await svc.from("invoices")
    .insert({ org_id: orgId, qbo_id: "i1", customer_id: cust!.id, balance: 50 }).select("id").single();
  await svc.from("text_messages").insert({
    org_id: orgId, invoice_id: inv!.id, customer_id: cust!.id, direction: "outbound",
    twilio_message_sid: outboundSid, to_number: phone, body: "ping",
  });
  return { orgId, customerId: cust!.id as string, invoiceId: inv!.id as string, inboundTo };
}

test("recordInboundMessage matches by phone and threads to the latest outbound invoice", async () => {
  const { customerId, invoiceId, inboundTo } = await seedCustomerWithOutbound("+13105550201", "SMout-201");
  const out = await recordInboundMessage(svc, { from: "(310) 555-0201", to: inboundTo, body: "ok thanks", messageSid: "SMin1-201" });
  expect(out).toEqual({ matched: true, optOut: false });
  const { data: msg } = await svc.from("text_messages").select("direction, customer_id, invoice_id, body")
    .eq("twilio_message_sid", "SMin1-201").single();
  expect(msg!.direction).toBe("inbound");
  expect(msg!.customer_id).toBe(customerId);
  expect(msg!.invoice_id).toBe(invoiceId);
  expect(msg!.body).toBe("ok thanks");
});

test("recordInboundMessage STOP flips sms_consent off", async () => {
  const { customerId, inboundTo } = await seedCustomerWithOutbound("+13105550202", "SMout-202", true);
  const out = await recordInboundMessage(svc, { from: "+13105550202", to: inboundTo, body: "STOP", messageSid: "SMin2-202" });
  expect(out.optOut).toBe(true);
  const { data: cust } = await svc.from("customers").select("sms_consent").eq("id", customerId).single();
  expect(cust!.sms_consent).toBe(false);
});

test("recordInboundMessage START re-enables sms_consent", async () => {
  const { customerId, inboundTo } = await seedCustomerWithOutbound("+13105550203", "SMout-203", false);
  await recordInboundMessage(svc, { from: "+13105550203", to: inboundTo, body: "START", messageSid: "SMin3-203" });
  const { data: cust } = await svc.from("customers").select("sms_consent").eq("id", customerId).single();
  expect(cust!.sms_consent).toBe(true);
});

test("recordInboundMessage returns matched:false for an unknown number (stores nothing)", async () => {
  const out = await recordInboundMessage(svc, { from: "+13105559999", to: "+15005550006", body: "hello", messageSid: "SMin4-9999" });
  expect(out).toEqual({ matched: false, optOut: false });
  const { data } = await svc.from("text_messages").select("id").eq("twilio_message_sid", "SMin4-9999");
  expect(data!.length).toBe(0);
});

test("updateMessageStatus updates status and error_code by sid", async () => {
  await seedCustomerWithOutbound("+13105550205", "SMout-205");
  await updateMessageStatus(svc, { messageSid: "SMout-205", status: "delivered", errorCode: null });
  const { data } = await svc.from("text_messages").select("status, error_code").eq("twilio_message_sid", "SMout-205").single();
  expect(data!.status).toBe("delivered");
  expect(data!.error_code).toBeNull();
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
  expect(out).toEqual({ matched: true, optOut: true });

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
  expect(out).toEqual({ matched: false, optOut: false });

  const { data: cust } = await svc.from("customers").select("sms_consent").eq("id", customerId).single();
  expect(cust!.sms_consent).toBe(true);
  const { data: rows } = await svc.from("text_messages").select("id").eq("twilio_message_sid", "SMin-208-unconfigured-to");
  expect(rows ?? []).toHaveLength(0);
});

test("recordInboundMessage treats replayed MessageSid as idempotent", async () => {
  const { inboundTo } = await seedCustomerWithOutbound("+13105550209", "SMout-209", true);
  const args = { from: "+13105550209", to: inboundTo, body: "hello", messageSid: "SMin-209-idempotent" };

  const first = await recordInboundMessage(svc, args);
  const second = await recordInboundMessage(svc, args);

  expect(first).toEqual({ matched: true, optOut: false });
  expect(second).toEqual({ matched: true, optOut: false });
  const { data: rows } = await svc.from("text_messages").select("id").eq("twilio_message_sid", args.messageSid);
  expect(rows ?? []).toHaveLength(1);
});
