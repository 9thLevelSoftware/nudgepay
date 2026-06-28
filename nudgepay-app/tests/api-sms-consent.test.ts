import { expect, test } from "vitest";
import { serviceClient, makeUserClient } from "./helpers";

// Mirrors the RLS path the /api/sms-consent action relies on: a member updates
// sms_consent on an own-org customer (resolved via an own-org invoice), and a
// member of another org cannot change it.
test("a member toggles sms_consent on an own-org customer via RLS", async () => {
  const svc = serviceClient();
  const { data: org } = await svc.from("organizations").insert({ name: "Consent Org A" }).select("id").single();
  const orgId = org!.id;
  const { data: cust } = await svc.from("customers")
    .insert({ org_id: orgId, qbo_id: "co-c1", name: "Consent Co", phone: "+13105550111", sms_consent: false })
    .select("id").single();
  const { data: inv } = await svc.from("invoices")
    .insert({ org_id: orgId, qbo_id: "co-i1", customer_id: cust!.id, amount: 700, balance: 700, due_date: "2026-03-01", status: "overdue" })
    .select("id").single();
  const user = await makeUserClient("consent-a@example.com");
  await svc.from("memberships").insert({ org_id: orgId, user_id: user.userId, role: "member" });

  // Resolve the invoice's customer (RLS-scoped) then flip consent on, off, on.
  const { data: seen } = await user.client.from("invoices").select("customer_id").eq("id", inv!.id).maybeSingle();
  expect(seen?.customer_id).toBe(cust!.id);

  await user.client.from("customers").update({ sms_consent: true }).eq("id", cust!.id);
  let { data: after } = await svc.from("customers").select("sms_consent").eq("id", cust!.id).single();
  expect(after!.sms_consent).toBe(true);

  await user.client.from("customers").update({ sms_consent: false }).eq("id", cust!.id);
  ({ data: after } = await svc.from("customers").select("sms_consent").eq("id", cust!.id).single());
  expect(after!.sms_consent).toBe(false);
});

// The Messages tab can toggle consent on invoice-less inbound-only threads via a
// bare customerId. Mirrors the action's customerId fallback: a member updates an
// own-org customer directly by id (RLS-scoped); an outsider cannot.
test("a member toggles sms_consent via a bare customerId (no invoice) under RLS", async () => {
  const svc = serviceClient();
  const { data: org } = await svc.from("organizations").insert({ name: "Consent Org C" }).select("id").single();
  const orgId = org!.id;
  const { data: cust } = await svc.from("customers")
    .insert({ org_id: orgId, qbo_id: "coc-c1", name: "No-Invoice Co", phone: "+13105550133", sms_consent: false })
    .select("id").single();
  const member = await makeUserClient("consent-c@example.com");
  await svc.from("memberships").insert({ org_id: orgId, user_id: member.userId, role: "member" });

  // No invoice exists — update the customer directly by id (the action's fallback path).
  await member.client.from("customers").update({ sms_consent: true }).eq("id", cust!.id);
  let { data: after } = await svc.from("customers").select("sms_consent").eq("id", cust!.id).single();
  expect(after!.sms_consent).toBe(true);

  // An outsider with a known customerId still cannot change it (RLS).
  const outsider = await makeUserClient("consent-c-outsider@example.com");
  await outsider.client.from("customers").update({ sms_consent: false }).eq("id", cust!.id);
  ({ data: after } = await svc.from("customers").select("sms_consent").eq("id", cust!.id).single());
  expect(after!.sms_consent).toBe(true); // unchanged — RLS blocked the cross-org update
});

test("a member of another org cannot read the invoice or change consent", async () => {
  const svc = serviceClient();
  const { data: org } = await svc.from("organizations").insert({ name: "Consent Org B" }).select("id").single();
  const orgId = org!.id;
  const { data: cust } = await svc.from("customers")
    .insert({ org_id: orgId, qbo_id: "cob-c1", name: "Private Co", sms_consent: true })
    .select("id").single();
  const { data: inv } = await svc.from("invoices")
    .insert({ org_id: orgId, qbo_id: "cob-i1", customer_id: cust!.id, amount: 500, balance: 500, due_date: "2026-03-01", status: "overdue" })
    .select("id").single();

  const outsider = await makeUserClient("consent-outsider@example.com");
  // No membership in Org B.
  const { data: seen } = await outsider.client.from("invoices").select("customer_id").eq("id", inv!.id).maybeSingle();
  expect(seen).toBeNull(); // RLS hides the invoice

  await outsider.client.from("customers").update({ sms_consent: false }).eq("id", cust!.id);
  const { data: after } = await svc.from("customers").select("sms_consent").eq("id", cust!.id).single();
  expect(after!.sms_consent).toBe(true); // unchanged — RLS blocked the update
});
