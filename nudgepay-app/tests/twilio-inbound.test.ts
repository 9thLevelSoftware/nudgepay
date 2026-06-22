import { expect, test } from "vitest";
import { serviceClient } from "./helpers";
import { recordInboundMessage, updateMessageStatus } from "../app/lib/twilio-messaging.server";

const svc = serviceClient();

// Each test creates its own org and asserts only on ids belonging to that org.
// No global truncate — isolation is achieved through unique phone numbers and
// org-scoped lookups, matching the pattern used in twilio-send.test.ts and
// qbo-sync.test.ts. Phones use the +1310555XXXX range which no other file uses.

async function seedCustomerWithOutbound(phone: string, outboundSid: string, consent = true) {
  const { data: org } = await svc.from("organizations").insert({ name: "Inbound Org" }).select("id").single();
  const orgId = org!.id as string;
  const { data: cust } = await svc.from("customers")
    .insert({ org_id: orgId, qbo_id: "c1", name: "Acme", phone, sms_consent: consent }).select("id").single();
  const { data: inv } = await svc.from("invoices")
    .insert({ org_id: orgId, qbo_id: "i1", customer_id: cust!.id, balance: 50 }).select("id").single();
  await svc.from("text_messages").insert({
    org_id: orgId, invoice_id: inv!.id, customer_id: cust!.id, direction: "outbound",
    twilio_message_sid: outboundSid, to_number: phone, body: "ping",
  });
  return { orgId, customerId: cust!.id as string, invoiceId: inv!.id as string };
}

test("recordInboundMessage matches by phone and threads to the latest outbound invoice", async () => {
  const { customerId, invoiceId } = await seedCustomerWithOutbound("+13105550201", "SMout-201");
  const out = await recordInboundMessage(svc, { from: "(310) 555-0201", to: "+15005550006", body: "ok thanks", messageSid: "SMin1-201" });
  expect(out).toEqual({ matched: true, optOut: false });
  const { data: msg } = await svc.from("text_messages").select("direction, customer_id, invoice_id, body")
    .eq("twilio_message_sid", "SMin1-201").single();
  expect(msg!.direction).toBe("inbound");
  expect(msg!.customer_id).toBe(customerId);
  expect(msg!.invoice_id).toBe(invoiceId);
  expect(msg!.body).toBe("ok thanks");
});

test("recordInboundMessage STOP flips sms_consent off", async () => {
  const { customerId } = await seedCustomerWithOutbound("+13105550202", "SMout-202", true);
  const out = await recordInboundMessage(svc, { from: "+13105550202", to: "+15005550006", body: "STOP", messageSid: "SMin2-202" });
  expect(out.optOut).toBe(true);
  const { data: cust } = await svc.from("customers").select("sms_consent").eq("id", customerId).single();
  expect(cust!.sms_consent).toBe(false);
});

test("recordInboundMessage START re-enables sms_consent", async () => {
  const { customerId } = await seedCustomerWithOutbound("+13105550203", "SMout-203", false);
  await recordInboundMessage(svc, { from: "+13105550203", to: "+15005550006", body: "START", messageSid: "SMin3-203" });
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
