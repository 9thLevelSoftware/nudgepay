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

  it("member and owner JWT cannot INSERT or DELETE email_messages", async () => {
    const svc = serviceClient();

    const { data: org } = await svc
      .from("organizations")
      .insert({ name: `EM-write ${Math.random()}` })
      .select("id")
      .single();
    const orgId = org!.id as string;

    const owner = await makeUserClient(`em-write-owner-${Math.random()}@example.com`);
    const member = await makeUserClient(`em-write-mem-${Math.random()}@example.com`);
    await svc.from("memberships").insert([
      { org_id: orgId, user_id: owner.userId, role: "owner" },
      { org_id: orgId, user_id: member.userId, role: "member" },
    ]);

    const { data: seeded } = await svc.from("email_messages").insert({
      org_id: orgId,
      direction: "outbound",
      status: "sent",
      to_address: "customer@example.com",
      subject: "Ledger",
      body: "Seed",
    }).select("id").single();
    const rowId = seeded!.id as string;

    const payload = {
      org_id: orgId,
      direction: "outbound" as const,
      status: "sent",
      to_address: "forged@example.com",
      subject: "Forged",
      body: "Forged body",
    };

    const memberIns = await member.client.from("email_messages").insert(payload);
    expect(memberIns.error).not.toBeNull();
    const ownerIns = await owner.client.from("email_messages").insert(payload);
    expect(ownerIns.error).not.toBeNull();

    const { data: afterIns } = await svc.from("email_messages")
      .select("id").eq("org_id", orgId).eq("to_address", "forged@example.com");
    expect(afterIns ?? []).toHaveLength(0);

    await member.client.from("email_messages").delete().eq("id", rowId);
    await owner.client.from("email_messages").delete().eq("id", rowId);
    const { data: still } = await svc.from("email_messages").select("id").eq("id", rowId);
    expect(still).toHaveLength(1);
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
