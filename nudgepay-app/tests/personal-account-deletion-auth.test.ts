import { expect, test } from "vitest";
import { makeUserClient, serviceClient } from "./helpers";

test("deleteUser anonymizes actor columns and is blocked for the last owner", async () => {
  const svc = serviceClient();
  const owner = await makeUserClient(`acct-own-${Math.random()}@example.com`);
  const member = await makeUserClient(`acct-mem-${Math.random()}@example.com`);
  const { data: org, error: orgErr } = await svc.from("organizations")
    .insert({ name: "Keep Me Co" }).select("id").single();
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
  const { error: logErr } = await svc.from("contact_logs").insert({
    org_id: orgId,
    case_id: cse!.id,
    customer_id: cust!.id,
    user_id: member.userId,
    method: "call",
    notes: "called",
  });
  expect(logErr).toBeNull();
  const { error: smsErr } = await svc.from("text_messages").insert({
    org_id: orgId,
    customer_id: cust!.id,
    sent_by_user_id: member.userId,
    direction: "outbound",
    to_number: "+15555550100",
    body: "hi",
  });
  expect(smsErr).toBeNull();
  const { error: emailErr } = await svc.from("email_messages").insert({
    org_id: orgId,
    customer_id: cust!.id,
    sent_by_user_id: member.userId,
    direction: "outbound",
    status: "sent",
    to_address: "customer@example.com",
    subject: "Hi",
    body: "Hi",
  });
  expect(emailErr).toBeNull();
  const { error: prefErr } = await svc.from("user_notification_prefs").insert({
    org_id: orgId, user_id: member.userId,
  });
  expect(prefErr).toBeNull();
  const { error: readErr } = await svc.from("thread_reads").insert({
    org_id: orgId,
    user_id: member.userId,
    customer_id: cust!.id,
    channel: "sms",
  });
  expect(readErr).toBeNull();

  const lastOwner = await svc.auth.admin.deleteUser(owner.userId);
  expect(lastOwner.error).not.toBeNull();
  const { data: ownerStill } = await svc.auth.admin.getUserById(owner.userId);
  expect(ownerStill.user?.id).toBe(owner.userId);
  const { data: orgStill } = await svc.from("organizations").select("id").eq("id", orgId);
  expect(orgStill ?? []).toHaveLength(1);

  const gone = await svc.auth.admin.deleteUser(member.userId);
  expect(gone.error).toBeNull();
  const { data: memberGone } = await svc.auth.admin.getUserById(member.userId);
  expect(memberGone.user).toBeNull();
  const { data: logs } = await svc.from("contact_logs")
    .select("user_id").eq("org_id", orgId);
  expect(logs).toEqual([{ user_id: null }]);
  const { data: sms } = await svc.from("text_messages")
    .select("sent_by_user_id").eq("org_id", orgId);
  expect(sms).toEqual([{ sent_by_user_id: null }]);
  const { data: email } = await svc.from("email_messages")
    .select("sent_by_user_id").eq("org_id", orgId);
  expect(email).toEqual([{ sent_by_user_id: null }]);
  const { data: prefs } = await svc.from("user_notification_prefs")
    .select("user_id").eq("user_id", member.userId);
  expect(prefs ?? []).toHaveLength(0);
  const { data: reads } = await svc.from("thread_reads")
    .select("user_id").eq("user_id", member.userId);
  expect(reads ?? []).toHaveLength(0);
  const { data: memberships } = await svc.from("memberships")
    .select("user_id, role").eq("org_id", orgId);
  expect(memberships).toEqual([{ user_id: owner.userId, role: "owner" }]);
});
