import { expect, test } from "vitest";
import { serviceClient, makeUserClient } from "./helpers";

test("member cannot PATCH STOP/consent columns after inbound_stop", async () => {
  const svc = serviceClient();
  const member = await makeUserClient(`consent-rls-${Math.random()}@example.com`);
  const { data: org } = await svc.from("organizations")
    .insert({ name: `Consent RLS ${member.userId}` }).select("id").single();
  await svc.from("memberships").insert({ org_id: org!.id, user_id: member.userId, role: "member" });
  const { data: cust } = await svc.from("customers")
    .insert({
      org_id: org!.id, qbo_id: `stop-${member.userId}`, name: "Stopped Cust",
      sms_consent: false, do_not_text: true,
      sms_consent_source: "inbound_stop", sms_consent_at: new Date().toISOString(),
    })
    .select("id").single();

  const patch = await member.client.from("customers").update({
    sms_consent: true,
    do_not_text: false,
    sms_consent_source: "staff",
  }).eq("id", cust!.id);
  expect(patch.error).not.toBeNull();

  const { data: after } = await svc.from("customers")
    .select("sms_consent, do_not_text, sms_consent_source").eq("id", cust!.id).single();
  expect(after!.sms_consent).toBe(false);
  expect(after!.do_not_text).toBe(true);
  expect(after!.sms_consent_source).toBe("inbound_stop");
});

test("member may set do_not_text true and cannot write sms_consent*", async () => {
  const svc = serviceClient();
  const member = await makeUserClient(`consent-dnt-${Math.random()}@example.com`);
  const { data: org } = await svc.from("organizations")
    .insert({ name: `Consent DNT ${member.userId}` }).select("id").single();
  await svc.from("memberships").insert({ org_id: org!.id, user_id: member.userId, role: "member" });
  const { data: cust } = await svc.from("customers")
    .insert({
      org_id: org!.id, qbo_id: `dnt-${member.userId}`, name: "Pref Cust",
      sms_consent: false, do_not_text: false,
    })
    .select("id").single();

  const optOut = await member.client.from("customers")
    .update({ do_not_text: true }).eq("id", cust!.id);
  expect(optOut.error).toBeNull();

  const consent = await member.client.from("customers")
    .update({ sms_consent: true, sms_consent_source: "staff" }).eq("id", cust!.id);
  expect(consent.error).not.toBeNull();

  const { data: after } = await svc.from("customers")
    .select("sms_consent, do_not_text, sms_consent_source").eq("id", cust!.id).single();
  expect(after!.do_not_text).toBe(true);
  expect(after!.sms_consent).toBe(false);
  expect(after!.sms_consent_source).toBeNull();
});

test("owner can restore consent after inbound_stop", async () => {
  const svc = serviceClient();
  const owner = await makeUserClient(`consent-own-${Math.random()}@example.com`);
  const { data: org } = await svc.from("organizations")
    .insert({ name: `Consent owner ${owner.userId}` }).select("id").single();
  await svc.from("memberships").insert({ org_id: org!.id, user_id: owner.userId, role: "owner" });
  const stoppedAt = new Date().toISOString();
  const { data: cust } = await svc.from("customers")
    .insert({
      org_id: org!.id, qbo_id: `own-stop-${owner.userId}`, name: "Owner Restore",
      sms_consent: false, do_not_text: true,
      sms_consent_source: "inbound_stop", sms_consent_at: stoppedAt,
    })
    .select("id").single();

  const restore = await owner.client.from("customers").update({
    sms_consent: true,
    sms_consent_reason: "customer called in",
  }).eq("id", cust!.id);
  expect(restore.error).toBeNull();

  const { data: after } = await svc.from("customers")
    .select("sms_consent, sms_consent_source").eq("id", cust!.id).single();
  expect(after!.sms_consent).toBe(true);
  expect(after!.sms_consent_source).toBe("staff");
});
