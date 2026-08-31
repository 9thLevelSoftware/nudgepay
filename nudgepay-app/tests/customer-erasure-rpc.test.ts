import { expect, test } from "vitest";
import { makeUserClient, serviceClient } from "./helpers";
import { ERASED_CUSTOMER_NAME } from "../app/lib/customer-erasure";

test("erase_customer_pii redacts PII, blocks JWT, and freezes QBO name restore", async () => {
  const svc = serviceClient();
  const owner = await makeUserClient(`erase-own-${Math.random()}@example.com`);
  const member = await makeUserClient(`erase-mem-${Math.random()}@example.com`);
  const { data: org, error: orgErr } = await svc.from("organizations")
    .insert({ name: "Erase Co" }).select("id").single();
  expect(orgErr).toBeNull();
  const orgId = org!.id as string;
  const { error: memErr } = await svc.from("memberships").insert([
    { org_id: orgId, user_id: owner.userId, role: "owner" },
    { org_id: orgId, user_id: member.userId, role: "member" },
  ]);
  expect(memErr).toBeNull();
  const qboId = `c-${Math.random()}`;
  const { data: cust, error: custErr } = await svc.from("customers").insert({
    org_id: orgId, name: "Acme Heating", email: "ap@acme.test", phone: "+15555550100",
    notes: "secret note", qbo_id: qboId,
  }).select("id").single();
  expect(custErr).toBeNull();
  const customerId = cust!.id as string;
  const { error: smsErr } = await svc.from("text_messages").insert({
    org_id: orgId, customer_id: customerId, direction: "outbound",
    to_number: "+15555550100", body: "please pay",
  });
  expect(smsErr).toBeNull();
  const { error: emailErr } = await svc.from("email_messages").insert({
    org_id: orgId, customer_id: customerId, direction: "outbound",
    status: "sent", to_address: "ap@acme.test", subject: "Invoice", body: "please pay",
  });
  expect(emailErr).toBeNull();
  const { error: logErr } = await svc.from("contact_logs").insert({
    org_id: orgId, customer_id: customerId, user_id: owner.userId,
    method: "call", notes: "spoke with AP",
  });
  expect(logErr).toBeNull();
  const { data: inv } = await svc.from("invoices").insert({
    org_id: orgId, customer_id: customerId, qbo_id: `inv-${Math.random()}`,
    amount: 100, balance: 100,
  }).select("id").single();
  const { error: legacySmsErr } = await svc.from("text_messages").insert({
    org_id: orgId, invoice_id: inv!.id, customer_id: null, direction: "outbound",
    to_number: "+15555550100", body: "legacy invoice ping",
  });
  expect(legacySmsErr).toBeNull();

  const jwt = await member.client.rpc("erase_customer_pii", {
    p_org_id: orgId,
    p_customer_id: customerId,
    p_erased_by: member.userId,
    p_customer_name: "Acme Heating",
  });
  expect(jwt.error).not.toBeNull();

  const { error: memberRpc } = await svc.rpc("erase_customer_pii", {
    p_org_id: orgId,
    p_customer_id: customerId,
    p_erased_by: member.userId,
    p_customer_name: "Acme Heating",
  });
  expect(memberRpc).not.toBeNull();

  const { error: nameRpc } = await svc.rpc("erase_customer_pii", {
    p_org_id: orgId,
    p_customer_id: customerId,
    p_erased_by: owner.userId,
    p_customer_name: "Wrong",
  });
  expect(nameRpc).not.toBeNull();

  const { error: rpcErr } = await svc.rpc("erase_customer_pii", {
    p_org_id: orgId,
    p_customer_id: customerId,
    p_erased_by: owner.userId,
    p_customer_name: "Acme Heating",
  });
  expect(rpcErr).toBeNull();

  const { data: after } = await svc.from("customers")
    .select("name, email, phone, notes, erased_at, do_not_call, do_not_text, do_not_email, sms_consent")
    .eq("id", customerId).single();
  expect(after).toMatchObject({
    name: ERASED_CUSTOMER_NAME,
    email: null,
    phone: null,
    notes: null,
    do_not_call: true,
    do_not_text: true,
    do_not_email: true,
    sms_consent: false,
  });
  expect(after!.erased_at).toBeTruthy();

  const { data: sms } = await svc.from("text_messages")
    .select("body, to_number").eq("org_id", orgId);
  expect(sms).toHaveLength(2);
  expect(sms!.every((row) => row.body === "[erased]" && row.to_number == null)).toBe(true);
  const { data: email } = await svc.from("email_messages")
    .select("body, subject, to_address").eq("customer_id", customerId).single();
  expect(email).toEqual({ body: "[erased]", subject: "[erased]", to_address: null });
  const { data: log } = await svc.from("contact_logs")
    .select("notes").eq("customer_id", customerId).single();
  expect(log).toEqual({ notes: null });

  const { error: restoreErr } = await svc.from("customers")
    .update({ name: "Acme Heating", email: "ap@acme.test", phone: "+15555550100" })
    .eq("id", customerId);
  expect(restoreErr).toBeNull();
  const { data: frozen } = await svc.from("customers")
    .select("name, email, phone").eq("id", customerId).single();
  expect(frozen).toMatchObject({
    name: ERASED_CUSTOMER_NAME,
    email: null,
    phone: null,
  });

  const { error: again } = await svc.rpc("erase_customer_pii", {
    p_org_id: orgId,
    p_customer_id: customerId,
    p_erased_by: owner.userId,
    p_customer_name: ERASED_CUSTOMER_NAME,
  });
  expect(again).not.toBeNull();

  const { error: newLog } = await svc.from("contact_logs").insert({
    org_id: orgId, customer_id: customerId, user_id: owner.userId,
    method: "call", notes: "should not stick",
  });
  expect(newLog).not.toBeNull();
});
