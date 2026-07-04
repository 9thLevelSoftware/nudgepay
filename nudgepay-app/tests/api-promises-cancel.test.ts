import { expect, test } from "vitest";
import { serviceClient, makeUserClient } from "./helpers";
import { cancelPromise } from "../app/lib/promise-cancel.server";

test("cancelPromise marks pending -> cancelled and resets the case", async () => {
  const svc = serviceClient();
  const user = await makeUserClient("promise-cancel@example.com");
  const { data: org } = await svc.from("organizations").insert({ name: `PCancel ${user.userId}` }).select("id").single();
  const orgId = org!.id;
  await svc.from("memberships").insert({ org_id: orgId, user_id: user.userId, role: "owner" });
  const { data: cust } = await svc.from("customers").insert({ org_id: orgId, qbo_id: `pcx-${user.userId}`, name: "Acme" }).select("id").single();
  const { data: cse } = await svc.from("collection_cases").insert({ org_id: orgId, customer_id: cust!.id, status: "promised", next_action_type: "promise", next_action_at: "2026-07-03" }).select("id").single();
  const { data: prom } = await svc.from("promises").insert({
    org_id: orgId, case_id: cse!.id, customer_id: cust!.id, status: "pending",
    promised_amount: 500, promised_date: "2026-07-01", grace_until: "2026-07-03", baseline_balance: 1200,
  }).select("id").single();

  const res = await cancelPromise(user.client, prom!.id, orgId, "2026-06-23");
  expect(res.ok).toBe(true);

  const { data: p } = await svc.from("promises").select("status").eq("id", prom!.id).single();
  expect(p!.status).toBe("cancelled");
  const { data: c } = await svc.from("collection_cases").select("status, next_action_type, next_action_at").eq("id", cse!.id).single();
  expect(c!.status).toBe("working");
  expect(c!.next_action_type).toBe("follow_up");
  expect(c!.next_action_at).toBe("2026-06-23");
});

test("cancelPromise rejects a non-pending promise", async () => {
  const svc = serviceClient();
  const user = await makeUserClient("promise-cancel2@example.com");
  const { data: org } = await svc.from("organizations").insert({ name: `PCancel2 ${user.userId}` }).select("id").single();
  const orgId = org!.id;
  await svc.from("memberships").insert({ org_id: orgId, user_id: user.userId, role: "owner" });
  const { data: cust } = await svc.from("customers").insert({ org_id: orgId, qbo_id: `pcx2-${user.userId}`, name: "Acme" }).select("id").single();
  const { data: cse } = await svc.from("collection_cases").insert({ org_id: orgId, customer_id: cust!.id, status: "working" }).select("id").single();
  const { data: prom } = await svc.from("promises").insert({
    org_id: orgId, case_id: cse!.id, customer_id: cust!.id, status: "kept",
    promised_amount: 500, promised_date: "2026-07-01", grace_until: "2026-07-03", baseline_balance: 1200,
  }).select("id").single();

  const res = await cancelPromise(user.client, prom!.id, orgId, "2026-06-23");
  expect(res.ok).toBe(false);
});

test("cancelPromise rejects a pending promise outside the active org even for a multi-org user", async () => {
  const svc = serviceClient();
  const user = await makeUserClient("promise-cancel-multi@example.com");
  const { data: orgA } = await svc.from("organizations").insert({ name: `PCancelA ${user.userId}` }).select("id").single();
  const { data: orgB } = await svc.from("organizations").insert({ name: `PCancelB ${user.userId}` }).select("id").single();
  const orgAId = orgA!.id as string;
  const orgBId = orgB!.id as string;
  await svc.from("memberships").insert([
    { org_id: orgAId, user_id: user.userId, role: "owner" },
    { org_id: orgBId, user_id: user.userId, role: "member" },
  ]);
  const { data: custB } = await svc.from("customers").insert({ org_id: orgBId, qbo_id: `pcx-b-${user.userId}`, name: "Org B Acme" }).select("id").single();
  const { data: caseB } = await svc.from("collection_cases").insert({
    org_id: orgBId, customer_id: custB!.id, status: "promised", next_action_type: "promise", next_action_at: "2026-07-03",
  }).select("id").single();
  const { data: promB } = await svc.from("promises").insert({
    org_id: orgBId, case_id: caseB!.id, customer_id: custB!.id, status: "pending",
    promised_amount: 500, promised_date: "2026-07-01", grace_until: "2026-07-03", baseline_balance: 1200,
  }).select("id").single();

  const res = await cancelPromise(user.client, promB!.id, orgAId, "2026-06-23");
  expect(res.ok).toBe(false);

  const { data: p } = await svc.from("promises").select("status").eq("id", promB!.id).single();
  expect(p!.status).toBe("pending");
});
