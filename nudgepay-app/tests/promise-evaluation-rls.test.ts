import { expect, test } from "vitest";
import { serviceClient, makeUserClient } from "./helpers";

test("promises: RLS isolates by org and one-active-per-case index holds", async () => {
  const svc = serviceClient();
  const a = await makeUserClient("promises-rls-a@example.com");
  const b = await makeUserClient("promises-rls-b@example.com");

  const { data: orgA } = await svc.from("organizations").insert({ name: `PromOrgA ${a.userId}` }).select("id").single();
  const { data: orgB } = await svc.from("organizations").insert({ name: `PromOrgB ${b.userId}` }).select("id").single();
  await svc.from("memberships").insert([
    { org_id: orgA!.id, user_id: a.userId, role: "owner" },
    { org_id: orgB!.id, user_id: b.userId, role: "owner" },
  ]);
  const { data: cust } = await svc.from("customers")
    .insert({ org_id: orgA!.id, qbo_id: `prc-${a.userId}`, name: "Acme" }).select("id").single();
  const { data: cse } = await svc.from("collection_cases")
    .insert({ org_id: orgA!.id, customer_id: cust!.id, status: "promised" }).select("id").single();

  const { error: insErr } = await svc.from("promises").insert({
    org_id: orgA!.id, case_id: cse!.id, customer_id: cust!.id,
    status: "pending", promised_amount: 500, promised_date: "2026-07-01",
    grace_until: "2026-07-03", baseline_balance: 1200,
  });
  expect(insErr).toBeNull();

  // Member A reads its own promise; member B sees nothing.
  const { data: seenByA } = await a.client.from("promises").select("id").eq("org_id", orgA!.id);
  expect(seenByA!.length).toBe(1);
  const { data: seenByB } = await b.client.from("promises").select("id").eq("org_id", orgA!.id);
  expect(seenByB!.length).toBe(0);

  // Second pending promise on the same case violates the partial-unique index.
  const { error: dupErr } = await svc.from("promises").insert({
    org_id: orgA!.id, case_id: cse!.id, customer_id: cust!.id,
    status: "pending", promised_amount: 100, promised_date: "2026-07-05",
    grace_until: "2026-07-07", baseline_balance: 1200,
  });
  expect((dupErr as any)?.code).toBe("23505");
});
