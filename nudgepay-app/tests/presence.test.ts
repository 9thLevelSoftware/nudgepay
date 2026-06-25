import { expect, test } from "vitest";
import { serviceClient, makeUserClient } from "./helpers";
import { recordHeartbeat, readPresence } from "../app/lib/presence.server";

test("cross-org RLS: a member of org A cannot read or write org B presence", async () => {
  const svc = serviceClient();
  const { data: orgA } = await svc.from("organizations").insert({ name: "Presence RLS A" }).select("id").single();
  const { data: orgB } = await svc.from("organizations").insert({ name: "Presence RLS B" }).select("id").single();
  const a = await makeUserClient("presence-rls-a@example.com");
  await svc.from("memberships").insert({ org_id: orgA!.id, user_id: a.userId, role: "owner" });
  // Positive path: prove the table exists and own-org reads work, so the isolation
  // assertions below cannot be satisfied by a missing-table 404 instead of real RLS.
  const { data: custA } = await svc.from("customers")
    .insert({ org_id: orgA!.id, qbo_id: "prls-a1", name: "A Co" }).select("id").single();
  await svc.from("case_presence").insert({
    org_id: orgA!.id, customer_id: custA!.id, user_id: a.userId, last_seen_at: new Date().toISOString(),
  });
  const { data: readA } = await a.client.from("case_presence")
    .select("user_id").eq("org_id", orgA!.id).eq("customer_id", custA!.id);
  expect((readA ?? []).map((r) => r.user_id)).toEqual([a.userId]);
  // a is NOT a member of org B.
  const { data: custB } = await svc.from("customers")
    .insert({ org_id: orgB!.id, qbo_id: "prls-b1", name: "B Co" }).select("id").single();

  // Read of B's presence from A's client returns nothing (RLS).
  const { data: readB } = await a.client.from("case_presence")
    .select("user_id").eq("org_id", orgB!.id).eq("customer_id", custB!.id);
  expect(readB ?? []).toEqual([]);

  // Write to B from A's client is rejected by RLS (insert error, no row created).
  const { error: writeErr } = await a.client.from("case_presence")
    .insert({ org_id: orgB!.id, customer_id: custB!.id, user_id: a.userId, last_seen_at: new Date().toISOString() });
  expect(writeErr).not.toBeNull();
});

test("recordHeartbeat upserts one row per (org,customer,user); a second beat updates last_seen_at", async () => {
  const svc = serviceClient();
  const { data: org } = await svc.from("organizations").insert({ name: "Presence HB" }).select("id").single();
  const u = await makeUserClient("presence-hb@example.com");
  await svc.from("memberships").insert({ org_id: org!.id, user_id: u.userId, role: "owner" });
  const { data: cust } = await svc.from("customers")
    .insert({ org_id: org!.id, qbo_id: "hb-1", name: "HB Co" }).select("id").single();

  await recordHeartbeat(u.client, { orgId: org!.id, customerId: cust!.id, userId: u.userId });
  const { data: first } = await svc.from("case_presence")
    .select("last_seen_at").eq("org_id", org!.id).eq("customer_id", cust!.id).eq("user_id", u.userId);
  expect(first).toHaveLength(1);

  await recordHeartbeat(u.client, { orgId: org!.id, customerId: cust!.id, userId: u.userId });
  const { data: second } = await svc.from("case_presence")
    .select("last_seen_at").eq("org_id", org!.id).eq("customer_id", cust!.id).eq("user_id", u.userId);
  expect(second).toHaveLength(1); // still one row (upsert, not insert)
  expect(Date.parse(second![0].last_seen_at)).toBeGreaterThanOrEqual(Date.parse(first![0].last_seen_at));
});

test("readPresence returns the org's rows for the requested customers and [] for empty input", async () => {
  const svc = serviceClient();
  const { data: org } = await svc.from("organizations").insert({ name: "Presence Read" }).select("id").single();
  const u = await makeUserClient("presence-read@example.com");
  await svc.from("memberships").insert({ org_id: org!.id, user_id: u.userId, role: "owner" });
  const { data: cust } = await svc.from("customers")
    .insert({ org_id: org!.id, qbo_id: "pr-1", name: "PR Co" }).select("id").single();
  await recordHeartbeat(u.client, { orgId: org!.id, customerId: cust!.id, userId: u.userId });

  expect(await readPresence(u.client, { orgId: org!.id, customerIds: [] })).toEqual([]);
  const rows = await readPresence(u.client, { orgId: org!.id, customerIds: [cust!.id] });
  expect(rows.map((r) => r.user_id)).toEqual([u.userId]);
  expect(rows[0].customer_id).toBe(cust!.id);
});
