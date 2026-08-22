import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { expect, test } from "vitest";
import {
  ALREADY_IN_WORKSPACE,
  AlreadyInWorkspaceError,
  canJoinOrg,
  humanInviteError,
  isAlreadyInWorkspaceError,
} from "../app/lib/org-membership";
import { serviceClient, makeUserClient, TEST_ENV } from "./helpers";
import { action } from "../app/routes/api.members";

const ORG_A = "org-a";
const ORG_B = "org-b";

test("canJoinOrg allows joining when the user has no membership", () => {
  expect(canJoinOrg(null, ORG_A)).toBe("join");
  expect(canJoinOrg(undefined, ORG_A)).toBe("join");
  expect(canJoinOrg("", ORG_A)).toBe("join");
});

test("canJoinOrg treats the same org as already a member", () => {
  expect(canJoinOrg(ORG_A, ORG_A)).toBe("already_member");
});

test("canJoinOrg rejects a second, different org", () => {
  expect(canJoinOrg(ORG_A, ORG_B)).toBe("already_in_workspace");
});

test("canJoinOrg rejects creating an org when a membership already exists", () => {
  expect(canJoinOrg(ORG_A)).toBe("already_in_workspace");
  expect(canJoinOrg(ORG_A, null)).toBe("already_in_workspace");
});

test("canJoinOrg allows creating an org when the user has none", () => {
  expect(canJoinOrg(null)).toBe("join");
  expect(canJoinOrg(undefined, null)).toBe("join");
});

test("AlreadyInWorkspaceError carries the stable copy and code", () => {
  const err = new AlreadyInWorkspaceError();
  expect(err).toBeInstanceOf(Error);
  expect(err.message).toBe(ALREADY_IN_WORKSPACE);
  expect(err.code).toBe("already_in_workspace");
  expect(isAlreadyInWorkspaceError(err)).toBe(true);
});

test("humanInviteError surfaces already-in-a-workspace instead of a raw message", () => {
  expect(humanInviteError(new AlreadyInWorkspaceError())).toBe(ALREADY_IN_WORKSPACE);
  expect(humanInviteError(new Error(ALREADY_IN_WORKSPACE))).toBe(ALREADY_IN_WORKSPACE);
});

test("humanInviteError maps known invite failures to clear copy", () => {
  expect(humanInviteError(new Error("Invite not found"))).toMatch(/invalid or has been removed/i);
  expect(humanInviteError(new Error("Invite expired"))).toMatch(/new invite link/i);
  expect(humanInviteError(new Error("Invite already accepted"))).toMatch(/already been used/i);
  expect(humanInviteError(new Error("This invite was sent to a different email address"))).toMatch(
    /different email address/i,
  );
});

test("humanInviteError does not leak raw database errors", () => {
  expect(humanInviteError(new Error('duplicate key value violates unique constraint "memberships_user_id_key"'))).toBe(
    "Could not accept that invite. Try again or ask for a new link.",
  );
  expect(humanInviteError("not-an-error")).toBe(
    "Could not accept that invite. Try again or ask for a new link.",
  );
});

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
  expect(res.headers.get("Location") ?? "").toContain("saved=member");
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
  const { data: rows } = await svc.from("invites").select("id, accepted_at").eq("id", inv!.id);
  expect(rows).toHaveLength(1);
  expect(rows![0].accepted_at).toBeTruthy();
});

test("settings revoke uses useTwoStep submit, not TwoStepConfirm onConfirm", () => {
  const src = readFileSync(new URL("../app/routes/settings.tsx", import.meta.url), "utf8");
  expect(src).toContain('name="intent" value="revoke"');
  expect(src).toContain("useTwoStep");
  expect(src).toMatch(/type="submit"/);
  expect(src).not.toMatch(/<TwoStepConfirm/);
});
