import { expect, test } from "vitest";
import { makeUserClient, serviceClient } from "./helpers";
import { loadPersonalDataExport } from "../app/lib/personal-data-export.server";

test("loadPersonalDataExport includes membership, prefs, and authored logs", async () => {
  const svc = serviceClient();
  const owner = await makeUserClient(`export-own-${Math.random()}@example.com`);
  const { data: org, error: orgErr } = await svc.from("organizations")
    .insert({ name: "Export Co" }).select("id").single();
  expect(orgErr).toBeNull();
  const orgId = org!.id as string;
  const { error: memErr } = await svc.from("memberships").insert({
    org_id: orgId, user_id: owner.userId, role: "owner",
  });
  expect(memErr).toBeNull();
  const { error: prefErr } = await svc.from("user_notification_prefs").insert({
    org_id: orgId, user_id: owner.userId,
    broken_promise_email: false, daily_digest_email: true,
  });
  expect(prefErr).toBeNull();
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
    user_id: owner.userId,
    method: "call",
    outcome: "no-answer",
    notes: "do not put this customer secret in the export body via notes field check",
  });
  expect(logErr).toBeNull();

  const { data: auth } = await svc.auth.admin.getUserById(owner.userId);
  expect(auth.user).toBeTruthy();
  const payload = await loadPersonalDataExport(svc, auth.user!, "2026-08-31T12:00:00.000Z");
  expect(payload.account.id).toBe(owner.userId);
  expect(payload.account.email).toMatch(/export-own-/);
  expect(payload.membership).toEqual({
    orgId,
    orgName: "Export Co",
    role: "owner",
  });
  expect(payload.notificationPrefs).toEqual({
    brokenPromiseEmail: false,
    dailyDigestEmail: true,
  });
  expect(payload.contactLogs).toHaveLength(1);
  expect(payload.contactLogs[0]).toMatchObject({ method: "call", outcome: "no-answer" });
  expect(JSON.stringify(payload)).not.toMatch(/customer secret/i);
  expect(payload.truncated).toBe(false);
});

test("loadPersonalDataExport works with no membership", async () => {
  const svc = serviceClient();
  const user = await makeUserClient(`export-none-${Math.random()}@example.com`);
  const { data: auth } = await svc.auth.admin.getUserById(user.userId);
  const payload = await loadPersonalDataExport(svc, auth.user!, "2026-08-31T12:00:00.000Z");
  expect(payload.membership).toBeNull();
  expect(payload.notificationPrefs).toBeNull();
  expect(payload.contactLogs).toEqual([]);
});
