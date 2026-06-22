import { expect, test, vi } from "vitest";
import { serviceClient } from "./helpers";
import { resolveSender, sendInvoiceText, normalizePhone, type MessagingDeps } from "../app/lib/twilio-messaging.server";

const svc = serviceClient();
const twilio = { accountSid: "AC1", authToken: "tok" };

async function seed(consent: boolean, phone: string | null) {
  const { data: org } = await svc.from("organizations").insert({ name: "SMS Org" }).select("id").single();
  const orgId = org!.id as string;
  const { data: cust } = await svc.from("customers")
    .insert({ org_id: orgId, qbo_id: "c1", name: "Acme", phone, sms_consent: consent }).select("id").single();
  const { data: inv } = await svc.from("invoices")
    .insert({ org_id: orgId, qbo_id: "i1", qbo_doc_number: "1042", customer_id: cust!.id, balance: 100 }).select("id").single();
  return { orgId, customerId: cust!.id as string, invoiceId: inv!.id as string };
}

function jsonResponse(body: unknown, status = 201) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
function deps(fetchFn: any, defaultSender: any = { from: "+15005550006" }): MessagingDeps {
  return { fetchFn, service: svc, twilio, defaultSender, statusCallback: null };
}

test("normalizePhone reduces to the last 10 digits", () => {
  expect(normalizePhone("+1 (229) 555-0101")).toBe("2295550101");
  expect(normalizePhone(null)).toBe("");
});

test("resolveSender prefers messaging_config over the env default", async () => {
  const { orgId } = await seed(true, "+12295550101");
  // no messaging_config row -> env default
  expect(await resolveSender(svc, orgId, { from: "+1999" })).toEqual({ from: "+1999" });
  await svc.from("messaging_config").insert({ org_id: orgId, messaging_service_sid: "MG7" });
  expect(await resolveSender(svc, orgId, { from: "+1999" })).toEqual({ messagingServiceSid: "MG7" });
});

test("sendInvoiceText sends and inserts an outbound row when the customer consented", async () => {
  const { orgId, customerId, invoiceId } = await seed(true, "+12295550101");
  const fetchFn = vi.fn(async () => jsonResponse({ sid: "SM10", status: "queued" }));
  const res = await sendInvoiceText(deps(fetchFn), { orgId, invoiceId, userId: "00000000-0000-0000-0000-000000000000", body: "Past due" });
  expect(res.sid).toBe("SM10");
  expect(fetchFn).toHaveBeenCalledOnce();
  const { data: msg } = await svc.from("text_messages").select("direction, twilio_message_sid, to_number, customer_id, invoice_id, body")
    .eq("twilio_message_sid", "SM10").single();
  expect(msg!.direction).toBe("outbound");
  expect(msg!.to_number).toBe("+12295550101");
  expect(msg!.customer_id).toBe(customerId);
  expect(msg!.invoice_id).toBe(invoiceId);
  expect(msg!.body).toBe("Past due");
});

test("sendInvoiceText refuses to send without consent (no Twilio call, no row)", async () => {
  const { orgId, invoiceId } = await seed(false, "+12295550101");
  const fetchFn = vi.fn();
  await expect(sendInvoiceText(deps(fetchFn), { orgId, invoiceId, userId: "00000000-0000-0000-0000-000000000000", body: "x" }))
    .rejects.toThrow(/consent/i);
  expect(fetchFn).not.toHaveBeenCalled();
});

test("sendInvoiceText refuses when the customer has no phone", async () => {
  const { orgId, invoiceId } = await seed(true, null);
  const fetchFn = vi.fn();
  await expect(sendInvoiceText(deps(fetchFn), { orgId, invoiceId, userId: "00000000-0000-0000-0000-000000000000", body: "x" }))
    .rejects.toThrow(/phone/i);
  expect(fetchFn).not.toHaveBeenCalled();
});
