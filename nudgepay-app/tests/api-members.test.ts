import { expect, test } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { serviceClient, makeUserClient, TEST_ENV } from "./helpers";
import { action } from "../app/routes/api.members";

function ctx() {
  return { cloudflare: { env: TEST_ENV } } as any;
}

function sessionCookie(session: object, orgId?: string): string {
  const host = new URL(TEST_ENV.SUPABASE_URL).hostname.split(".")[0];
  const json = JSON.stringify(session);
  const b64url = Buffer.from(json, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const authCookie = `sb-${host}-auth-token=base64-${b64url}`;
  return orgId ? `${authCookie}; nudgepay-org=${orgId}` : authCookie;
}

async function signInSession(email: string): Promise<object> {
  const anon = createClient(TEST_ENV.SUPABASE_URL, TEST_ENV.SUPABASE_ANON_KEY);
  const { data, error } = await anon.auth.signInWithPassword({ email, password: "test-pass-123" });
  if (error) throw error;
  return data.session!;
}

async function postMembers(cookie: string, fields: Record<string, string>): Promise<Response> {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  return action({
    request: new Request("http://localhost/api/members", {
      method: "POST",
      headers: { Cookie: cookie, Origin: "http://localhost" },
      body: form,
    }),
    context: ctx(),
    params: {},
  } as any) as Promise<Response>;
}

test("owner revokes a pending invite", async () => {
  const svc = serviceClient();
  const { data: org } = await svc.from("organizations")
    .insert({ name: `Revoke pending ${Math.random()}` }).select("id").single();
  const orgId = org!.id as string;
  const email = `revoke-owner-${Math.random()}@example.com`;
  const owner = await makeUserClient(email);
  await svc.from("memberships").insert({ org_id: orgId, user_id: owner.userId, role: "owner" });
  const { data: inv } = await svc.from("invites")
    .insert({ org_id: orgId, email: `pending-${Math.random()}@example.com` })
    .select("id").single();

  const cookie = sessionCookie(await signInSession(email), orgId);
  const res = await postMembers(cookie, {
    intent: "revoke",
    inviteId: inv!.id,
    returnTo: "/settings",
  });

  expect(res.status).toBe(302);
  expect(res.headers.get("Location") ?? "").toMatch(/\/settings/);
  expect(res.headers.get("Location") ?? "").not.toContain("saved=invite_revoked");
  const { data: rows } = await svc.from("invites").select("id").eq("id", inv!.id);
  expect(rows ?? []).toHaveLength(0);
});

test("member cannot revoke a pending invite", async () => {
  const svc = serviceClient();
  const { data: org } = await svc.from("organizations")
    .insert({ name: `Revoke member ${Math.random()}` }).select("id").single();
  const orgId = org!.id as string;
  const owner = await makeUserClient(`revoke-mem-owner-${Math.random()}@example.com`);
  const memberEmail = `revoke-mem-${Math.random()}@example.com`;
  const member = await makeUserClient(memberEmail);
  await svc.from("memberships").insert([
    { org_id: orgId, user_id: owner.userId, role: "owner" },
    { org_id: orgId, user_id: member.userId, role: "member" },
  ]);
  const { data: inv } = await svc.from("invites")
    .insert({ org_id: orgId, email: `pending-mem-${Math.random()}@example.com` })
    .select("id").single();

  const cookie = sessionCookie(await signInSession(memberEmail), orgId);
  const res = await postMembers(cookie, {
    intent: "revoke",
    inviteId: inv!.id,
    returnTo: "/settings",
  });

  expect(res.status).toBe(302);
  expect(res.headers.get("Location") ?? "").toContain("error=forbidden");
  const { data: rows } = await svc.from("invites").select("id").eq("id", inv!.id);
  expect(rows).toHaveLength(1);
});

test("accepted invite is not deleted by revoke", async () => {
  const svc = serviceClient();
  const { data: org } = await svc.from("organizations")
    .insert({ name: `Revoke accepted ${Math.random()}` }).select("id").single();
  const orgId = org!.id as string;
  const email = `revoke-accepted-${Math.random()}@example.com`;
  const owner = await makeUserClient(email);
  await svc.from("memberships").insert({ org_id: orgId, user_id: owner.userId, role: "owner" });
  const { data: inv } = await svc.from("invites")
    .insert({
      org_id: orgId,
      email: `accepted-${Math.random()}@example.com`,
      accepted_at: new Date().toISOString(),
    })
    .select("id").single();

  const cookie = sessionCookie(await signInSession(email), orgId);
  const res = await postMembers(cookie, {
    intent: "revoke",
    inviteId: inv!.id,
    returnTo: "/settings",
  });

  expect(res.status).toBe(302);
  expect(res.headers.get("Location") ?? "").toContain("error=revoke");
  const { data: rows } = await svc.from("invites").select("id, accepted_at").eq("id", inv!.id);
  expect(rows).toHaveLength(1);
  expect(rows![0].accepted_at).toBeTruthy();
});

test("admin can revoke a pending invite", async () => {
  const svc = serviceClient();
  const { data: org } = await svc.from("organizations")
    .insert({ name: `Revoke admin ${Math.random()}` }).select("id").single();
  const orgId = org!.id as string;
  const owner = await makeUserClient(`revoke-admin-owner-${Math.random()}@example.com`);
  const adminEmail = `revoke-admin-${Math.random()}@example.com`;
  const admin = await makeUserClient(adminEmail);
  await svc.from("memberships").insert([
    { org_id: orgId, user_id: owner.userId, role: "owner" },
    { org_id: orgId, user_id: admin.userId, role: "admin" },
  ]);
  const { data: inv } = await svc.from("invites")
    .insert({ org_id: orgId, email: `pending-admin-${Math.random()}@example.com` })
    .select("id").single();

  const cookie = sessionCookie(await signInSession(adminEmail), orgId);
  const res = await postMembers(cookie, {
    intent: "revoke",
    inviteId: inv!.id,
    returnTo: "/settings",
  });

  expect(res.status).toBe(302);
  expect(res.headers.get("Location") ?? "").not.toContain("error=forbidden");
  const { data: rows } = await svc.from("invites").select("id").eq("id", inv!.id);
  expect(rows ?? []).toHaveLength(0);
});

test("admin cannot grant owner", async () => {
  const svc = serviceClient();
  const { data: org } = await svc.from("organizations")
    .insert({ name: `Admin grant owner ${Math.random()}` }).select("id").single();
  const orgId = org!.id as string;
  const owner = await makeUserClient(`admin-grant-owner-${Math.random()}@example.com`);
  const adminEmail = `admin-grant-${Math.random()}@example.com`;
  const admin = await makeUserClient(adminEmail);
  const member = await makeUserClient(`admin-grant-mem-${Math.random()}@example.com`);
  await svc.from("memberships").insert([
    { org_id: orgId, user_id: owner.userId, role: "owner" },
    { org_id: orgId, user_id: admin.userId, role: "admin" },
    { org_id: orgId, user_id: member.userId, role: "member" },
  ]);

  const cookie = sessionCookie(await signInSession(adminEmail), orgId);
  const res = await postMembers(cookie, {
    intent: "role",
    userId: member.userId,
    role: "owner",
    returnTo: "/settings",
  });

  expect(res.status).toBe(302);
  expect(res.headers.get("Location") ?? "").toContain("error=");
  const { data: mem } = await svc.from("memberships")
    .select("role").eq("org_id", orgId).eq("user_id", member.userId).single();
  expect(mem?.role).toBe("member");
});

test("owner member mutations use RLS and report zero affected rows as an error", async () => {
  const svc = serviceClient();
  const ownerEmail = `member-write-owner-${Math.random()}@example.com`;
  const owner = await makeUserClient(ownerEmail);
  const member = await makeUserClient(`member-write-target-${Math.random()}@example.com`);
  const { data: org } = await svc.from("organizations")
    .insert({ name: `Member writes ${Math.random()}` }).select("id").single();
  const orgId = org!.id as string;
  await svc.from("memberships").insert([
    { org_id: orgId, user_id: owner.userId, role: "owner" },
    { org_id: orgId, user_id: member.userId, role: "member" },
  ]);
  const cookie = sessionCookie(await signInSession(ownerEmail), orgId);

  const missing = await postMembers(cookie, {
    intent: "remove",
    userId: crypto.randomUUID(),
    returnTo: "/settings",
  });
  expect(missing.headers.get("Location") ?? "").toContain("error=member");

  const changed = await postMembers(cookie, {
    intent: "role",
    userId: member.userId,
    role: "admin",
    returnTo: "/settings",
  });
  expect(changed.headers.get("Location") ?? "").toContain("saved=member");
  const { data: promoted } = await svc.from("memberships")
    .select("role").eq("org_id", orgId).eq("user_id", member.userId).single();
  expect(promoted?.role).toBe("admin");

  const removed = await postMembers(cookie, {
    intent: "remove",
    userId: member.userId,
    returnTo: "/settings",
  });
  expect(removed.headers.get("Location") ?? "").toContain("saved=member");
  const { data: remaining } = await svc.from("memberships")
    .select("user_id").eq("org_id", orgId).eq("user_id", member.userId);
  expect(remaining ?? []).toHaveLength(0);
});

