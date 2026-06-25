import { expect, test } from "vitest";
import { serviceClient, makeUserClient } from "./helpers";

test("cross-org RLS: a member of org A cannot read or write org B presence", async () => {
  const svc = serviceClient();
  const { data: orgA } = await svc.from("organizations").insert({ name: "Presence RLS A" }).select("id").single();
  const { data: orgB } = await svc.from("organizations").insert({ name: "Presence RLS B" }).select("id").single();
  const a = await makeUserClient("presence-rls-a@example.com");
  await svc.from("memberships").insert({ org_id: orgA!.id, user_id: a.userId, role: "owner" });
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
