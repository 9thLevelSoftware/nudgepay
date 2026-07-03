import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { serviceClient, makeUserClient, TEST_ENV } from "./helpers";
import { action } from "../app/routes/api.org-settings";

// ---------------------------------------------------------------------------
// Helpers (mirrors tests/save-workflow.action.test.ts's cookie-session pattern)
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
      headers: { Cookie: cookie },
      body: form,
    }),
    context: ctx(),
    params: {},
  } as any) as Promise<Response>;
}

async function ownerCookie(namePrefix: string): Promise<{ orgId: string; cookie: string }> {
  const svc = serviceClient();
  const { data: org } = await svc.from("organizations")
    .insert({ name: `${namePrefix} ${Math.random()}` }).select("id").single();
  const orgId = org!.id as string;
  const email = `${namePrefix.toLowerCase().replace(/[^a-z0-9]/g, "")}-${Math.random()}@example.com`;
  const owner = await makeUserClient(email);
  await svc.from("memberships").insert({ org_id: orgId, user_id: owner.userId, role: "owner" });
  const session = await signInSession(email);
  return { orgId, cookie: sessionCookie(session) };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("add_holiday", () => {
  it("persists a label alongside the date", async () => {
    const svc = serviceClient();
    const { orgId, cookie } = await ownerCookie("Holiday-label");

    const res = await postOrgSettings(cookie, {
      intent: "add_holiday",
      returnTo: "/settings?tab=collections",
      holiday_date: "2026-07-04",
      holiday_label: "Independence Day",
    });

    expect(res.status).toBe(302);
    expect(res.headers.get("Location") ?? "").toContain("saved=1");

    const { data: row } = await svc.from("org_holidays")
      .select("holiday_date, label").eq("org_id", orgId).eq("holiday_date", "2026-07-04").single();
    expect(row!.label).toBe("Independence Day");
  });

  it("stores null when no label is submitted", async () => {
    const svc = serviceClient();
    const { orgId, cookie } = await ownerCookie("Holiday-nolabel");

    const res = await postOrgSettings(cookie, {
      intent: "add_holiday",
      returnTo: "/settings?tab=collections",
      holiday_date: "2026-12-25",
    });

    expect(res.status).toBe(302);
    const { data: row } = await svc.from("org_holidays")
      .select("holiday_date, label").eq("org_id", orgId).eq("holiday_date", "2026-12-25").single();
    expect(row!.label).toBeNull();
  });

  it("trims and clamps an overlong label to 80 chars", async () => {
    const svc = serviceClient();
    const { orgId, cookie } = await ownerCookie("Holiday-longlabel");
    const long = "y".repeat(100);

    const res = await postOrgSettings(cookie, {
      intent: "add_holiday",
      returnTo: "/settings?tab=collections",
      holiday_date: "2026-11-26",
      holiday_label: long,
    });

    expect(res.status).toBe(302);
    const { data: row } = await svc.from("org_holidays")
      .select("label").eq("org_id", orgId).eq("holiday_date", "2026-11-26").single();
    expect(row!.label).toBe("y".repeat(80));
  });

  it("an invalid date is rejected and writes nothing", async () => {
    const svc = serviceClient();
    const { orgId, cookie } = await ownerCookie("Holiday-baddate");

    const res = await postOrgSettings(cookie, {
      intent: "add_holiday",
      returnTo: "/settings?tab=collections",
      holiday_date: "2026-02-31",
      holiday_label: "Nonsense",
    });

    expect(res.status).toBe(302);
    expect(res.headers.get("Location") ?? "").toContain("error=holiday");
    const { data: rows } = await svc.from("org_holidays").select("holiday_date").eq("org_id", orgId);
    expect(rows).toEqual([]);
  });

  it("a non-owner member's add_holiday is a no-op redirect (owner-only gate)", async () => {
    const svc = serviceClient();
    const { data: org } = await svc.from("organizations")
      .insert({ name: `Holiday-member ${Math.random()}` }).select("id").single();
    const orgId = org!.id as string;
    const email = `holiday-member-${Math.random()}@example.com`;
    const member = await makeUserClient(email);
    await svc.from("memberships").insert({ org_id: orgId, user_id: member.userId, role: "member" });
    const session = await signInSession(email);
    const cookie = sessionCookie(session);

    const res = await postOrgSettings(cookie, {
      intent: "add_holiday",
      returnTo: "/settings?tab=collections",
      holiday_date: "2026-07-04",
      holiday_label: "Independence Day",
    });

    expect(res.status).toBe(302);
    const { data: rows } = await svc.from("org_holidays").select("holiday_date").eq("org_id", orgId);
    expect(rows).toEqual([]);
  });
});
