import { beforeAll, expect, test } from "vitest";
import { makeUserClient, serviceClient } from "./helpers";

let orgA: string, orgB: string, userA: Awaited<ReturnType<typeof makeUserClient>>, userB: Awaited<ReturnType<typeof makeUserClient>>;

beforeAll(async () => {
  const svc = serviceClient();
  userA = await makeUserClient("a@example.com");
  userB = await makeUserClient("b@example.com");

  const { data: a } = await svc.from("organizations").insert({ name: "Org A" }).select().single();
  const { data: b } = await svc.from("organizations").insert({ name: "Org B" }).select().single();
  orgA = a!.id; orgB = b!.id;
  await svc.from("memberships").insert({ org_id: orgA, user_id: userA.userId, role: "owner" });
  await svc.from("memberships").insert({ org_id: orgB, user_id: userB.userId, role: "owner" });
  await svc.from("customers").insert({ org_id: orgA, name: "A-Customer" });
  await svc.from("customers").insert({ org_id: orgB, name: "B-Customer" });
});

test("user A sees only org A customers", async () => {
  const { data } = await userA.client.from("customers").select("name");
  expect(data?.map((r) => r.name)).toEqual(["A-Customer"]);
});

test("user A cannot read org B customers even when filtering by org B id", async () => {
  const { data } = await userA.client.from("customers").select("*").eq("org_id", orgB);
  expect(data).toEqual([]);
});

test("user A cannot insert a row into org B", async () => {
  const { error } = await userA.client.from("customers").insert({ org_id: orgB, name: "Sneaky" });
  expect(error).not.toBeNull();
});

test("non-owner members cannot create invite tokens through RLS", async () => {
  const svc = serviceClient();
  const member = await makeUserClient(`invite-member-${Math.random()}@example.com`);
  await svc.from("memberships").insert({ org_id: orgA, user_id: member.userId, role: "member" });

  const { error } = await member.client.from("invites").insert({
    org_id: orgA,
    email: "attacker-added@example.com",
  });

  expect(error).not.toBeNull();
  const { data: rows } = await svc.from("invites").select("id").eq("org_id", orgA).eq("email", "attacker-added@example.com");
  expect(rows ?? []).toHaveLength(0);
});

test("non-owner members can read but cannot mutate qbo_connections", async () => {
  const svc = serviceClient();
  const member = await makeUserClient(`qbo-member-${Math.random()}@example.com`);
  await svc.from("memberships").insert({ org_id: orgA, user_id: member.userId, role: "member" });
  await svc.from("qbo_connections").insert({ org_id: orgA, realm_id: `rls-realm-${Math.random()}`, status: "connected" });

  const { data: seen } = await member.client.from("qbo_connections")
    .select("status")
    .eq("org_id", orgA)
    .maybeSingle();
  expect(seen?.status).toBe("connected");

  await member.client.from("qbo_connections")
    .update({ status: "disconnected" })
    .eq("org_id", orgA);

  const { data: after } = await svc.from("qbo_connections").select("status").eq("org_id", orgA).single();
  expect(after!.status).toBe("connected");
});

test("non-owner members cannot directly write QBO-sourced invoice or payment records", async () => {
  const svc = serviceClient();
  const member = await makeUserClient(`finance-member-${Math.random()}@example.com`);
  await svc.from("memberships").insert({ org_id: orgA, user_id: member.userId, role: "member" });
  const { data: cust } = await svc.from("customers")
    .insert({ org_id: orgA, qbo_id: `fin-c-${Math.random()}`, name: "Finance Co" })
    .select("id")
    .single();
  const { data: inv } = await svc.from("invoices")
    .insert({ org_id: orgA, qbo_id: `fin-i-${Math.random()}`, customer_id: cust!.id, balance: 100 })
    .select("id")
    .single();
  const { data: pay } = await svc.from("payments")
    .insert({ org_id: orgA, customer_id: cust!.id, qbo_id: `fin-p-${Math.random()}`, type: "payment", amount: 25, qbo_sync_at: new Date().toISOString() })
    .select("id")
    .single();

  await member.client.from("invoices").update({ balance: 0 }).eq("id", inv!.id);
  await member.client.from("payments").update({ amount: 999 }).eq("id", pay!.id);
  const invoiceInsert = await member.client.from("invoices")
    .insert({ org_id: orgA, qbo_id: `fin-member-i-${Math.random()}`, customer_id: cust!.id, balance: 1 });

  const { data: invAfter } = await svc.from("invoices").select("balance").eq("id", inv!.id).single();
  const { data: payAfter } = await svc.from("payments").select("amount").eq("id", pay!.id).single();
  expect(Number(invAfter!.balance)).toBe(100);
  expect(Number(payAfter!.amount)).toBe(25);
  expect(invoiceInsert.error).not.toBeNull();
});

test("members can update customer workflow fields but not QBO-sourced customer fields", async () => {
  const svc = serviceClient();
  const member = await makeUserClient(`customer-member-${Math.random()}@example.com`);
  await svc.from("memberships").insert({ org_id: orgA, user_id: member.userId, role: "member" });
  const { data: cust } = await svc.from("customers")
    .insert({ org_id: orgA, qbo_id: `cust-src-${Math.random()}`, name: "Original Name", sms_consent: false })
    .select("id")
    .single();

  const localUpdate = await member.client.from("customers")
    .update({ sms_consent: true, notes: "called AP" })
    .eq("id", cust!.id);
  expect(localUpdate.error).toBeNull();

  const sourceUpdate = await member.client.from("customers")
    .update({ name: "Tampered Name" })
    .eq("id", cust!.id);
  expect(sourceUpdate.error).not.toBeNull();

  const { data: after } = await svc.from("customers").select("name, sms_consent, notes").eq("id", cust!.id).single();
  expect(after!.name).toBe("Original Name");
  expect(after!.sms_consent).toBe(true);
  expect(after!.notes).toBe("called AP");
});

test("composite tenant FKs reject cross-org child references even for service-role writes", async () => {
  const svc = serviceClient();
  const { data: custB } = await svc.from("customers")
    .insert({ org_id: orgB, qbo_id: `fk-b-${Math.random()}`, name: "FK Org B" })
    .select("id")
    .single();
  const { data: caseB } = await svc.from("collection_cases")
    .insert({ org_id: orgB, customer_id: custB!.id, status: "working" })
    .select("id")
    .single();

  const { error } = await svc.from("contact_logs").insert({
    org_id: orgA,
    case_id: caseB!.id,
    customer_id: custB!.id,
    user_id: userA.userId,
    method: "call",
    outcome: "no-answer",
  });

  expect(error).not.toBeNull();
});
