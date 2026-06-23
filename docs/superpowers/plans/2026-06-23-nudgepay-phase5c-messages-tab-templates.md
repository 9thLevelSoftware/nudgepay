# Phase 5c — Messages Tab + SMS Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the detail-panel Messages tab into a real SMS thread (view conversation, toggle consent, pick a starter template, send a text) reusing the existing Twilio send path, and delete the prototype `/invoices/:id` page.

**Architecture:** Reads flow through the dashboard loader (RLS user client); writes flow through resource routes (`/api/text/send` made return-aware, new `/api/sms-consent`). Templates are a pure, unit-tested module of hardcoded starters with `{variable}` interpolation. A shared `safeReturnTo` guard de-duplicates the redirect-validation logic and fixes a masked 5b regression where the Log drawer's query-only `returnTo` was silently discarded.

**Tech Stack:** TypeScript, React Router v7 (framework mode) on Cloudflare Workers, Supabase Postgres + RLS, Tailwind v4 (CSS-first), Vitest against local Supabase.

## Global Constraints

- React Router v7 framework mode on Cloudflare Workers. **No `node:*` imports in `app/**`.** No client→`.server.ts` module-graph reference; pure modules stay suffix-free (`sms-templates.ts`, `return-to.ts` have NO `.server` suffix).
- Tailwind v4 CSS-first; **static literal class strings only** (no dynamic `bg-${x}`). Thermal tokens: cool/warm/hot; copper is the sole accent; ink/panel/surface/border/text/muted.
- Supabase RLS via `is_org_member(org_id)`. **User client (from `requireUser`) for all reads + the consent write.** The send route deliberately keeps its Phase-4 **service client** for the Twilio call + `text_messages` insert — it is org-scoped; do NOT re-architect it. The browser never touches the DB.
- A type-only `import type { X } from "~/routes/dashboard"` is erased at build and is safe (this is how `ActivityEntry` is already shared).
- Vitest against local Supabase; per-test **fresh orgs + globally-unique data**; **never** global truncation. Run via `npx vitest run`. Components verified by `npx tsc -b` + `npx react-router build` (no render-test infra).
- Conventional Commits. Never commit secrets. Never `git add` untracked prototype dirs or local-only scripts.
- **No new migration** — all required columns/tables already exist.
- Starter template copy and `returnTo` formats below are exact — copy verbatim.

---

## File Structure

| Action | File | Responsibility |
| --- | --- | --- |
| Create | `app/lib/sms-templates.ts` | Pure starter templates + `applyTemplate` |
| Create | `app/lib/return-to.ts` | Shared `safeReturnTo` open-redirect guard |
| Create | `app/routes/api.sms-consent.tsx` | RLS consent toggle, return-aware |
| Modify | `app/routes/api.text.send.tsx` | Add validated `returnTo`; redirect to dashboard tab |
| Modify | `app/routes/api.contact-logs.tsx` | Use shared `safeReturnTo` (no behavior change) |
| Modify | `app/routes/dashboard.tsx` | Loader: `selectedMessages`/`selectedConsent`/`selectedPhone`/`sms`; export `MessageEntry`; pass new props; fix Log-drawer `returnTo` to absolute |
| Modify | `app/components/DetailPanel.tsx` | Real Messages tab (consent, thread, templates, composer); repoint Text button |
| Delete | `app/routes/invoices.$id.tsx` | Folded into the Messages tab |
| Modify | `app/routes.ts` | Add `api/sms-consent`; remove `invoices/:id` |
| Create | `tests/sms-templates.test.ts` | Template unit tests |
| Create | `tests/return-to.test.ts` | `safeReturnTo` guard unit tests |
| Create | `tests/api-sms-consent.test.ts` | DB-backed RLS consent toggle |
| Modify | `tests/api-text-send.test.ts` | `returnTo`/`withSms` plumbing (NEW file) |
| Modify | `tests/dashboard-worklist.test.ts` | Selected-message read shape (RLS) |

---

## Task 1: SMS templates module

**Files:**
- Create: `nudgepay-app/app/lib/sms-templates.ts`
- Test: `nudgepay-app/tests/sms-templates.test.ts`

**Interfaces:**
- Produces: `SmsTemplate = { id: string; label: string; body: string }`; `TemplateVars = { customer: string; invoice: string; balance: string; dueDate: string }`; `SMS_TEMPLATES: SmsTemplate[]` (4 entries); `applyTemplate(body: string, vars: TemplateVars): string`.

- [ ] **Step 1: Write the failing test**

Create `nudgepay-app/tests/sms-templates.test.ts`:

```ts
import { expect, test } from "vitest";
import { SMS_TEMPLATES, applyTemplate, type TemplateVars } from "../app/lib/sms-templates";

const vars: TemplateVars = {
  customer: "Acme Co", invoice: "1042", balance: "$4,850.00", dueDate: "Mar 1, 2026",
};

test("applyTemplate substitutes all four variables", () => {
  const out = applyTemplate("{customer} owes {balance} on {invoice} (due {dueDate})", vars);
  expect(out).toBe("Acme Co owes $4,850.00 on 1042 (due Mar 1, 2026)");
});

test("applyTemplate leaves unknown tokens intact", () => {
  expect(applyTemplate("Hi {customer}, ref {unknown}", vars)).toBe("Hi Acme Co, ref {unknown}");
});

test("applyTemplate replaces repeated tokens", () => {
  expect(applyTemplate("{customer} {customer}", vars)).toBe("Acme Co Acme Co");
});

test("every starter renders without leftover known tokens", () => {
  for (const t of SMS_TEMPLATES) {
    const out = applyTemplate(t.body, vars);
    expect(out, t.id).not.toMatch(/\{(customer|invoice|balance|dueDate)\}/);
    expect(out.length).toBeGreaterThan(0);
  }
});

test("there are four starter templates with unique ids", () => {
  expect(SMS_TEMPLATES).toHaveLength(4);
  expect(new Set(SMS_TEMPLATES.map((t) => t.id)).size).toBe(4);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd nudgepay-app && npx vitest run tests/sms-templates.test.ts`
Expected: FAIL — cannot resolve `../app/lib/sms-templates`.

- [ ] **Step 3: Write minimal implementation**

Create `nudgepay-app/app/lib/sms-templates.ts`:

```ts
// Pure module (no I/O, no node:*, no secrets) — safe in both the client bundle
// and the server. Hardcoded starter SMS templates for the collections workspace.
// {customer} {invoice} {balance} {dueDate} are filled from the selected account.

export type SmsTemplate = { id: string; label: string; body: string };
export type TemplateVars = {
  customer: string;
  invoice: string;
  balance: string;
  dueDate: string;
};

export const SMS_TEMPLATES: SmsTemplate[] = [
  {
    id: "friendly-reminder",
    label: "Friendly reminder",
    body: "Hi {customer}, a friendly reminder that invoice {invoice} for {balance} was due {dueDate}. Reply with any questions. — Chancey Heating & Cooling",
  },
  {
    id: "past-due",
    label: "Past due",
    body: "Hi {customer}, invoice {invoice} ({balance}) is now past due as of {dueDate}. Please let us know when we can expect payment. — Chancey H&C",
  },
  {
    id: "final-notice",
    label: "Final notice",
    body: "{customer}, invoice {invoice} for {balance} remains unpaid and is now seriously past due. Please contact us promptly to avoid further action. — Chancey H&C",
  },
  {
    id: "payment-received",
    label: "Payment received",
    body: "Thanks {customer}! We've received payment for invoice {invoice}. We appreciate your business. — Chancey Heating & Cooling",
  },
];

// Replace only the known tokens; leave any other {token} untouched.
export function applyTemplate(body: string, vars: TemplateVars): string {
  return body.replace(
    /\{(customer|invoice|balance|dueDate)\}/g,
    (_match, key: keyof TemplateVars) => vars[key],
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd nudgepay-app && npx vitest run tests/sms-templates.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add nudgepay-app/app/lib/sms-templates.ts nudgepay-app/tests/sms-templates.test.ts
git commit -m "feat: add SMS starter templates module with variable interpolation"
```

---

## Task 2: Shared safeReturnTo guard

**Files:**
- Create: `nudgepay-app/app/lib/return-to.ts`
- Test: `nudgepay-app/tests/return-to.test.ts`
- Modify: `nudgepay-app/app/routes/api.contact-logs.tsx`

**Interfaces:**
- Produces: `safeReturnTo(value: FormDataEntryValue | null, fallback?: string): string` — returns `value` only when it is an app-relative path (starts with `/`, not `//`); otherwise `fallback` (default `/dashboard`).
- Consumes (in `api.contact-logs`): replaces the local `safeReturnTo(form: FormData)` with `safeReturnTo(form.get("returnTo"))`.

- [ ] **Step 1: Write the failing test**

Create `nudgepay-app/tests/return-to.test.ts`:

```ts
import { expect, test } from "vitest";
import { safeReturnTo } from "../app/lib/return-to";

test("accepts an app-relative path with query", () => {
  expect(safeReturnTo("/dashboard?invoice=i1&tab=messages")).toBe("/dashboard?invoice=i1&tab=messages");
});

test("rejects protocol-relative //host", () => {
  expect(safeReturnTo("//evil.test/x")).toBe("/dashboard");
});

test("rejects an absolute external URL", () => {
  expect(safeReturnTo("https://evil.test")).toBe("/dashboard");
});

test("rejects a query-only string (must be a path)", () => {
  expect(safeReturnTo("?invoice=i1")).toBe("/dashboard");
});

test("rejects null and non-string", () => {
  expect(safeReturnTo(null)).toBe("/dashboard");
});

test("honors a custom fallback", () => {
  expect(safeReturnTo("nope", "/onboarding")).toBe("/onboarding");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd nudgepay-app && npx vitest run tests/return-to.test.ts`
Expected: FAIL — cannot resolve `../app/lib/return-to`.

- [ ] **Step 3: Write minimal implementation**

Create `nudgepay-app/app/lib/return-to.ts`:

```ts
// Pure guard for redirect targets. We only accept an app-relative path (must
// start with a single "/", not "//") to avoid open redirects. A query-only
// string ("?x=1") is rejected on purpose — callers must pass a full path
// ("/dashboard?x=1") so the redirect lands on a real route.
export function safeReturnTo(
  value: FormDataEntryValue | null,
  fallback = "/dashboard",
): string {
  if (typeof value === "string" && value.startsWith("/") && !value.startsWith("//")) {
    return value;
  }
  return fallback;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd nudgepay-app && npx vitest run tests/return-to.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Refactor `api.contact-logs.tsx` to use the shared guard**

In `nudgepay-app/app/routes/api.contact-logs.tsx`:

Add the import near the top (after the existing `parseContactLogForm` import):

```ts
import { safeReturnTo } from "../lib/return-to";
```

Delete the local `safeReturnTo` function (the `function safeReturnTo(raw: FormData) { ... }` block). Keep `withError` unchanged.

Change the call site inside `action` from:

```ts
  const returnTo = safeReturnTo(form);
```

to:

```ts
  const returnTo = safeReturnTo(form.get("returnTo"));
```

- [ ] **Step 6: Run the contact-logs tests to confirm no regression**

Run: `cd nudgepay-app && npx vitest run tests/api-contact-logs.test.ts tests/return-to.test.ts`
Expected: PASS (existing contact-logs tests + 6 return-to tests).

- [ ] **Step 7: Commit**

```bash
git add nudgepay-app/app/lib/return-to.ts nudgepay-app/tests/return-to.test.ts nudgepay-app/app/routes/api.contact-logs.tsx
git commit -m "refactor: extract shared safeReturnTo open-redirect guard"
```

---

## Task 3: Return-aware send + consent toggle routes

**Files:**
- Modify: `nudgepay-app/app/routes/api.text.send.tsx`
- Create: `nudgepay-app/app/routes/api.sms-consent.tsx`
- Modify: `nudgepay-app/app/routes.ts`
- Test: `nudgepay-app/tests/api-text-send.test.ts` (new), `nudgepay-app/tests/api-sms-consent.test.ts` (new)

**Interfaces:**
- Consumes: `safeReturnTo` from `../lib/return-to` (Task 2).
- Produces: `/api/text/send` and `/api/sms-consent` both read a `returnTo` form field and redirect to it (validated), appending `&sms=sent|noconsent|error` on the send and `&sms=error` on consent failure. The Messages tab (Task 5) posts to both with `returnTo=/dashboard?invoice=…&tab=messages&…`.

- [ ] **Step 1: Write the failing test for the send `withSms` plumbing**

Create `nudgepay-app/tests/api-text-send.test.ts`:

```ts
import { expect, test } from "vitest";
import { withSms } from "../app/routes/api.text.send";

test("withSms appends sms code onto a path that already has a query", () => {
  expect(withSms("/dashboard?invoice=i1&tab=messages", "sent"))
    .toBe("/dashboard?invoice=i1&tab=messages&sms=sent");
});

test("withSms uses ? when the path has no query", () => {
  expect(withSms("/dashboard", "error")).toBe("/dashboard?sms=error");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd nudgepay-app && npx vitest run tests/api-text-send.test.ts`
Expected: FAIL — `withSms` is not exported.

- [ ] **Step 3: Make `api.text.send.tsx` return-aware**

Replace the full contents of `nudgepay-app/app/routes/api.text.send.tsx` with:

```ts
import { redirect, type ActionFunctionArgs } from "react-router";
import { getEnv, getTwilioEnv } from "../lib/env.server";
import { createSupabaseServiceClient } from "../lib/supabase.server";
import { requireUser, resolveOrg } from "../lib/session.server";
import { sendInvoiceText, type MessagingDeps } from "../lib/twilio-messaging.server";
import type { TwilioSender } from "../lib/twilio-client.server";
import { safeReturnTo } from "../lib/return-to";

function envSender(t: { TWILIO_MESSAGING_SERVICE_SID: string | null; TWILIO_FROM_NUMBER: string | null }): TwilioSender {
  if (t.TWILIO_MESSAGING_SERVICE_SID) return { messagingServiceSid: t.TWILIO_MESSAGING_SERVICE_SID };
  return { from: t.TWILIO_FROM_NUMBER as string }; // getTwilioEnv guarantees one of the two
}

// Append the send-result code onto the (already-validated) return path.
export function withSms(returnTo: string, code: string): string {
  const sep = returnTo.includes("?") ? "&" : "?";
  return `${returnTo}${sep}sms=${code}`;
}

export async function action({ request, context }: ActionFunctionArgs) {
  const env = getEnv(context as any);
  const twilio = getTwilioEnv(context as any);
  const { supabase, headers, user } = await requireUser(request, env);
  const org = await resolveOrg(supabase, user.id);
  if (!org) return redirect("/onboarding", { headers });

  const form = await request.formData();
  const returnTo = safeReturnTo(form.get("returnTo"));
  const raw = form.get("invoiceId");
  const invoiceId = typeof raw === "string" ? raw : "";
  const bodyRaw = form.get("body");
  const body = typeof bodyRaw === "string" ? bodyRaw.trim() : "";
  if (!invoiceId || !body) return redirect(withSms(returnTo, "error"), { headers });

  const service = createSupabaseServiceClient(env);
  const statusCallback = twilio.TWILIO_PUBLIC_BASE_URL
    ? `${twilio.TWILIO_PUBLIC_BASE_URL}/webhooks/twilio/status` : null;
  const deps: MessagingDeps = {
    fetchFn: fetch,
    service,
    twilio: { accountSid: twilio.TWILIO_ACCOUNT_SID, authToken: twilio.TWILIO_AUTH_TOKEN },
    defaultSender: envSender(twilio),
    statusCallback,
  };
  try {
    await sendInvoiceText(deps, { orgId: org.org_id, invoiceId, userId: user.id, body });
    return redirect(withSms(returnTo, "sent"), { headers });
  } catch (err) {
    const reason = err instanceof Error && /consent/i.test(err.message) ? "noconsent" : "error";
    return redirect(withSms(returnTo, reason), { headers });
  }
}

export function loader() {
  return redirect("/dashboard");
}
```

- [ ] **Step 4: Run the send plumbing test to verify it passes**

Run: `cd nudgepay-app && npx vitest run tests/api-text-send.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Write the failing DB-backed consent test**

Create `nudgepay-app/tests/api-sms-consent.test.ts`:

```ts
import { expect, test } from "vitest";
import { serviceClient, makeUserClient } from "./helpers";

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
```

- [ ] **Step 6: Run it to verify it passes (validates the RLS path the route uses)**

Run: `cd nudgepay-app && npx vitest run tests/api-sms-consent.test.ts`
Expected: PASS (2 tests). (RLS already enforces org membership from prior migrations; this proves the route's read+write path is safe.)

- [ ] **Step 7: Create the consent route**

Create `nudgepay-app/app/routes/api.sms-consent.tsx`:

```ts
import { redirect, type ActionFunctionArgs } from "react-router";
import { getEnv } from "../lib/env.server";
import { requireUser, resolveOrg } from "../lib/session.server";
import { safeReturnTo } from "../lib/return-to";

function withSms(returnTo: string, code: string): string {
  const sep = returnTo.includes("?") ? "&" : "?";
  return `${returnTo}${sep}sms=${code}`;
}

export async function action({ request, context }: ActionFunctionArgs) {
  const env = getEnv(context as any);
  const { supabase, headers, user } = await requireUser(request, env);
  const org = await resolveOrg(supabase, user.id);
  if (!org) throw redirect("/onboarding", { headers });

  const form = await request.formData();
  const returnTo = safeReturnTo(form.get("returnTo"));
  const raw = form.get("invoiceId");
  const invoiceId = typeof raw === "string" ? raw : "";
  const consent = form.get("consent") === "true";
  if (!invoiceId) return redirect(withSms(returnTo, "error"), { headers });

  // RLS-scoped: a member can only read invoices in their org, so a foreign
  // invoiceId resolves to nothing and updates nothing.
  const { data: inv } = await supabase
    .from("invoices").select("customer_id").eq("id", invoiceId).maybeSingle();
  if (!inv?.customer_id) return redirect(withSms(returnTo, "error"), { headers });

  const { error } = await supabase
    .from("customers").update({ sms_consent: consent }).eq("id", inv.customer_id as string);
  if (error) return redirect(withSms(returnTo, "error"), { headers });

  return redirect(returnTo, { headers });
}

export function loader() {
  return redirect("/dashboard");
}
```

- [ ] **Step 8: Register the consent route**

In `nudgepay-app/app/routes.ts`, add this line in the `api/*` group (e.g. directly after the `api/contact-logs` line):

```ts
  route("api/sms-consent", "routes/api.sms-consent.tsx"),
```

- [ ] **Step 9: Build to confirm the route graph compiles**

Run: `cd nudgepay-app && npx tsc -b`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add nudgepay-app/app/routes/api.text.send.tsx nudgepay-app/app/routes/api.sms-consent.tsx nudgepay-app/app/routes.ts nudgepay-app/tests/api-text-send.test.ts nudgepay-app/tests/api-sms-consent.test.ts
git commit -m "feat: return-aware text send and RLS sms-consent toggle route"
```

---

## Task 4: Loader reads for the selected message thread

**Files:**
- Modify: `nudgepay-app/app/routes/dashboard.tsx`
- Test: `nudgepay-app/tests/dashboard-worklist.test.ts`

**Interfaces:**
- Produces (exported from `dashboard.tsx`): `MessageEntry = { id: string; direction: string; body: string | null; status: string | null; errorCode: string | null; createdAt: string }`. Loader return gains `selectedMessages: MessageEntry[]`, `selectedConsent: boolean`, `selectedPhone: string | null`, and `sms: string | null`.
- Consumes: nothing new; reads `text_messages` and the invoice→customer embed via the existing RLS `supabase` user client.

- [ ] **Step 1: Write the failing test (RLS read shape the loader relies on)**

Append to `nudgepay-app/tests/dashboard-worklist.test.ts` (after the existing final test). It reuses the `user`/`orgId` set up in the file's existing `beforeAll`:

```ts
test("RLS user client reads an invoice thread ascending with consent embed", async () => {
  const svc = serviceClient();
  // Add a customer + invoice + two outbound/one inbound message in the existing org.
  const { data: cust } = await svc.from("customers")
    .insert({ org_id: orgId, qbo_id: "thread-c1", name: "Thread Co", phone: "+13105559100", sms_consent: true })
    .select("id").single();
  const { data: inv } = await svc.from("invoices")
    .insert({ org_id: orgId, qbo_id: "thread-i1", qbo_doc_number: "9100", customer_id: cust!.id, amount: 1200, balance: 1200, due_date: "2026-02-01", status: "overdue" })
    .select("id").single();
  await svc.from("text_messages").insert([
    { org_id: orgId, invoice_id: inv!.id, customer_id: cust!.id, direction: "outbound", body: "first", status: "sent", created_at: "2026-06-20T10:00:00Z" },
    { org_id: orgId, invoice_id: inv!.id, customer_id: cust!.id, direction: "inbound", body: "reply", created_at: "2026-06-20T11:00:00Z" },
  ]);

  const { data: msgs, error } = await user.client
    .from("text_messages")
    .select("id, direction, body, status, error_code, created_at")
    .eq("org_id", orgId).eq("invoice_id", inv!.id)
    .order("created_at", { ascending: true });
  expect(error).toBeNull();
  expect(msgs!.map((m) => m.body)).toEqual(["first", "reply"]);

  const { data: invRow } = await user.client
    .from("invoices").select("customers(phone, sms_consent)").eq("id", inv!.id).maybeSingle();
  expect((invRow as any).customers.sms_consent).toBe(true);
  expect((invRow as any).customers.phone).toBe("+13105559100");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd nudgepay-app && npx vitest run tests/dashboard-worklist.test.ts`
Expected: FAIL — no `text_messages` rows / no such invoice until the loader-shape data is created… actually this test creates its own data, so it should PASS immediately because it exercises raw Supabase, not loader code. **If it passes on first run, that is expected** — it is a guard that locks the read shape (ascending order + consent embed) the loader depends on. Proceed to Step 3 regardless.

- [ ] **Step 3: Add the loader reads**

In `nudgepay-app/app/routes/dashboard.tsx`:

(a) Add the `MessageEntry` export and a row type next to the existing `ActivityEntry` export (after line ~128):

```ts
type SelectedMessageRow = {
  id: string;
  direction: string;
  body: string | null;
  status: string | null;
  error_code: string | null;
  created_at: string;
};

export type MessageEntry = {
  id: string;
  direction: string;
  body: string | null;
  status: string | null;
  errorCode: string | null;
  createdAt: string;
};
```

(b) Parse `sms` alongside the other params (near the `const invoice = sp.get("invoice") ?? null;` line):

```ts
  const sms = sp.get("sms");
```

(c) Declare the new accumulators next to `let selectedActivity: ActivityEntry[] = [];` (line ~205):

```ts
  let selectedMessages: MessageEntry[] = [];
  let selectedConsent = false;
  let selectedPhone: string | null = null;
```

(d) Inside the existing `if (invoice) { … }` block (the one that fills `selectedActivity`, ~line 343), after the `selectedActivity = …` assignment, add:

```ts
      const { data: msgRows } = await supabase
        .from("text_messages")
        .select("id, direction, body, status, error_code, created_at")
        .eq("org_id", org.org_id)
        .eq("invoice_id", invoice)
        .order("created_at", { ascending: true });
      selectedMessages = ((msgRows as unknown as SelectedMessageRow[]) ?? []).map((r) => ({
        id: r.id,
        direction: r.direction,
        body: r.body,
        status: r.status,
        errorCode: r.error_code,
        createdAt: r.created_at,
      }));

      const { data: invConsent } = await supabase
        .from("invoices")
        .select("customers(phone, sms_consent)")
        .eq("org_id", org.org_id)
        .eq("id", invoice)
        .maybeSingle();
      const c = (invConsent as any)?.customers as { phone: string | null; sms_consent: boolean } | null;
      selectedConsent = c?.sms_consent ?? false;
      selectedPhone = c?.phone ?? null;
```

(e) Add the four new fields to the loader's returned `data({ … })` object (the block that currently lists `selectedActivity`, ~line 363):

```ts
      selectedActivity,
      selectedMessages,
      selectedConsent,
      selectedPhone,
      sms,
```

- [ ] **Step 4: Type-check**

Run: `cd nudgepay-app && npx tsc -b`
Expected: no errors. (The component does not yet consume the new fields; that is Task 5.)

- [ ] **Step 5: Run the dashboard test**

Run: `cd nudgepay-app && npx vitest run tests/dashboard-worklist.test.ts`
Expected: PASS (existing tests + the new thread-shape test).

- [ ] **Step 6: Commit**

```bash
git add nudgepay-app/app/routes/dashboard.tsx nudgepay-app/tests/dashboard-worklist.test.ts
git commit -m "feat: loader reads selected message thread, consent, and phone"
```

---

## Task 5: Messages tab UI + Text button + drawer returnTo fix

**Files:**
- Modify: `nudgepay-app/app/components/DetailPanel.tsx`
- Modify: `nudgepay-app/app/routes/dashboard.tsx`

**Interfaces:**
- Consumes: `MessageEntry` (type-only) from `~/routes/dashboard`; `SMS_TEMPLATES`, `applyTemplate`, `TemplateVars` from `~/lib/sms-templates`; loader fields `selectedMessages`, `selectedConsent`, `sms` (Task 4).
- Produces: `DetailPanel` gains props `messages: MessageEntry[]`, `consent: boolean`, `phone: string | null`, `sms: string | null`. Composer posts to `/api/text/send`; consent form posts to `/api/sms-consent`; both with `returnTo=/dashboard?invoice=…&tab=messages&view=…&sort=…[&q=…]`.

- [ ] **Step 1: Add imports and the Messages-tab subcomponent to `DetailPanel.tsx`**

At the top of `nudgepay-app/app/components/DetailPanel.tsx`, add to the imports:

```ts
import { useState } from "react";
import { SMS_TEMPLATES, applyTemplate, type TemplateVars } from "~/lib/sms-templates";
import type { ActivityEntry, MessageEntry } from "~/routes/dashboard";
```

(Replace the existing `import type { ActivityEntry } from "~/routes/dashboard";` line with the combined one above.)

Add this subcomponent just above the `export function DetailPanel(` declaration:

```tsx
// Static direction → bubble alignment/color. Literal strings for Tailwind.
const BUBBLE: Record<string, { wrap: string; bubble: string }> = {
  outbound: { wrap: "items-end", bubble: "bg-copper/10 text-text border border-copper/30" },
  inbound: { wrap: "items-start", bubble: "bg-panel text-text border border-border" },
};
const SMS_BANNER: Record<string, { text: string; tone: string }> = {
  sent: { text: "Text sent.", tone: "text-cool" },
  noconsent: { text: "Not sent — customer has not consented to SMS.", tone: "text-hot" },
  error: { text: "Could not send the text.", tone: "text-hot" },
};

function MessagesTab({
  selected, messages, consent, phone, sms, view, sort, q,
}: {
  selected: WorkItem;
  messages: MessageEntry[];
  consent: boolean;
  phone: string | null;
  sms: string | null;
  view: string;
  sort: string;
  q: string;
}) {
  const returnTo = `/dashboard?${new URLSearchParams({
    invoice: selected.invoiceId, tab: "messages", view, sort, ...(q ? { q } : {}),
  }).toString()}`;

  const vars: TemplateVars = {
    customer: selected.customerName,
    invoice: selected.docNumber ?? selected.invoiceId,
    balance: formatUSD(selected.balance),
    dueDate: formatDueDate(selected.dueDate),
  };

  const [body, setBody] = useState("");
  const banner = sms ? SMS_BANNER[sms] : null;

  return (
    <section
      id="messages-panel"
      role="tabpanel"
      aria-labelledby="messages-tab"
      className="flex flex-1 flex-col min-h-0"
    >
      {/* Consent row */}
      <div className="flex items-center justify-between gap-2 px-5 py-3 border-b border-border">
        <span className="text-xs font-sans text-muted">
          SMS consent:{" "}
          <span className={consent ? "font-semibold text-cool" : "font-semibold text-hot"}>
            {consent ? "yes" : "no"}
          </span>
          {phone ? <span className="text-muted"> · {phone}</span> : null}
        </span>
        <form method="post" action="/api/sms-consent">
          <input type="hidden" name="invoiceId" value={selected.invoiceId} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <input type="hidden" name="consent" value={consent ? "false" : "true"} />
          <button
            type="submit"
            className="text-xs font-sans font-medium text-copper hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-copper rounded"
          >
            {consent ? "Revoke consent" : "Mark consented"}
          </button>
        </form>
      </div>

      {/* Banner */}
      {banner ? (
        <p className={`px-5 py-2 text-xs font-sans font-medium ${banner.tone}`}>{banner.text}</p>
      ) : null}

      {/* Thread */}
      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
            <Icon name="message" size={24} className="text-border" aria-hidden />
            <p className="text-sm font-sans font-semibold text-text">No messages yet.</p>
            <p className="text-xs text-muted max-w-xs">Pick a template or write a message below.</p>
          </div>
        ) : (
          <ol className="flex flex-col gap-3">
            {messages.map((m) => {
              const side = BUBBLE[m.direction] ?? BUBBLE.inbound;
              return (
                <li key={m.id} className={`flex flex-col gap-0.5 ${side.wrap}`}>
                  <span className={`inline-block max-w-[85%] rounded-lg px-3 py-2 text-sm font-sans whitespace-pre-wrap ${side.bubble}`}>
                    {m.body}
                  </span>
                  <span className="font-mono text-[11px] text-muted">
                    {m.direction}
                    {m.status ? ` · ${m.status}` : ""}
                    {m.errorCode ? ` · ${m.errorCode}` : ""}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      {/* Templates + composer */}
      <div className="border-t border-border px-5 py-3 shrink-0">
        <div className="flex flex-wrap gap-1.5 mb-2" role="group" aria-label="Message templates">
          {SMS_TEMPLATES.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setBody(applyTemplate(t.body, vars))}
              className="text-xs font-sans text-muted border border-border rounded-md px-2 py-1 hover:text-copper hover:border-copper focus:outline-none focus-visible:ring-2 focus-visible:ring-copper transition-colors"
            >
              {t.label}
            </button>
          ))}
        </div>
        <form method="post" action="/api/text/send" className="flex flex-col gap-2">
          <input type="hidden" name="invoiceId" value={selected.invoiceId} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <textarea
            name="body"
            rows={3}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Type a message…"
            required
            className="w-full resize-none rounded-md border border-border bg-panel px-3 py-2 text-sm font-sans text-text placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-copper"
          />
          <div className="flex items-center justify-between gap-2">
            {!consent ? (
              <span className="text-xs text-muted">Mark consent to enable sending.</span>
            ) : <span />}
            <button
              type="submit"
              disabled={!consent}
              className="inline-flex items-center gap-1.5 rounded-md bg-copper px-3 py-1.5 text-xs font-sans font-semibold text-surface hover:bg-copper/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-copper disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Icon name="message" size={14} aria-hidden />
              Send text
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Wire the new props into `DetailPanel` and replace the placeholder**

In the `DetailPanel` function signature, add `messages`, `consent`, `sms` to the destructured props and the type:

```tsx
export function DetailPanel({
  selected,
  activeTab,
  activity,
  messages,
  consent,
  phone,
  sms,
  view,
  sort,
  q,
}: {
  selected: WorkItem | null;
  activeTab: "overview" | "activity" | "messages";
  activity: ActivityEntry[];
  messages: MessageEntry[];
  consent: boolean;
  phone: string | null;
  sms: string | null;
  view: string;
  sort: string;
  q: string;
}) {
```

Replace the Messages `PlaceholderTab` block:

```tsx
      {activeTab === "messages" ? (
        <PlaceholderTab
          panelId="messages-panel"
          tabId="messages-tab"
          heading="Message thread"
          description="The full SMS conversation with this customer, plus message templates, will appear here once the Messages feature ships."
        />
      ) : null}
```

with:

```tsx
      {activeTab === "messages" ? (
        <MessagesTab
          selected={selected}
          messages={messages}
          consent={consent}
          phone={phone}
          sms={sms}
          view={view}
          sort={sort}
          q={q}
        />
      ) : null}
```

(`PlaceholderTab` is now unused — delete its function definition to avoid a dead-code lint.)

- [ ] **Step 3: Repoint the "Text" action button to the Messages tab**

Replace the Text `<Link>` block (currently `to={`/invoices/${selected.invoiceId}`}`) with:

```tsx
          {/* Text → Messages tab */}
          <Link
            to={`?${new URLSearchParams({ invoice: selected.invoiceId, tab: "messages", view, sort, ...(q ? { q } : {}) }).toString()}`}
            className="inline-flex items-center gap-1.5 text-xs font-sans font-medium text-copper border border-copper/40 rounded-md px-3 py-1.5 hover:bg-copper/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-copper transition-colors"
          >
            <Icon name="message" size={14} aria-hidden />
            Text
          </Link>
```

- [ ] **Step 4: Pass the new props + fix the Log-drawer returnTo in `dashboard.tsx`**

In `nudgepay-app/app/routes/dashboard.tsx`, the `useLoaderData` destructure (~line 388) — add `selectedMessages`, `selectedConsent`, `sms`:

```tsx
    selectedActivity,
    selectedMessages,
    selectedConsent,
    selectedPhone,
    sms,
    items,
```

Update the `<DetailPanel … />` call (~line 468) to pass them:

```tsx
              <DetailPanel
                selected={selected ?? null}
                activeTab={tab}
                activity={selectedActivity}
                messages={selectedMessages}
                consent={selectedConsent}
                phone={selectedPhone}
                sms={sms}
                view={view}
                sort={sort}
                q={q}
              />
```

Fix the **5b regression**: the `LogContactDrawer` `returnTo` must be an absolute path so `safeReturnTo` accepts it. Change (~line 482):

```tsx
              returnTo={`?${new URLSearchParams({ invoice: selected.invoiceId, tab, view, sort, ...(q ? { q } : {}) }).toString()}`}
```

to:

```tsx
              returnTo={`/dashboard?${new URLSearchParams({ invoice: selected.invoiceId, tab, view, sort, ...(q ? { q } : {}) }).toString()}`}
```

- [ ] **Step 5: Type-check and build**

Run: `cd nudgepay-app && npx tsc -b && npx react-router build`
Expected: both succeed with no errors. `selectedPhone` is now consumed (threaded into the Messages tab consent row), so there are no unused-symbol warnings.

- [ ] **Step 6: Commit**

```bash
git add nudgepay-app/app/components/DetailPanel.tsx nudgepay-app/app/routes/dashboard.tsx
git commit -m "feat: wire Messages tab thread, templates, composer; fix log-drawer returnTo"
```

---

## Task 6: Delete the prototype route and final verification

**Files:**
- Delete: `nudgepay-app/app/routes/invoices.$id.tsx`
- Modify: `nudgepay-app/app/routes.ts`

**Interfaces:**
- Consumes: nothing. This task removes the now-orphaned standalone thread page (its last live reference, the Text button, was repointed in Task 5).

- [ ] **Step 1: Confirm nothing references the route anymore**

Run: `cd nudgepay-app && grep -rn "invoices/\\\${" app && grep -rn "invoices.\\\$id\|/invoices/:id\|routes/invoices" app`
Expected: the only remaining match is the `route("invoices/:id", …)` registration line in `app/routes.ts`. (The `/api/text/send` redirects to `/invoices/:id` were removed in Task 3; the Text button was repointed in Task 5.) If any other live reference appears, stop and repoint it before deleting.

- [ ] **Step 2: Delete the route file and its registration**

Delete `nudgepay-app/app/routes/invoices.$id.tsx`.

In `nudgepay-app/app/routes.ts`, remove the line:

```ts
  route("invoices/:id", "routes/invoices.$id.tsx"),
```

- [ ] **Step 3: Type-check and build**

Run: `cd nudgepay-app && npx tsc -b && npx react-router build`
Expected: both succeed — no dangling import to the deleted route.

- [ ] **Step 4: Run the full test suite**

Run: `cd nudgepay-app && npx vitest run`
Expected: all suites pass (prior 111 + the new sms-templates, return-to, api-text-send, api-sms-consent, and the extended dashboard-worklist test).

- [ ] **Step 5: Commit**

```bash
git add nudgepay-app/app/routes/invoices.\$id.tsx nudgepay-app/app/routes.ts
git commit -m "refactor: delete prototype /invoices/:id page, folded into Messages tab"
```

---

## Verification summary (run after all tasks)

```bash
cd nudgepay-app
npx vitest run          # full suite green
npx tsc -b              # types clean
npx react-router build  # production build clean
```

Then a live Chrome pass on the dashboard: select an account → Messages tab → confirm the thread renders, the consent toggle flips state and returns to the tab, a template fills the composer, and a send shows the `sms=sent` banner (or `noconsent` when consent is off). Also confirm a contact-log save and a validation error now correctly return to the **open** drawer on the selected invoice (the 5b regression fix).
