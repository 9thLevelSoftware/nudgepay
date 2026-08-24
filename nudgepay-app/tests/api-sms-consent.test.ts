import { expect, test, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { serviceClient, makeUserClient, TEST_ENV } from "./helpers";
import { action as smsConsentAction } from "../app/routes/api.sms-consent";
import { sendInvoiceText } from "../app/lib/twilio-messaging.server";

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

// Members cannot write sms_consent* (KD-7). Direct PostgREST is the trust
// boundary — the /api/sms-consent action uses the user JWT.
test("a member cannot toggle sms_consent on an own-org customer via RLS", async () => {
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

  const { data: seen } = await user.client.from("invoices").select("customer_id").eq("id", inv!.id).maybeSingle();
  expect(seen?.customer_id).toBe(cust!.id);

  const { error } = await user.client.from("customers").update({ sms_consent: true }).eq("id", cust!.id);
  expect(error).not.toBeNull();
  const { data: after } = await svc.from("customers").select("sms_consent").eq("id", cust!.id).single();
  expect(after!.sms_consent).toBe(false);
});

test("a member cannot toggle sms_consent via a bare customerId (no invoice) under RLS", async () => {
  const svc = serviceClient();
  const { data: org } = await svc.from("organizations").insert({ name: "Consent Org C" }).select("id").single();
  const orgId = org!.id;
  const { data: cust } = await svc.from("customers")
    .insert({ org_id: orgId, qbo_id: "coc-c1", name: "No-Invoice Co", phone: "+13105550133", sms_consent: false })
    .select("id").single();
  const member = await makeUserClient("consent-c@example.com");
  await svc.from("memberships").insert({ org_id: orgId, user_id: member.userId, role: "member" });

  const { error } = await member.client.from("customers").update({ sms_consent: true }).eq("id", cust!.id);
  expect(error).not.toBeNull();
  let { data: after } = await svc.from("customers").select("sms_consent").eq("id", cust!.id).single();
  expect(after!.sms_consent).toBe(false);

  const outsider = await makeUserClient("consent-c-outsider@example.com");
  await outsider.client.from("customers").update({ sms_consent: false }).eq("id", cust!.id);
  ({ data: after } = await svc.from("customers").select("sms_consent").eq("id", cust!.id).single());
  expect(after!.sms_consent).toBe(false);
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

test("action rejects an invoice from another org", async () => {
  const svc = serviceClient();
  const email = `consent-multi-${Math.random()}@example.com`;
  const user = await makeUserClient(email);

  const { data: orgA } = await svc.from("organizations").insert({ name: "Consent Active A" }).select("id").single();
  await svc.from("memberships").insert({
    org_id: orgA!.id,
    user_id: user.userId,
    role: "owner",
  });

  const { data: orgB } = await svc.from("organizations").insert({ name: "Consent Visible B" }).select("id").single();
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

test("owner restore after inbound STOP still updates via the action", async () => {
  const svc = serviceClient();
  const email = `consent-restore-${Math.random()}@example.com`;
  const owner = await makeUserClient(email);
  const { data: org } = await svc.from("organizations").insert({ name: "Consent Restore" }).select("id").single();
  await svc.from("memberships").insert({ org_id: org!.id, user_id: owner.userId, role: "owner" });
  const stoppedAt = new Date().toISOString();
  const { data: cust } = await svc.from("customers")
    .insert({
      org_id: org!.id, qbo_id: `cr-${Math.random()}`, name: "Stopped Co",
      phone: "+13105550888",
      sms_consent: false, do_not_text: true,
      sms_consent_source: "inbound_stop", sms_consent_at: stoppedAt,
    })
    .select("id").single();
  const { data: inv } = await svc.from("invoices")
    .insert({
      org_id: org!.id, qbo_id: `cr-i-${Math.random()}`, customer_id: cust!.id,
      balance: 40, due_date: "2026-03-01",
    })
    .select("id").single();

  const session = await signInSession(email);
  const res = await postSmsConsent(sessionCookie(session), {
    returnTo: "/dashboard",
    customerId: cust!.id as string,
    consent: "true",
    reason: "customer called in",
  });
  expect(res.status).toBe(302);
  const loc = res.headers.get("Location") ?? "";
  expect(loc).not.toContain("sms=error");
  expect(loc).not.toContain("consent_locked");
  const { data: after } = await svc.from("customers")
    .select("sms_consent, sms_consent_source, do_not_text").eq("id", cust!.id).single();
  expect(after!.sms_consent).toBe(true);
  expect(after!.sms_consent_source).toBe("staff");
  expect(after!.do_not_text).toBe(false);

  const fetchFn = vi.fn(async () => new Response(JSON.stringify({ sid: "SM-RESTORE", status: "queued" }), {
    status: 201, headers: { "Content-Type": "application/json" },
  }));
  await sendInvoiceText({
    fetchFn,
    service: svc,
    twilio: { accountSid: "AC1", authToken: "tok" },
    defaultSender: { from: "+15005550006" },
    statusCallback: null,
    now: new Date("2026-06-15T18:00:00Z"),
  }, { orgId: org!.id as string, invoiceId: inv!.id as string, userId: owner.userId, body: "Pay up" });
  expect(fetchFn).toHaveBeenCalledOnce();
});
