import { expect, test } from "vitest";
import { makeUserClient, serviceClient } from "./helpers";
import { loadPersonalDataExport } from "../app/lib/personal-data-export.server";

test("loadPersonalDataExport includes memberships, prefs, and authored logs", async () => {
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
  expect(payload.memberships).toEqual([{
    orgId,
    orgName: "Export Co",
    role: "owner",
  }]);
  expect(payload.notificationPrefs).toEqual([{
    orgId,
    brokenPromiseEmail: false,
    dailyDigestEmail: true,
  }]);
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
  expect(payload.memberships).toEqual([]);
  expect(payload.notificationPrefs).toEqual([]);
  expect(payload.contactLogs).toEqual([]);
});

test("loadPersonalDataExport includes every workspace membership and its preferences", async () => {
  const svc = serviceClient();
  const suffix = crypto.randomUUID();
  const user = await makeUserClient(`export-many-${suffix}@example.com`);
  const { data: orgs, error: orgErr } = await svc.from("organizations")
    .insert([{ name: `Export Alpha ${suffix}` }, { name: `Export Beta ${suffix}` }])
    .select("id, name");
  expect(orgErr).toBeNull();
  const [alpha, beta] = orgs!;
  const { error: memErr } = await svc.from("memberships").insert([
    { org_id: alpha.id, user_id: user.userId, role: "owner" },
    { org_id: beta.id, user_id: user.userId, role: "admin" },
  ]);
  expect(memErr).toBeNull();
  const { error: prefsErr } = await svc.from("user_notification_prefs").insert([
    {
      org_id: alpha.id,
      user_id: user.userId,
      broken_promise_email: false,
      daily_digest_email: true,
    },
    {
      org_id: beta.id,
      user_id: user.userId,
      broken_promise_email: true,
      daily_digest_email: false,
    },
  ]);
  expect(prefsErr).toBeNull();
  const { data: auth } = await svc.auth.admin.getUserById(user.userId);

  const payload = await loadPersonalDataExport(svc, auth.user!, "2026-08-31T12:00:00.000Z");

  const expectedOrgs = [
    { orgId: alpha.id, orgName: alpha.name, role: "owner" },
    { orgId: beta.id, orgName: beta.name, role: "admin" },
  ].sort((left, right) => left.orgId.localeCompare(right.orgId));

  expect(payload.memberships).toEqual(expectedOrgs);
  expect(payload.notificationPrefs).toEqual(expectedOrgs.map((membership) => ({
    orgId: membership.orgId,
    brokenPromiseEmail: membership.orgId === alpha.id ? false : true,
    dailyDigestEmail: membership.orgId === alpha.id ? true : false,
  })));
});

test("loadPersonalDataExport pages beyond the PostgREST 1,000-row response cap", async () => {
  const svc = serviceClient();
  const suffix = crypto.randomUUID();
  const user = await makeUserClient(`export-logs-${suffix}@example.com`);
  const { data: org, error: orgErr } = await svc.from("organizations")
    .insert({ name: `Export Logs ${suffix}` }).select("id").single();
  expect(orgErr).toBeNull();
  const orgId = org!.id as string;
  const { error: memErr } = await svc.from("memberships").insert({
    org_id: orgId, user_id: user.userId, role: "owner",
  });
  expect(memErr).toBeNull();
  const { data: customer, error: customerErr } = await svc.from("customers")
    .insert({ org_id: orgId, name: "Paged Customer", qbo_id: `paged-${suffix}` })
    .select("id").single();
  expect(customerErr).toBeNull();
  const { data: collectionCase, error: caseErr } = await svc.from("collection_cases")
    .insert({ org_id: orgId, customer_id: customer!.id, status: "working" })
    .select("id").single();
  expect(caseErr).toBeNull();
  const logs = Array.from({ length: 1_001 }, (_, index) => ({
    org_id: orgId,
    case_id: collectionCase!.id,
    customer_id: customer!.id,
    user_id: user.userId,
    method: "call",
    outcome: index % 2 === 0 ? "answered" : "no-answer",
    created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
  }));
  for (let offset = 0; offset < logs.length; offset += 500) {
    const { error } = await svc.from("contact_logs").insert(logs.slice(offset, offset + 500));
    expect(error).toBeNull();
  }
  const { data: auth } = await svc.auth.admin.getUserById(user.userId);

  const payload = await loadPersonalDataExport(svc, auth.user!, "2026-09-05T00:00:00.000Z");

  expect(payload.contactLogs).toHaveLength(1_001);
  expect(new Set(payload.contactLogs.map((row) => row.id)).size).toBe(1_001);
  expect(payload.truncated).toBe(false);
});
