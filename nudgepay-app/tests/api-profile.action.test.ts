import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { action } from "../app/routes/api.profile";
import { makeUserClient, serviceClient, TEST_ENV } from "./helpers";

function context() {
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
  const { data, error } = await anon.auth.signInWithPassword({
    email,
    password: "test-pass-123",
  });
  if (error) throw error;
  return data.session!;
}

async function leaveRequest(email: string, selectedOrgId: string): Promise<Response> {
  const session = await signInSession(email);
  const form = new FormData();
  form.set("intent", "delete");
  form.set("confirm", "LEAVE");
  form.set("returnTo", "/settings?tab=account");
  const request = new Request("http://localhost/api/profile", {
    method: "POST",
    headers: {
      Cookie: `${sessionCookie(session)}; nudgepay-org=${selectedOrgId}`,
      Origin: "http://localhost",
    },
    body: form,
  });
  return action({ request, context: context(), params: {} } as any) as Promise<Response>;
}

describe("leave workspace", () => {
  it("removes only the selected membership and preserves the user's other workspaces", async () => {
    const service = serviceClient();
    const suffix = crypto.randomUUID();
    const leaverEmail = `profile-leave-${suffix}@example.com`;
    const leaver = await makeUserClient(leaverEmail);
    const otherOwner = await makeUserClient(`profile-owner-${suffix}@example.com`);
    const { data: orgs, error: orgError } = await service
      .from("organizations")
      .insert([{ name: `Leave A ${suffix}` }, { name: `Keep B ${suffix}` }])
      .select("id");
    expect(orgError).toBeNull();
    const [leaveOrgId, keepOrgId] = orgs!.map((row) => row.id as string);
    const { error: membershipError } = await service.from("memberships").insert([
      { org_id: leaveOrgId, user_id: leaver.userId, role: "member" },
      { org_id: leaveOrgId, user_id: otherOwner.userId, role: "owner" },
      { org_id: keepOrgId, user_id: leaver.userId, role: "owner" },
    ]);
    expect(membershipError).toBeNull();

    const response = await leaveRequest(leaverEmail, leaveOrgId);

    expect(response.status).toBe(302);
    const { data: memberships, error } = await service
      .from("memberships")
      .select("org_id, role")
      .eq("user_id", leaver.userId);
    expect(error).toBeNull();
    expect(memberships).toEqual([{ org_id: keepOrgId, role: "owner" }]);
  });

  it("rejects a stale selected workspace without mutating the remaining membership", async () => {
    const service = serviceClient();
    const suffix = crypto.randomUUID();
    const leaverEmail = `profile-stale-${suffix}@example.com`;
    const leaver = await makeUserClient(leaverEmail);
    const otherOwner = await makeUserClient(`profile-stale-owner-${suffix}@example.com`);
    const { data: orgs, error: orgError } = await service
      .from("organizations")
      .insert([{ name: `Stale A ${suffix}` }, { name: `Valid B ${suffix}` }])
      .select("id");
    expect(orgError).toBeNull();
    const [staleOrgId, validOrgId] = orgs!.map((row) => row.id as string);
    const { error: membershipError } = await service.from("memberships").insert([
      { org_id: validOrgId, user_id: leaver.userId, role: "member" },
      { org_id: validOrgId, user_id: otherOwner.userId, role: "owner" },
    ]);
    expect(membershipError).toBeNull();

    const outcome = await leaveRequest(leaverEmail, staleOrgId).then(
      (response) => response,
      (error) => error as Response,
    );

    expect(outcome).toBeInstanceOf(Response);
    expect(outcome.status).toBe(409);
    const { data: memberships, error } = await service
      .from("memberships")
      .select("org_id, role")
      .eq("user_id", leaver.userId);
    expect(error).toBeNull();
    expect(memberships).toEqual([{ org_id: validOrgId, role: "member" }]);
  });
});
