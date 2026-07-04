import { expect, test } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { serviceClient, makeUserClient, TEST_ENV } from "./helpers";
import { parseContactLogForm } from "../app/lib/contact-log";
import { action as contactLogAction } from "../app/routes/api.contact-logs";
import { createPromiseForLog } from "../app/lib/promise-create.server";
import { applyNextStep } from "../app/lib/next-step.server";
import { fd } from "./fd";

// ── Task 3.4: direct action-invocation helpers (fetcher-error conversion) ────
// Mirrors the cookie-session pattern used in save-email.action.test.ts so the
// action can be called exactly as the route runtime calls it (cookie auth,
// not the RLS user client directly).

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

// The action returns a real Response for the redirect (success) path, but for
// the 400 paths it returns react-router's `data()` wrapper — a
// `DataWithResponseInit` object, NOT a Response — because the framework only
// serializes that wrapper into an HTTP response when the request goes through
// the router/server runtime. Calling the action function directly (as these
// tests do) surfaces the raw wrapper, so callers must branch on shape.
async function postContactLog(cookie: string, fields: Record<string, string>): Promise<any> {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  return contactLogAction({
    request: new Request("http://localhost/api/contact-logs", {
      method: "POST",
      headers: { Cookie: cookie, Origin: "http://localhost" },
      body: form,
    }),
    context: ctx(),
    params: {},
  } as any);
}

// ── Task 1: migration columns exist and accept promise data ──────────────────
test("contact_logs accepts promised_amount and promised_date", async () => {
  const svc = serviceClient();
  const { data: org } = await svc.from("organizations").insert({ name: "Promise Cols Org" }).select("id").single();
  const orgId = org!.id;
  const { data: cust } = await svc.from("customers")
    .insert({ org_id: orgId, qbo_id: "pc-c1", name: "Promise Co" }).select("id").single();
  const { data: inv } = await svc.from("invoices")
    .insert({ org_id: orgId, qbo_id: "pc-i1", customer_id: cust!.id, amount: 1000, balance: 1000, due_date: "2026-03-01", status: "overdue" })
    .select("id").single();
  const user = await makeUserClient("promise-cols@example.com");
  await svc.from("memberships").insert({ org_id: orgId, user_id: user.userId, role: "owner" });

  const { data: row, error } = await svc.from("contact_logs").insert({
    org_id: orgId, invoice_id: inv!.id, customer_id: cust!.id, user_id: user.userId,
    method: "call", outcome: "promise-to-pay", notes: "spoke with AP",
    promised_amount: 500.5, promised_date: "2026-07-01",
  }).select("promised_amount, promised_date").single();

  expect(error).toBeNull();
  expect(Number(row!.promised_amount)).toBe(500.5);
  expect(row!.promised_date).toBe("2026-07-01");
});

// ── Task 3: parseContactLogForm pure validator ───────────────────────────────

test("parse: valid call with no promise", () => {
  const r = parseContactLogForm(fd({ caseId: "case-1", invoiceId: "i1", method: "call", outcome: "no-answer", nextStep: "follow_up", followUpAt: "2026-07-05" }));
  expect(r).toEqual({ ok: true, fields: {
    caseId: "case-1", invoiceId: "i1", customerId: null, method: "call", outcome: "no-answer",
    notes: null, nextStep: "follow_up", followUpAt: "2026-07-05", promisedAmount: null, promisedDate: null,
    reviewAt: null, exceptionReason: null, exceptionNote: null,
  }});
});

test("parse: promise-to-pay requires amount and date", () => {
  expect(parseContactLogForm(fd({ caseId: "case-1", invoiceId: "i1", method: "call", outcome: "promise-to-pay", nextStep: "promise" })))
    .toEqual({ ok: false, error: "promise-required" });
  expect(parseContactLogForm(fd({ caseId: "case-1", invoiceId: "i1", method: "call", outcome: "promise-to-pay", nextStep: "promise", promisedAmount: "500" })))
    .toEqual({ ok: false, error: "promise-required" });
});

test("parse: promise-to-pay valid", () => {
  const r = parseContactLogForm(fd({
    caseId: "case-1", invoiceId: "i1", customerId: "c1", method: "call", outcome: "promise-to-pay",
    nextStep: "promise", promisedAmount: "500.50", promisedDate: "2026-07-01", notes: "  AP will pay  ",
  }));
  expect(r).toEqual({ ok: true, fields: {
    caseId: "case-1", invoiceId: "i1", customerId: "c1", method: "call", outcome: "promise-to-pay",
    notes: "AP will pay", nextStep: "promise", followUpAt: null, promisedAmount: 500.5, promisedDate: "2026-07-01",
    reviewAt: null, exceptionReason: null, exceptionNote: null,
  }});
});

test("parse: rejects bad amount, bad date, bad method, bad outcome, missing case", () => {
  expect(parseContactLogForm(fd({ caseId: "case-1", invoiceId: "i1", method: "call", outcome: "promise-to-pay", nextStep: "promise", promisedAmount: "-5", promisedDate: "2026-07-01" })).ok).toBe(false);
  expect(parseContactLogForm(fd({ caseId: "case-1", invoiceId: "i1", method: "call", outcome: "promise-to-pay", nextStep: "promise", promisedAmount: "abc", promisedDate: "2026-07-01" }))).toEqual({ ok: false, error: "bad-amount" });
  expect(parseContactLogForm(fd({ caseId: "case-1", invoiceId: "i1", method: "call", outcome: "promise-to-pay", nextStep: "promise", promisedAmount: "500", promisedDate: "nope" }))).toEqual({ ok: false, error: "bad-date" });
  expect(parseContactLogForm(fd({ caseId: "case-1", invoiceId: "i1", method: "smoke", outcome: "no-answer" }))).toEqual({ ok: false, error: "bad-method" });
  expect(parseContactLogForm(fd({ caseId: "case-1", invoiceId: "i1", method: "call", outcome: "vibes" }))).toEqual({ ok: false, error: "bad-outcome" });
  expect(parseContactLogForm(fd({ method: "call", outcome: "no-answer" }))).toEqual({ ok: false, error: "missing-case" });
});

test("parse: rejects malformed follow-up date", () => {
  expect(parseContactLogForm(fd({ caseId: "case-1", invoiceId: "i1", method: "note", outcome: "other", nextStep: "follow_up", followUpAt: "2026-13-99" })))
    .toEqual({ ok: false, error: "next-step-date" });
});

// ── Task 5: case-anchored contact log + case status update ───────────────────

test("a case-anchored contact log updates the case to working with the follow-up date", async () => {
  const svc = serviceClient();
  const user = await makeUserClient("contact-case@example.com");
  const { data: org } = await svc.from("organizations").insert({ name: "Contact Case Org" }).select("id").single();
  const orgId = org!.id;
  await svc.from("memberships").insert({ org_id: orgId, user_id: user.userId, role: "owner" });
  const { data: cust } = await svc.from("customers")
    .insert({ org_id: orgId, qbo_id: "cc-c1", name: "Case Co" }).select("id").single();
  const { data: cse } = await svc.from("collection_cases")
    .insert({ org_id: orgId, customer_id: cust!.id, status: "new", next_action_type: "contact" })
    .select("id").single();

  // Insert via the USER client (RLS path the route uses) + update the case.
  const { error: insErr } = await user.client.from("contact_logs").insert({
    org_id: orgId, case_id: cse!.id, customer_id: cust!.id, user_id: user.userId,
    method: "call", outcome: "no-answer", follow_up_at: "2026-07-01",
  });
  expect(insErr).toBeNull();

  const { error: updErr } = await user.client.from("collection_cases")
    .update({ status: "working", next_action_type: "follow_up", next_action_at: "2026-07-01" })
    .eq("id", cse!.id);
  expect(updErr).toBeNull();

  const { data: row } = await user.client.from("collection_cases").select("status, next_action_at").eq("id", cse!.id).single();
  expect(row!.status).toBe("working");
  expect(row!.next_action_at).toBe("2026-07-01");
});

test("the cross-org case guard: a user cannot read a foreign org's case by id", async () => {
  const svc = serviceClient();
  // Org A: the caller, with a member user client.
  const userA = await makeUserClient("contact-case-xorg-a@example.com");
  const { data: orgA } = await svc.from("organizations").insert({ name: "XOrg Case A" }).select("id").single();
  await svc.from("memberships").insert({ org_id: orgA!.id, user_id: userA.userId, role: "owner" });

  // Org B: a separate org with its own case the caller has no membership in.
  const { data: orgB } = await svc.from("organizations").insert({ name: "XOrg Case B" }).select("id").single();
  const { data: custB } = await svc.from("customers")
    .insert({ org_id: orgB!.id, qbo_id: "xorg-b-c1", name: "Foreign Co" }).select("id").single();
  const { data: caseB } = await svc.from("collection_cases")
    .insert({ org_id: orgB!.id, customer_id: custB!.id, status: "new", next_action_type: "contact" })
    .select("id").single();

  // The route's guard: read collection_cases by caseId via the USER client.
  // RLS must block org A's user from seeing org B's case → null (→ "missing-case").
  const { data: foreign } = await userA.client
    .from("collection_cases").select("id").eq("id", caseB!.id).maybeSingle();
  expect(foreign).toBeNull();
});

// ── Task 4: RLS user client inserts a contact log ────────────────────────────

// Build a minimal env/context the action expects (getEnv reads from context).
// The action uses requireUser (cookie-based). For a direct-call test we instead
// assert the RLS insert path via a user client, mirroring the action's writes.
test("RLS user client inserts a contact log readable back within the org", async () => {
  const svc = serviceClient();
  const { data: org } = await svc.from("organizations").insert({ name: "Log Insert Org" }).select("id").single();
  const orgId = org!.id;
  const { data: cust } = await svc.from("customers")
    .insert({ org_id: orgId, qbo_id: "li-c1", name: "Logged Co" }).select("id").single();
  const { data: inv } = await svc.from("invoices")
    .insert({ org_id: orgId, qbo_id: "li-i1", customer_id: cust!.id, amount: 900, balance: 900, due_date: "2026-02-01", status: "overdue" })
    .select("id").single();
  const user = await makeUserClient("log-insert@example.com");
  await svc.from("memberships").insert({ org_id: orgId, user_id: user.userId, role: "member" });

  const { error: insErr } = await user.client.from("contact_logs").insert({
    org_id: orgId, invoice_id: inv!.id, customer_id: cust!.id, user_id: user.userId,
    method: "call", outcome: "promise-to-pay", notes: "will pay",
    promised_amount: 300, promised_date: "2026-07-15", follow_up_at: null,
  });
  expect(insErr).toBeNull();

  const { data: rows } = await user.client.from("contact_logs")
    .select("user_id, method, promised_amount, promised_date").eq("invoice_id", inv!.id);
  expect(rows!.length).toBe(1);
  expect(rows![0].user_id).toBe(user.userId);
  expect(Number(rows![0].promised_amount)).toBe(300);
  expect(rows![0].promised_date).toBe("2026-07-15");
});

// ── Task 10: createPromiseForLog supersedes prior pending promise ─────────────

test("createPromiseForLog supersedes a prior pending promise and links case invoices", async () => {
  const svc = serviceClient();
  const user = await makeUserClient("promise-create@example.com");
  const { data: org } = await svc.from("organizations").insert({ name: `PCreate ${user.userId}` }).select("id").single();
  const orgId = org!.id;
  await svc.from("memberships").insert({ org_id: orgId, user_id: user.userId, role: "owner" });
  const { data: cust } = await svc.from("customers").insert({ org_id: orgId, qbo_id: `pc-${user.userId}`, name: "Acme" }).select("id").single();
  const { data: inv } = await svc.from("invoices").insert({
    org_id: orgId, qbo_id: `pci-${user.userId}`, qbo_doc_number: "1", customer_id: cust!.id,
    amount: 1200, balance: 1200, due_date: "2026-03-01", status: "overdue",
  }).select("id").single();
  const { data: cse } = await svc.from("collection_cases").insert({ org_id: orgId, customer_id: cust!.id, status: "working" }).select("id").single();

  const first = await createPromiseForLog(user.client, {
    orgId, caseId: cse!.id, customerId: cust!.id, userId: user.userId,
    contactLogId: null, promisedAmount: 500, promisedDate: "2026-07-01",
  });
  expect(first.ok).toBe(true);

  const second = await createPromiseForLog(user.client, {
    orgId, caseId: cse!.id, customerId: cust!.id, userId: user.userId,
    contactLogId: null, promisedAmount: 800, promisedDate: "2026-07-10",
  });
  expect(second.ok).toBe(true);

  const { data: rows } = await svc.from("promises").select("id, status, replacement_promise_id, grace_until, baseline_balance").eq("org_id", orgId).order("created_at");
  expect(rows!.length).toBe(2);
  expect(rows![0].status).toBe("renegotiated");
  expect(rows![0].replacement_promise_id).toBe(rows![1].id);
  expect(rows![1].status).toBe("pending");
  expect(Number(rows![1].baseline_balance)).toBe(1200);
  expect(rows![1].grace_until).toBe("2026-07-14"); // 2026-07-10 is Fri -> +2 business days = Tue 14th

  const { data: caseRow } = await svc.from("collection_cases").select("status, next_action_type, next_action_at").eq("id", cse!.id).single();
  expect(caseRow!.status).toBe("promised");
  expect(caseRow!.next_action_type).toBe("promise");
  expect(caseRow!.next_action_at).toBe("2026-07-14");
});

// ── Task 3: applyNextStep ────────────────────────────────────────────────────

async function seedCase(svc: ReturnType<typeof serviceClient>, suffix: string, status = "working") {
  const { data: org } = await svc.from("organizations").insert({ name: `NS ${suffix} ${Math.random()}` }).select("id").single();
  const orgId = org!.id;
  const { data: cust } = await svc.from("customers").insert({ org_id: orgId, qbo_id: `ns-${suffix}-${Math.random()}`, name: "Acme" }).select("id").single();
  const { data: cse } = await svc.from("collection_cases").insert({ org_id: orgId, customer_id: cust!.id, status }).select("id").single();
  return { orgId, customerId: cust!.id, caseId: cse!.id };
}

test("applyNextStep waiting sets waiting state + review date and clears exception cols", async () => {
  const svc = serviceClient();
  const { orgId, caseId } = await seedCase(svc, "wait", "on_hold");
  await svc.from("collection_cases").update({ exception_reason: "disputed", exception_note: "x" }).eq("id", caseId);
  const res = await applyNextStep(svc, orgId, caseId, { nextStep: "waiting", followUpAt: null, promisedAmount: null, promisedDate: null, reviewAt: "2026-07-08", exceptionReason: null, exceptionNote: null });
  expect(res.ok).toBe(true);
  const { data: c } = await svc.from("collection_cases").select("status, next_action_type, next_action_at, exception_reason, exception_note").eq("id", caseId).single();
  expect(c!.status).toBe("waiting");
  expect(c!.next_action_type).toBe("waiting");
  expect(c!.next_action_at).toBe("2026-07-08");
  expect(c!.exception_reason).toBeNull();
  expect(c!.exception_note).toBeNull();
});

test("applyNextStep exception sets on_hold + reason/note", async () => {
  const svc = serviceClient();
  const { orgId, caseId } = await seedCase(svc, "exc");
  const res = await applyNextStep(svc, orgId, caseId, { nextStep: "exception", followUpAt: null, promisedAmount: null, promisedDate: null, reviewAt: "2026-07-08", exceptionReason: "payment_plan", exceptionNote: "3 installments" });
  expect(res.ok).toBe(true);
  const { data: c } = await svc.from("collection_cases").select("status, next_action_type, next_action_at, exception_reason, exception_note").eq("id", caseId).single();
  expect(c!.status).toBe("on_hold");
  expect(c!.next_action_type).toBe("exception");
  expect(c!.exception_reason).toBe("payment_plan");
  expect(c!.exception_note).toBe("3 installments");
});

test("applyNextStep waiting cancels a pending promise without resetting the case", async () => {
  const svc = serviceClient();
  const { orgId, customerId, caseId } = await seedCase(svc, "cancel", "promised");
  const { data: prom } = await svc.from("promises").insert({
    org_id: orgId, case_id: caseId, customer_id: customerId, status: "pending",
    promised_amount: 500, promised_date: "2026-07-01", grace_until: "2026-07-03", baseline_balance: 1200,
  }).select("id").single();
  const res = await applyNextStep(svc, orgId, caseId, { nextStep: "waiting", followUpAt: null, promisedAmount: null, promisedDate: null, reviewAt: "2026-07-08", exceptionReason: null, exceptionNote: null });
  expect(res.ok).toBe(true);
  const { data: p } = await svc.from("promises").select("status").eq("id", prom!.id).single();
  expect(p!.status).toBe("cancelled");
  const { data: c } = await svc.from("collection_cases").select("status").eq("id", caseId).single();
  expect(c!.status).toBe("waiting"); // NOT reset to working
});

test("applyNextStep follow_up sets working + follow-up date, leaves a pending promise intact", async () => {
  const svc = serviceClient();
  const { orgId, customerId, caseId } = await seedCase(svc, "fu", "promised");
  const { data: prom } = await svc.from("promises").insert({
    org_id: orgId, case_id: caseId, customer_id: customerId, status: "pending",
    promised_amount: 500, promised_date: "2026-07-01", grace_until: "2026-07-03", baseline_balance: 1200,
  }).select("id").single();
  const res = await applyNextStep(svc, orgId, caseId, { nextStep: "follow_up", followUpAt: "2026-07-05", promisedAmount: null, promisedDate: null, reviewAt: null, exceptionReason: null, exceptionNote: null });
  expect(res.ok).toBe(true);
  const { data: c } = await svc.from("collection_cases").select("status, next_action_type, next_action_at").eq("id", caseId).single();
  expect(c!.status).toBe("working");
  expect(c!.next_action_at).toBe("2026-07-05");
  const { data: p } = await svc.from("promises").select("status").eq("id", prom!.id).single();
  expect(p!.status).toBe("pending"); // untouched
});

// ── Task 3.4: action returns validation errors as data(), not redirects ──────
// (F-035 — a fetcher-driven form must not lose field state on a failed submit,
// which a redirect would force by remounting the drawer.)

test("action: invalid form data returns 400 with { ok:false, error } and writes nothing", async () => {
  const svc = serviceClient();
  const { data: org } = await svc.from("organizations").insert({ name: `CL-err ${Math.random()}` }).select("id").single();
  const orgId = org!.id as string;
  const email = `cl-err-${Math.random()}@example.com`;
  const owner = await makeUserClient(email);
  await svc.from("memberships").insert({ org_id: orgId, user_id: owner.userId, role: "owner" });
  const { data: cust } = await svc.from("customers")
    .insert({ org_id: orgId, qbo_id: `cl-err-c1-${Math.random()}`, name: "Err Co" }).select("id").single();
  const { data: cse } = await svc.from("collection_cases")
    .insert({ org_id: orgId, customer_id: cust!.id, status: "new", next_action_type: "contact" })
    .select("id").single();

  const session = await signInSession(email);
  const cookie = sessionCookie(session);

  const res = await postContactLog(cookie, {
    returnTo: "/dashboard",
    caseId: cse!.id,
    method: "smoke-signal", // invalid: not in CONTACT_METHODS
    outcome: "no-answer",
  });

  // data() wraps { ok:false, error } with { status: 400 } — router serializes
  // this to a real 400 JSON response at request time; here we assert the wrapper.
  expect(res.init?.status).toBe(400);
  expect(res.data).toEqual({ ok: false, error: "bad-method" });

  const { data: rows } = await svc.from("contact_logs").select("id").eq("case_id", cse!.id);
  expect(rows!.length).toBe(0);
});

test("action: foreign-org caseId returns 400 missing-case (cross-org guard via the action)", async () => {
  const svc = serviceClient();
  const { data: orgA } = await svc.from("organizations").insert({ name: `CL-xa ${Math.random()}` }).select("id").single();
  const emailA = `cl-xa-${Math.random()}@example.com`;
  const ownerA = await makeUserClient(emailA);
  await svc.from("memberships").insert({ org_id: orgA!.id, user_id: ownerA.userId, role: "owner" });

  const { data: orgB } = await svc.from("organizations").insert({ name: `CL-xb ${Math.random()}` }).select("id").single();
  const { data: custB } = await svc.from("customers")
    .insert({ org_id: orgB!.id, qbo_id: `cl-xb-c1-${Math.random()}`, name: "Foreign Co" }).select("id").single();
  const { data: caseB } = await svc.from("collection_cases")
    .insert({ org_id: orgB!.id, customer_id: custB!.id, status: "new", next_action_type: "contact" })
    .select("id").single();

  const session = await signInSession(emailA);
  const cookie = sessionCookie(session);

  const res = await postContactLog(cookie, {
    returnTo: "/dashboard",
    caseId: caseB!.id,
    method: "call",
    outcome: "no-answer",
    nextStep: "waiting",
    reviewAt: "2026-07-08",
  });

  expect(res.init?.status).toBe(400);
  expect(res.data).toEqual({ ok: false, error: "missing-case" });
});

test("action: visible case from a non-active org returns 400 missing-case", async () => {
  const svc = serviceClient();
  const email = `cl-multi-${Math.random()}@example.com`;
  const user = await makeUserClient(email);

  const { data: orgA } = await svc.from("organizations").insert({ name: `CL-ma ${Math.random()}` }).select("id").single();
  await svc.from("memberships").insert({
    org_id: orgA!.id,
    user_id: user.userId,
    role: "owner",
    created_at: "2026-01-01T00:00:00Z",
  });

  const { data: orgB } = await svc.from("organizations").insert({ name: `CL-mb ${Math.random()}` }).select("id").single();
  await svc.from("memberships").insert({
    org_id: orgB!.id,
    user_id: user.userId,
    role: "member",
    created_at: "2026-01-02T00:00:00Z",
  });
  const { data: custB } = await svc.from("customers")
    .insert({ org_id: orgB!.id, qbo_id: `cl-mb-c1-${Math.random()}`, name: "Visible Foreign Co" }).select("id").single();
  const { data: caseB } = await svc.from("collection_cases")
    .insert({ org_id: orgB!.id, customer_id: custB!.id, status: "new", next_action_type: "contact" })
    .select("id").single();

  const session = await signInSession(email);
  const cookie = sessionCookie(session);

  const res = await postContactLog(cookie, {
    returnTo: "/dashboard",
    caseId: caseB!.id,
    customerId: custB!.id,
    method: "call",
    outcome: "no-answer",
    nextStep: "waiting",
    reviewAt: "2026-07-08",
  });

  expect(res.init?.status).toBe(400);
  expect(res.data).toEqual({ ok: false, error: "missing-case" });
  const { data: rows } = await svc.from("contact_logs").select("id").eq("case_id", caseB!.id);
  expect(rows ?? []).toHaveLength(0);
});

test("action: valid contact log inserts a row and redirects to returnTo?saved=1", async () => {
  const svc = serviceClient();
  const { data: org } = await svc.from("organizations").insert({ name: `CL-ok ${Math.random()}` }).select("id").single();
  const orgId = org!.id as string;
  const email = `cl-ok-${Math.random()}@example.com`;
  const owner = await makeUserClient(email);
  await svc.from("memberships").insert({ org_id: orgId, user_id: owner.userId, role: "owner" });
  const { data: cust } = await svc.from("customers")
    .insert({ org_id: orgId, qbo_id: `cl-ok-c1-${Math.random()}`, name: "OK Co" }).select("id").single();
  const { data: cse } = await svc.from("collection_cases")
    .insert({ org_id: orgId, customer_id: cust!.id, status: "new", next_action_type: "contact" })
    .select("id").single();

  const session = await signInSession(email);
  const cookie = sessionCookie(session);

  const res = await postContactLog(cookie, {
    returnTo: "/dashboard",
    caseId: cse!.id,
    customerId: cust!.id,
    method: "call",
    outcome: "no-answer",
    nextStep: "waiting",
    reviewAt: "2026-07-08",
  });

  expect(res.status).toBe(302);
  const location = res.headers.get("Location") ?? "";
  expect(location).toBe("/dashboard?saved=1");

  const { data: rows } = await svc.from("contact_logs").select("id, method, outcome").eq("case_id", cse!.id);
  expect(rows!.length).toBe(1);
  expect(rows![0].method).toBe("call");
  expect(rows![0].outcome).toBe("no-answer");
});
