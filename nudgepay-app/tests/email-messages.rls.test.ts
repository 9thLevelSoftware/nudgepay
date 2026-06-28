import { describe, it, expect } from "vitest";
import { serviceClient, makeUserClient } from "./helpers";

describe("email_messages RLS + do_not_email default", () => {
  it("member reads own-org rows only; foreign org sees none", async () => {
    const svc = serviceClient();

    // Create two isolated orgs.
    const { data: orgA } = await svc
      .from("organizations")
      .insert({ name: `EM-rls-A ${Math.random()}` })
      .select("id")
      .single();
    const orgAId = orgA!.id as string;

    const { data: orgB } = await svc
      .from("organizations")
      .insert({ name: `EM-rls-B ${Math.random()}` })
      .select("id")
      .single();
    const orgBId = orgB!.id as string;

    const userA = await makeUserClient(`em-rls-a-${Math.random()}@example.com`);
    const userB = await makeUserClient(`em-rls-b-${Math.random()}@example.com`);

    await svc.from("memberships").insert([
      { org_id: orgAId, user_id: userA.userId, role: "member" },
      { org_id: orgBId, user_id: userB.userId, role: "member" },
    ]);

    // Insert an email_messages row into org A via the service client.
    const { error: insErr } = await svc.from("email_messages").insert({
      org_id: orgAId,
      direction: "outbound",
      status: "sent",
      to_address: "customer@example.com",
      subject: "Test",
      body: "Test body",
    });
    expect(insErr).toBeNull();

    // userA (member of org A) should see exactly 1 row.
    const { data: rowsA, error: errA } = await userA.client
      .from("email_messages")
      .select("id")
      .eq("org_id", orgAId);
    expect(errA).toBeNull();
    expect(rowsA).toHaveLength(1);

    // userB (member of org B) should see zero rows when scoped to org A.
    const { data: rowsB, error: errB } = await userB.client
      .from("email_messages")
      .select("id")
      .eq("org_id", orgAId);
    expect(errB).toBeNull();
    expect(rowsB).toHaveLength(0);
  });

  it("customers.do_not_email defaults false", async () => {
    const svc = serviceClient();

    const { data: org } = await svc
      .from("organizations")
      .insert({ name: `EM-dne ${Math.random()}` })
      .select("id")
      .single();
    const orgId = org!.id as string;

    const { data: cust, error } = await svc
      .from("customers")
      .insert({ org_id: orgId, name: "Test Customer" })
      .select("do_not_email")
      .single();
    expect(error).toBeNull();
    expect(cust!.do_not_email).toBe(false);
  });
});
