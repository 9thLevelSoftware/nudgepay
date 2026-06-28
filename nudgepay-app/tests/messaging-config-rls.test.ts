import { expect, test } from "vitest";
import { serviceClient, makeUserClient } from "./helpers";

test("messaging_config: sms_enabled defaults true; owner writes, member reads only", async () => {
  const svc = serviceClient();
  const { data: org } = await svc.from("organizations").insert({ name: `MC-rls ${Math.random()}` }).select("id").single();
  const orgId = org!.id as string;
  const owner = await makeUserClient(`mc-owner-${Math.random()}@example.com`);
  const member = await makeUserClient(`mc-member-${Math.random()}@example.com`);
  await svc.from("memberships").insert([
    { org_id: orgId, user_id: owner.userId, role: "owner" },
    { org_id: orgId, user_id: member.userId, role: "member" },
  ]);

  // Owner upsert succeeds and default sms_enabled is true on a bare insert.
  const { error: ownErr } = await owner.client.from("messaging_config")
    .upsert({ org_id: orgId, sender: "+15005550006" }, { onConflict: "org_id" });
  expect(ownErr).toBeNull();
  const { data: row } = await svc.from("messaging_config").select("sms_enabled, sender").eq("org_id", orgId).single();
  expect(row!.sms_enabled).toBe(true);
  expect(row!.sender).toBe("+15005550006");

  // Owner can toggle off.
  await owner.client.from("messaging_config").update({ sms_enabled: false }).eq("org_id", orgId);
  const { data: off } = await svc.from("messaging_config").select("sms_enabled").eq("org_id", orgId).single();
  expect(off!.sms_enabled).toBe(false);

  // Member can READ.
  const { data: seen } = await member.client.from("messaging_config").select("sms_enabled").eq("org_id", orgId).maybeSingle();
  expect(seen?.sms_enabled).toBe(false);

  // Member write is blocked by RLS (no error; 0 rows affected).
  await member.client.from("messaging_config").update({ sms_enabled: true }).eq("org_id", orgId);
  const { data: after } = await svc.from("messaging_config").select("sms_enabled").eq("org_id", orgId).single();
  expect(after!.sms_enabled).toBe(false); // unchanged
});

test("email_config: created disabled by default; owner writes, member reads only", async () => {
  const svc = serviceClient();
  const { data: org } = await svc.from("organizations").insert({ name: `EC-rls ${Math.random()}` }).select("id").single();
  const orgId = org!.id as string;
  const owner = await makeUserClient(`ec-owner-${Math.random()}@example.com`);
  const member = await makeUserClient(`ec-member-${Math.random()}@example.com`);
  await svc.from("memberships").insert([
    { org_id: orgId, user_id: owner.userId, role: "owner" },
    { org_id: orgId, user_id: member.userId, role: "member" },
  ]);

  const { error: ownErr } = await owner.client.from("email_config")
    .upsert({ org_id: orgId, from_address: "ar@chancey.test" }, { onConflict: "org_id" });
  expect(ownErr).toBeNull();
  const { data: row } = await svc.from("email_config").select("email_enabled, from_address").eq("org_id", orgId).single();
  expect(row!.email_enabled).toBe(false); // disabled by default
  expect(row!.from_address).toBe("ar@chancey.test");

  const { data: seen } = await member.client.from("email_config").select("email_enabled").eq("org_id", orgId).maybeSingle();
  expect(seen?.email_enabled).toBe(false);

  await member.client.from("email_config").update({ email_enabled: true }).eq("org_id", orgId);
  const { data: after } = await svc.from("email_config").select("email_enabled").eq("org_id", orgId).single();
  expect(after!.email_enabled).toBe(false); // RLS blocked the member write
});
