import { expect, test, beforeAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { makeUserClient, serviceClient, TEST_ENV } from "./helpers";
import { resolveOrg, requireOrgUser } from "../app/lib/session.server";

let user: Awaited<ReturnType<typeof makeUserClient>>;
let orgId: string;

beforeAll(async () => {
  const svc = serviceClient();
  user = await makeUserClient("session-user@example.com");
  const { data: org } = await svc.from("organizations").insert({ name: "Session Org" }).select().single();
  orgId = org!.id;
  await svc.from("memberships").insert({ org_id: orgId, user_id: user.userId, role: "owner" });
});

test("resolveOrg returns the user's membership org and role", async () => {
  const result = await resolveOrg(user.client, user.userId);
  expect(result).toEqual({ org_id: orgId, role: "owner" });
});

test("resolveOrg returns null for a user with no membership", async () => {
  const orphan = await makeUserClient("orphan@example.com");
  const result = await resolveOrg(orphan.client, orphan.userId);
  expect(result).toBeNull();
});

// ---------------------------------------------------------------------------
// requireOrgUser
// ---------------------------------------------------------------------------

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

const env = {
  SUPABASE_URL: TEST_ENV.SUPABASE_URL,
  SUPABASE_ANON_KEY: TEST_ENV.SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_KEY: TEST_ENV.SUPABASE_SERVICE_KEY,
};

test("requireOrgUser returns supabase, headers, user, and org for a user with a membership", async () => {
  const session = await signInSession("session-user@example.com");
  const cookie = sessionCookie(session);
  const request = new Request("http://localhost/dashboard", { headers: { Cookie: cookie } });

  const result = await requireOrgUser(request, env);

  expect(result.user.id).toBe(user.userId);
  expect(result.org).toEqual({ org_id: orgId, role: "owner" });
  expect(result.supabase).toBeDefined();
  expect(result.headers).toBeInstanceOf(Headers);
});

test("requireOrgUser redirects to /onboarding for an authenticated user with no org", async () => {
  const email = "orphan-require-org@example.com";
  await makeUserClient(email);
  const session = await signInSession(email);
  const cookie = sessionCookie(session);
  const request = new Request("http://localhost/dashboard", { headers: { Cookie: cookie } });

  const thrown = await requireOrgUser(request, env).then(
    () => null,
    (err) => err,
  );

  expect(thrown).toBeInstanceOf(Response);
  expect((thrown as Response).status).toBe(302);
  expect((thrown as Response).headers.get("Location")).toBe("/onboarding");
});

test("requireOrgUser redirects to /login when there is no authenticated user", async () => {
  const request = new Request("http://localhost/dashboard");

  const thrown = await requireOrgUser(request, env).then(
    () => null,
    (err) => err,
  );

  expect(thrown).toBeInstanceOf(Response);
  expect((thrown as Response).status).toBe(302);
  expect((thrown as Response).headers.get("Location")).toBe("/login?returnTo=%2Fdashboard");
});
