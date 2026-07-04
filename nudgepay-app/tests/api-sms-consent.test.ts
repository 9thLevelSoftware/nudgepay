import { expect, test } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { serviceClient, makeUserClient, TEST_ENV } from "./helpers";
import { action as smsConsentAction } from "../app/routes/api.sms-consent";

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
  const { data, error } = await anon.auth.signInWithPassword({
    email,
    password: "test-pass-123",
  });
  if (error) throw error;
  return data.session!;
}

async function postSmsConsent(cookie: string, fields: Record<string, string>): Promise<Response> {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  return smsConsentAction({
    request: new Request("http://localhost/api/sms-consent", {
      method: "POST",
      headers: { Cookie: cookie, Origin: "http://localhost" },
      body: form,
    }),
    context: ctx(),
    params: {},
  } as any) as Promise<Response>;
}

// Mirrors the RLS path the /api/sms-consent action relies on: a member updates
// sms_consent on an own-org customer (resolved via an own-org invoice), and a
// member of another org cannot change it.
test("a member toggles sms_consent on an own-org customer via RLS", async () => {
  const svc = serviceClient();
  const { data: org } = await svc.from("organizations").insert({ name: "Consent Org A" }).select("id").single();
  const orgId = org!.id;
  const { data: cust } = await svc.from("customers")
    .insert({ org_id: orgId, qbo_id: "co-c1", name: "Consent Co", phone: "+13105550111", sms_consent: false })
    .select("id").single();
  const { data: inv } = await svc.from("invoices")
    .insert({ org_id: orgId, qbo_id: "co-i1", customer_id: cust!.id, amount: 700, balance: 700, due_date: "2026-03-01", status: "overdue" })
    .select("id").single();
  const user = await makeUserClient("consent-a@example.com");
  await svc.from("memberships").insert({ org_id: orgId, user_id: user.userId, role: "member" });

  // Resolve the invoice's customer (RLS-scoped) then flip consent on, off, on.
  const { data: seen } = await user.client.from("invoices").select("customer_id").eq("id", inv!.id).maybeSingle();
  expect(seen?.customer_id).toBe(cust!.id);

  await user.client.from("customers").update({ sms_consent: true }).eq("id", cust!.id);
  let { data: after } = await svc.from("customers").select("sms_consent").eq("id", cust!.id).single();
  expect(after!.sms_consent).toBe(true);

  await user.client.from("customers").update({ sms_consent: false }).eq("id", cust!.id);
  ({ data: after } = await svc.from("customers").select("sms_consent").eq("id", cust!.id).single());
  expect(after!.sms_consent).toBe(false);
});

// The Messages tab can toggle consent on invoice-less inbound-only threads via a
// bare customerId. Mirrors the action's customerId fallback: a member updates an
// own-org customer directly by id (RLS-scoped); an outsider cannot.
test("a member toggles sms_consent via a bare customerId (no invoice) under RLS", async () => {
  const svc = serviceClient();
  const { data: org } = await svc.from("organizations").insert({ name: "Consent Org C" }).select("id").single();
  const orgId = org!.id;
  const { data: cust } = await svc.from("customers")
    .insert({ org_id: orgId, qbo_id: "coc-c1", name: "No-Invoice Co", phone: "+13105550133", sms_consent: false })
    .select("id").single();
  const member = await makeUserClient("consent-c@example.com");
  await svc.from("memberships").insert({ org_id: orgId, user_id: member.userId, role: "member" });

  // No invoice exists — update the customer directly by id (the action's fallback path).
  await member.client.from("customers").update({ sms_consent: true }).eq("id", cust!.id);
  let { data: after } = await svc.from("customers").select("sms_consent").eq("id", cust!.id).single();
  expect(after!.sms_consent).toBe(true);

  // An outsider with a known customerId still cannot change it (RLS).
  const outsider = await makeUserClient("consent-c-outsider@example.com");
  await outsider.client.from("customers").update({ sms_consent: false }).eq("id", cust!.id);
  ({ data: after } = await svc.from("customers").select("sms_consent").eq("id", cust!.id).single());
  expect(after!.sms_consent).toBe(true); // unchanged — RLS blocked the cross-org update
});

test("a member of another org cannot read the invoice or change consent", async () => {
  const svc = serviceClient();
  const { data: org } = await svc.from("organizations").insert({ name: "Consent Org B" }).select("id").single();
  const orgId = org!.id;
  const { data: cust } = await svc.from("customers")
    .insert({ org_id: orgId, qbo_id: "cob-c1", name: "Private Co", sms_consent: true })
    .select("id").single();
  const { data: inv } = await svc.from("invoices")
    .insert({ org_id: orgId, qbo_id: "cob-i1", customer_id: cust!.id, amount: 500, balance: 500, due_date: "2026-03-01", status: "overdue" })
    .select("id").single();

  const outsider = await makeUserClient("consent-outsider@example.com");
  // No membership in Org B.
  const { data: seen } = await outsider.client.from("invoices").select("customer_id").eq("id", inv!.id).maybeSingle();
  expect(seen).toBeNull(); // RLS hides the invoice

  await outsider.client.from("customers").update({ sms_consent: false }).eq("id", cust!.id);
  const { data: after } = await svc.from("customers").select("sms_consent").eq("id", cust!.id).single();
  expect(after!.sms_consent).toBe(true); // unchanged — RLS blocked the update
});

test("action rejects a visible invoice from a non-active org for a multi-org user", async () => {
  const svc = serviceClient();
  const email = `consent-multi-${Math.random()}@example.com`;
  const user = await makeUserClient(email);

  const { data: orgA } = await svc.from("organizations").insert({ name: "Consent Active A" }).select("id").single();
  await svc.from("memberships").insert({
    org_id: orgA!.id,
    user_id: user.userId,
    role: "owner",
    created_at: "2026-01-01T00:00:00Z",
  });

  const { data: orgB } = await svc.from("organizations").insert({ name: "Consent Visible B" }).select("id").single();
  await svc.from("memberships").insert({
    org_id: orgB!.id,
    user_id: user.userId,
    role: "member",
    created_at: "2026-01-02T00:00:00Z",
  });
  const { data: custB } = await svc.from("customers")
    .insert({ org_id: orgB!.id, qbo_id: `consent-b-${Math.random()}`, name: "Visible B", sms_consent: true })
    .select("id")
    .single();
  const { data: invB } = await svc.from("invoices")
    .insert({ org_id: orgB!.id, qbo_id: `consent-bi-${Math.random()}`, customer_id: custB!.id, balance: 100 })
    .select("id")
    .single();

  const session = await signInSession(email);
  const res = await postSmsConsent(sessionCookie(session), {
    returnTo: "/dashboard",
    invoiceId: invB!.id as string,
    consent: "false",
  });

  expect(res.status).toBe(302);
  expect(res.headers.get("Location") ?? "").toContain("sms=error");
  const { data: after } = await svc.from("customers").select("sms_consent").eq("id", custB!.id).single();
  expect(after!.sms_consent).toBe(true);
});
