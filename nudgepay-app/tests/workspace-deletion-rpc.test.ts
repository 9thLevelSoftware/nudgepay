import { expect, test } from "vitest";
import { makeUserClient, serviceClient } from "./helpers";

test("delete_workspace purges the org, writes a tombstone, and is not callable by JWT", async () => {
  const svc = serviceClient();
  const owner = await makeUserClient(`ws-del-own-${Math.random()}@example.com`);
  const member = await makeUserClient(`ws-del-mem-${Math.random()}@example.com`);
  const { data: org, error: orgErr } = await svc.from("organizations")
    .insert({ name: "Delete Me Co" }).select("id").single();
  expect(orgErr).toBeNull();
  const orgId = org!.id as string;
  const { error: memErr } = await svc.from("memberships").insert([
    { org_id: orgId, user_id: owner.userId, role: "owner" },
    { org_id: orgId, user_id: member.userId, role: "member" },
  ]);
  expect(memErr).toBeNull();
  const { data: cust } = await svc.from("customers")
    .insert({ org_id: orgId, name: "Cust", qbo_id: `c-${Math.random()}` })
    .select("id").single();
  const { data: cse } = await svc.from("collection_cases").insert({
    org_id: orgId, customer_id: cust!.id, status: "working",
  }).select("id").single();
  const { data: inv, error: invErr } = await svc.from("invoices").insert({
    org_id: orgId, qbo_id: `inv-${Math.random()}`, qbo_doc_number: "1",
    customer_id: cust!.id, amount: 1200, balance: 1200,
    due_date: "2026-03-01", status: "overdue",
  }).select("id").single();
  expect(invErr).toBeNull();
  const { data: prom, error: promErr } = await svc.from("promises").insert({
    org_id: orgId, case_id: cse!.id, customer_id: cust!.id, status: "pending",
    promised_amount: 500, promised_date: "2026-07-01", grace_until: "2026-07-03",
    baseline_balance: 1200,
  }).select("id").single();
  expect(promErr).toBeNull();
  const { error: linkErr } = await svc.from("promise_invoices").insert({
    promise_id: prom!.id, invoice_id: inv!.id, org_id: orgId, baseline_balance: 1200,
  });
  expect(linkErr).toBeNull();
  const { error: emailErr } = await svc.from("email_messages").insert({
    org_id: orgId,
    customer_id: cust!.id,
    invoice_id: inv!.id,
    direction: "outbound",
    status: "sent",
    to_address: "customer@example.com",
    subject: "Test",
    body: "Test body",
  });
  expect(emailErr).toBeNull();

  const jwt = await member.client.rpc("delete_workspace", {
    p_org_id: orgId,
    p_deleted_by: member.userId,
    p_org_name: "Delete Me Co",
    p_member_count: 2,
  });
  expect(jwt.error).not.toBeNull();

  // Body-level owner check: service_role must still fail for a non-owner p_deleted_by.
  const { error: memberRpc } = await svc.rpc("delete_workspace", {
    p_org_id: orgId,
    p_deleted_by: member.userId,
    p_org_name: "Delete Me Co",
    p_member_count: 2,
  });
  expect(memberRpc).not.toBeNull();
  const { data: stillThere } = await svc.from("organizations").select("id").eq("id", orgId);
  expect(stillThere ?? []).toHaveLength(1);
  const { data: noTomb } = await svc.from("workspace_deletions").select("org_id").eq("org_id", orgId);
  expect(noTomb ?? []).toHaveLength(0);

  const { error: rpcErr } = await svc.rpc("delete_workspace", {
    p_org_id: orgId,
    p_deleted_by: owner.userId,
    p_org_name: "Delete Me Co",
    p_member_count: 2,
  });
  expect(rpcErr).toBeNull();

  const { data: gone } = await svc.from("organizations").select("id").eq("id", orgId);
  expect(gone ?? []).toHaveLength(0);
  const { data: cases } = await svc.from("collection_cases").select("id").eq("org_id", orgId);
  expect(cases ?? []).toHaveLength(0);
  const { data: leftoverInv } = await svc.from("invoices").select("id").eq("org_id", orgId);
  expect(leftoverInv ?? []).toHaveLength(0);
  const { data: leftoverProm } = await svc.from("promises").select("id").eq("org_id", orgId);
  expect(leftoverProm ?? []).toHaveLength(0);
  const { data: leftoverEmail } = await svc.from("email_messages").select("id").eq("org_id", orgId);
  expect(leftoverEmail ?? []).toHaveLength(0);
  const { data: tomb } = await svc.from("workspace_deletions")
    .select("org_id, org_name, member_count, deleted_by").eq("org_id", orgId).maybeSingle();
  expect(tomb).toMatchObject({
    org_id: orgId,
    org_name: "Delete Me Co",
    member_count: 2,
    deleted_by: owner.userId,
  });
});
