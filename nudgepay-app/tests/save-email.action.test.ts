import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { serviceClient, makeUserClient, TEST_ENV } from "./helpers";
import { action } from "../app/routes/api.org-settings";
import { parseCommPrefsUpdate } from "../app/routes/api.comm-prefs";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

function ctx() {
  return { cloudflare: { env: TEST_ENV } } as any;
}

/**
 * Build a request Cookie header that createServerClient (from @supabase/ssr,
 * which defaults to cookieEncoding:"base64url") can decode.
 *
 * Cookie name  : `sb-<hostname[0]>-auth-token`   (auth-js default storageKey:
 *                `sb-${new URL(url).hostname.split('.')[0]}-auth-token`)
 * Cookie value : `base64-<base64url(JSON.stringify(session))>`   (ssr prefix)
 */
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

/** Sign in with the shared test password used by makeUserClient. */
async function signInSession(email: string): Promise<object> {
  const anon = createClient(TEST_ENV.SUPABASE_URL, TEST_ENV.SUPABASE_ANON_KEY);
  const { data, error } = await anon.auth.signInWithPassword({
    email,
    password: "test-pass-123",
  });
  if (error) throw error;
  return data.session!;
}

/** POST to the api.org-settings action as a specific user (via cookie). */
async function postOrgSettings(
  cookie: string,
  fields: Record<string, string>,
): Promise<Response> {
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("save_email", () => {
  it("owner writes email_config via RLS (save_email DB path)", async () => {
    const svc = serviceClient();
    const { data: org } = await svc.from("organizations")
      .insert({ name: `SE ${Math.random()}` }).select("id").single();
    const orgId = org!.id as string;
    const owner = await makeUserClient(`se-owner-${Math.random()}@example.com`);
    await svc.from("memberships").insert({ org_id: orgId, user_id: owner.userId, role: "owner" });

    // Mirror the route's save_email upsert (owner client = RLS path).
    const { error } = await owner.client.from("email_config")
      .upsert(
        { org_id: orgId, email_enabled: true, from_address: "billing@x.com", from_name: "Chancey" },
        { onConflict: "org_id" },
      );
    expect(error).toBeNull();

    const { data: row } = await svc.from("email_config")
      .select("email_enabled, from_address, from_name").eq("org_id", orgId).single();
    expect(row!.email_enabled).toBe(true);
    expect(row!.from_address).toBe("billing@x.com");
    expect(row!.from_name).toBe("Chancey");
  });

  it("valid save_email persists email_config and redirects ?email_saved=1", async () => {
    const svc = serviceClient();
    const { data: org } = await svc.from("organizations")
      .insert({ name: `SE-rt ${Math.random()}` }).select("id").single();
    const orgId = org!.id as string;
    const email = `se-rt-${Math.random()}@example.com`;
    const owner = await makeUserClient(email);
    await svc.from("memberships").insert({ org_id: orgId, user_id: owner.userId, role: "owner" });

    // Obtain a full session for the auth cookie (makeUserClient already signed in
    // but only exposes the access_token; we need the complete session object that
    // @supabase/ssr reads from the cookie).
    const session = await signInSession(email);
    const cookie = sessionCookie(session);

    const res = await postOrgSettings(cookie, {
      intent: "save_email",
      returnTo: "/settings",
      email_enabled: "true",
      from_address: "billing@chancey.test",
      from_name: "Chancey Pay",
    });

    expect(res.status).toBe(302);
    const location = res.headers.get("Location") ?? "";
    expect(location).toContain("email_saved=1");

    // Confirm the DB write landed under the correct org.
    const { data: row } = await svc.from("email_config")
      .select("email_enabled, from_address, from_name")
      .eq("org_id", orgId)
      .single();
    expect(row!.email_enabled).toBe(true);
    expect(row!.from_address).toBe("billing@chancey.test");
    expect(row!.from_name).toBe("Chancey Pay");
  });

  it("malformed from_address redirects ?error=email and writes nothing", async () => {
    const svc = serviceClient();
    const { data: org } = await svc.from("organizations")
      .insert({ name: `SE-err ${Math.random()}` }).select("id").single();
    const orgId = org!.id as string;
    const email = `se-err-${Math.random()}@example.com`;
    const owner = await makeUserClient(email);
    await svc.from("memberships").insert({ org_id: orgId, user_id: owner.userId, role: "owner" });

    const session = await signInSession(email);
    const cookie = sessionCookie(session);

    const res = await postOrgSettings(cookie, {
      intent: "save_email",
      returnTo: "/settings",
      email_enabled: "true",
      from_address: "not-an-email", // fails parseEmailSettingsUpdate
      from_name: "",
    });

    expect(res.status).toBe(302);
    const location = res.headers.get("Location") ?? "";
    expect(location).toContain("error=email");

    // No email_config row must have been written for this org.
    const { data: row } = await svc.from("email_config")
      .select("org_id")
      .eq("org_id", orgId)
      .maybeSingle();
    expect(row).toBeNull();
  });

  it("parseCommPrefsUpdate includes do_not_email", () => {
    const r = parseCommPrefsUpdate(fd({ do_not_email: "true" }));
    expect((r as any).do_not_email).toBe(true);
    const r2 = parseCommPrefsUpdate(fd({}));
    expect((r2 as any).do_not_email).toBe(false);
  });
});
