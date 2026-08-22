import { expect, test } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { serviceClient, makeUserClient, TEST_ENV } from "./helpers";
import { action } from "../app/routes/api.members";

function ctx() {
  return { cloudflare: { env: TEST_ENV } } as any;
}

function sessionCookie(session: object): string {
  const host = new URL(TEST_ENV.SUPABASE_URL).hostname.split(".")[0];
  const json = JSON.stringify(session);
  const b64url = Buffer.from(json, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `sb-${host}-auth-token=base64-${b64url}`;
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

  const cookie = sessionCookie(await signInSession(email));
  const res = await postMembers(cookie, {
    intent: "revoke",
    inviteId: inv!.id,
    returnTo: "/settings",
  });

  expect(res.status).toBe(302);
  expect(res.headers.get("Location") ?? "").toContain("saved=invite_revoked");
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

  const cookie = sessionCookie(await signInSession(memberEmail));
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

  const cookie = sessionCookie(await signInSession(email));
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
