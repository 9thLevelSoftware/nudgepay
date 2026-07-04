import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { serviceClient, makeUserClient, TEST_ENV } from "./helpers";
import { action } from "../app/routes/api.org-settings";

// ---------------------------------------------------------------------------
// Helpers (mirrors tests/save-email.action.test.ts's cookie-session pattern)
// ---------------------------------------------------------------------------

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

async function postOrgSettings(cookie: string, fields: Record<string, string>): Promise<Response> {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  return action({
    request: new Request("http://localhost/api/org-settings", {
      method: "POST",
      headers: { Cookie: cookie, Origin: "http://localhost" },
      body: form,
    }),
    context: ctx(),
    params: {},
  } as any) as Promise<Response>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("save_workflow", () => {
  it("valid save_workflow persists org_settings and redirects ?saved=1", async () => {
    const svc = serviceClient();
    const { data: org } = await svc.from("organizations")
      .insert({ name: `SW-rt ${Math.random()}` }).select("id").single();
    const orgId = org!.id as string;
    const email = `sw-rt-${Math.random()}@example.com`;
    const owner = await makeUserClient(email);
    await svc.from("memberships").insert({ org_id: orgId, user_id: owner.userId, role: "owner" });

    const session = await signInSession(email);
    const cookie = sessionCookie(session);

    const res = await postOrgSettings(cookie, {
      intent: "save_workflow",
      returnTo: "/settings?tab=collections",
      coming_due_days: "14",
      due_soon_business_days: "5",
      sms_batch_limit: "100",
    });

    expect(res.status).toBe(302);
    const location = res.headers.get("Location") ?? "";
    expect(location).toContain("saved=1");

    const { data: row } = await svc.from("org_settings")
      .select("coming_due_days, due_soon_business_days, sms_batch_limit")
      .eq("org_id", orgId)
      .single();
    expect(row!.coming_due_days).toBe(14);
    expect(row!.due_soon_business_days).toBe(5);
    expect(row!.sms_batch_limit).toBe(100);
  });

  it("out-of-range sms_batch_limit redirects ?error=sms_batch_limit and writes nothing", async () => {
    const svc = serviceClient();
    const { data: org } = await svc.from("organizations")
      .insert({ name: `SW-err ${Math.random()}` }).select("id").single();
    const orgId = org!.id as string;
    const email = `sw-err-${Math.random()}@example.com`;
    const owner = await makeUserClient(email);
    await svc.from("memberships").insert({ org_id: orgId, user_id: owner.userId, role: "owner" });

    const session = await signInSession(email);
    const cookie = sessionCookie(session);

    const res = await postOrgSettings(cookie, {
      intent: "save_workflow",
      returnTo: "/settings?tab=collections",
      coming_due_days: "14",
      due_soon_business_days: "5",
      sms_batch_limit: "500", // out of range (max 200)
    });

    expect(res.status).toBe(302);
    const location = res.headers.get("Location") ?? "";
    expect(location).toContain("error=sms_batch_limit");

    const { data: row } = await svc.from("org_settings")
      .select("org_id")
      .eq("org_id", orgId)
      .maybeSingle();
    expect(row).toBeNull();
  });

  it("a non-owner member's save_workflow is a no-op redirect (owner-only gate)", async () => {
    const svc = serviceClient();
    const { data: org } = await svc.from("organizations")
      .insert({ name: `SW-member ${Math.random()}` }).select("id").single();
    const orgId = org!.id as string;
    const email = `sw-member-${Math.random()}@example.com`;
    const member = await makeUserClient(email);
    await svc.from("memberships").insert({ org_id: orgId, user_id: member.userId, role: "member" });

    const session = await signInSession(email);
    const cookie = sessionCookie(session);

    const res = await postOrgSettings(cookie, {
      intent: "save_workflow",
      returnTo: "/settings?tab=collections",
      coming_due_days: "14",
      due_soon_business_days: "5",
      sms_batch_limit: "100",
    });

    expect(res.status).toBe(302);
    const { data: row } = await svc.from("org_settings")
      .select("org_id")
      .eq("org_id", orgId)
      .maybeSingle();
    expect(row).toBeNull();
  });
});
