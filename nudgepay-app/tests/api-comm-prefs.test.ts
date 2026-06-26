import { expect, test } from "vitest";
import { serviceClient, makeUserClient } from "./helpers";
import { parseCommPrefsUpdate } from "../app/routes/api.comm-prefs";

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.append(k, v);
  return f;
}

// --- pure parsing (the action's real logic) ---
test("parseCommPrefsUpdate maps a valid channel and the checked opt-outs", () => {
  expect(parseCommPrefsUpdate(fd({ preferred_channel: "text", do_not_call: "true", do_not_text: "true" })))
    .toEqual({ preferred_channel: "text", do_not_call: true, do_not_text: true });
});

test("parseCommPrefsUpdate coerces empty/unknown/missing channel to null", () => {
  expect(parseCommPrefsUpdate(fd({ preferred_channel: "" })).preferred_channel).toBe(null);
  expect(parseCommPrefsUpdate(fd({ preferred_channel: "fax" })).preferred_channel).toBe(null);
  expect(parseCommPrefsUpdate(fd({})).preferred_channel).toBe(null);
});

test("parseCommPrefsUpdate never includes sms_consent (legal record untouched)", () => {
  expect("sms_consent" in parseCommPrefsUpdate(fd({ do_not_text: "true" }))).toBe(false);
});

test("a non-true checkbox value resolves to false", () => {
  const u = parseCommPrefsUpdate(fd({ do_not_call: "false" }));
  expect(u.do_not_call).toBe(false);
  expect(u.do_not_text).toBe(false);
});

// --- RLS write path (mirrors tests/api-sms-consent.test.ts) ---
test("a member updates comm preferences on an own-org customer via RLS; sms_consent untouched", async () => {
  const svc = serviceClient();
  const { data: org } = await svc.from("organizations").insert({ name: "Prefs Org A" }).select("id").single();
  const orgId = org!.id;
  const { data: cust } = await svc.from("customers")
    .insert({ org_id: orgId, qbo_id: "pa-c1", name: "Prefs Co", sms_consent: true }).select("id").single();
  const { data: inv } = await svc.from("invoices")
    .insert({ org_id: orgId, qbo_id: "pa-i1", customer_id: cust!.id, amount: 700, balance: 700, due_date: "2026-03-01", status: "overdue" }).select("id").single();
  const user = await makeUserClient("prefs-a@example.com");
  await svc.from("memberships").insert({ org_id: orgId, user_id: user.userId, role: "member" });

  const { data: seen } = await user.client.from("invoices").select("customer_id").eq("id", inv!.id).maybeSingle();
  expect(seen?.customer_id).toBe(cust!.id);

  await user.client.from("customers")
    .update({ preferred_channel: "call", do_not_call: true, do_not_text: true }).eq("id", cust!.id);
  const { data: after } = await svc.from("customers")
    .select("preferred_channel, do_not_call, do_not_text, sms_consent").eq("id", cust!.id).single();
  expect(after!.preferred_channel).toBe("call");
  expect(after!.do_not_call).toBe(true);
  expect(after!.do_not_text).toBe(true);
  expect(after!.sms_consent).toBe(true); // legal record unaffected
});

test("a member of another org cannot change comm preferences (RLS blocks)", async () => {
  const svc = serviceClient();
  const { data: org } = await svc.from("organizations").insert({ name: "Prefs Org B" }).select("id").single();
  const orgId = org!.id;
  const { data: cust } = await svc.from("customers")
    .insert({ org_id: orgId, qbo_id: "pb-c1", name: "Private Prefs", preferred_channel: null, do_not_text: false }).select("id").single();
  const outsider = await makeUserClient("prefs-outsider@example.com");
  await outsider.client.from("customers").update({ do_not_text: true, preferred_channel: "call" }).eq("id", cust!.id);
  const { data: after } = await svc.from("customers").select("do_not_text, preferred_channel").eq("id", cust!.id).single();
  expect(after!.do_not_text).toBe(false);
  expect(after!.preferred_channel).toBe(null); // RLS blocked the update
});
