import { expect, test } from "vitest";
import { serviceClient, makeUserClient } from "./helpers";

test("sms_sender_inventory: member reads own org; nonmember denied; JWT cannot write", async () => {
  const svc = serviceClient();
  const { data: orgA } = await svc.from("organizations").insert({ name: `SSI-rls-a ${Math.random()}` }).select("id").single();
  const orgAId = orgA!.id as string;
  const { data: orgB } = await svc.from("organizations").insert({ name: `SSI-rls-b ${Math.random()}` }).select("id").single();
  const orgBId = orgB!.id as string;

  const member = await makeUserClient(`ssi-mem-${Math.random()}@example.com`);
  const outsider = await makeUserClient(`ssi-out-${Math.random()}@example.com`);
  const owner = await makeUserClient(`ssi-own-${Math.random()}@example.com`);
  await svc.from("memberships").insert([
    { org_id: orgAId, user_id: member.userId, role: "member" },
    { org_id: orgAId, user_id: owner.userId, role: "owner" },
    { org_id: orgBId, user_id: outsider.userId, role: "member" },
  ]);

  const hex = () => Math.random().toString(16).slice(2).padEnd(32, "0").slice(0, 32);
  const sidA = "MG" + hex();
  const sidB = "MG" + hex();
  const { error: seedErr } = await svc.from("sms_sender_inventory").insert([
    { org_id: orgAId, messaging_service_sid: sidA, status: "active" },
    { org_id: orgBId, messaging_service_sid: sidB, status: "active" },
  ]);
  expect(seedErr).toBeNull();

  const { data: visible, error: visErr } = await member.client
    .from("sms_sender_inventory")
    .select("org_id, messaging_service_sid");
  expect(visErr).toBeNull();
  expect(visible).toHaveLength(1);
  expect(visible![0].org_id).toBe(orgAId);

  const { data: outsiderRows, error: outErr } = await outsider.client
    .from("sms_sender_inventory")
    .select("org_id")
    .eq("org_id", orgAId);
  expect(outErr).toBeNull();
  expect(outsiderRows ?? []).toHaveLength(0);

  const payload = { org_id: orgAId, messaging_service_sid: "MG" + "c".repeat(32), status: "active" };
  const memberIns = await member.client.from("sms_sender_inventory").insert(payload);
  expect(memberIns.error).not.toBeNull();
  const ownerIns = await owner.client.from("sms_sender_inventory").insert(payload);
  expect(ownerIns.error).not.toBeNull();

  await member.client.from("sms_sender_inventory").update({ status: "disabled" }).eq("org_id", orgAId);
  await owner.client.from("sms_sender_inventory").update({ status: "disabled" }).eq("org_id", orgAId);
  const { data: afterUpd } = await svc.from("sms_sender_inventory").select("status").eq("org_id", orgAId).single();
  expect(afterUpd!.status).toBe("active");

  await member.client.from("sms_sender_inventory").delete().eq("org_id", orgAId);
  await owner.client.from("sms_sender_inventory").delete().eq("org_id", orgAId);
  const { data: still } = await svc.from("sms_sender_inventory").select("org_id").eq("org_id", orgAId);
  expect(still).toHaveLength(1);
});

test("JWT cannot stamp outbound SID history used for inbound routing", async () => {
  const svc = serviceClient();
  const { data: org } = await svc.from("organizations").insert({ name: `SSI-sid-jwt ${Math.random()}` }).select("id").single();
  const orgId = org!.id as string;
  const member = await makeUserClient(`ssi-sid-${Math.random()}@example.com`);
  await svc.from("memberships").insert({ org_id: orgId, user_id: member.userId, role: "member" });
  const { data: cust } = await svc.from("customers")
    .insert({ org_id: orgId, qbo_id: `c-sid-jwt-${Math.random()}`, name: "SID JWT", phone: "+13105550999", sms_consent: true })
    .select("id").single();

  const spoof = await member.client.from("text_messages").insert({
    org_id: orgId,
    customer_id: cust!.id,
    direction: "outbound",
    twilio_message_sid: "SMspoof-sid",
    messaging_service_sid: "MG" + "d".repeat(32),
    to_number: "+13105550999",
    body: "spoof",
  });
  expect(spoof.error).not.toBeNull();
  const { data: rows } = await svc.from("text_messages").select("id").eq("twilio_message_sid", "SMspoof-sid");
  expect(rows ?? []).toHaveLength(0);
});
