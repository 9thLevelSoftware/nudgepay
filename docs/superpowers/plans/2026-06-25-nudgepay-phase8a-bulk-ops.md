# NudgePay Phase 8a — Bulk Assignment & Batch Messaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add multi-select to the work queue with two bulk actions over selected cases — reassign owner, and send a templated SMS — eliminating the "50+ invoices one-at-a-time" pain.

**Architecture:** A pure module (`app/lib/bulk.ts`) owns eligibility + per-case message rendering; a server orchestration (`app/lib/bulk-send.server.ts` `runBulkSms`) loads case data, partitions eligibility, and sends sequentially via the existing `sendInvoiceText`. Two thin action routes (`api.bulk-assign`, `api.bulk-sms`) wire HTTP → those functions. `WorkQueue` gains client-side checkbox selection + a sticky action bar and SMS confirm drawer.

**Tech Stack:** React Router 7, TypeScript 5.9, Supabase (Postgres + RLS), Tailwind v4, Vitest 4 (node env, no jsdom), Cloudflare Workers.

**Spec:** `docs/superpowers/specs/2026-06-25-nudgepay-phase8a-bulk-ops-design.md`

## Global Constraints

- **RLS:** `is_org_member` permits EVERY org the caller belongs to. Every user-client read/write MUST bind `.eq("org_id", org.org_id)` AND capture+throw errors (never silent-swallow). Service client bypasses RLS — every read still bound `.eq("org_id", org.org_id)`.
- **`MAX_BATCH = 50`** — enforced in client (select-all clamp) AND server (both routes re-clamp). Never trust the client's id-list length.
- **One SMS per case, totals:** `{balance}` = case total overdue; `{dueDate}`/`{invoice}` from the **oldest overdue invoice** (representative); the recorded `text_messages` row carries that `invoice_id` + the case `case_id` (both via `sendInvoiceText`).
- **Eligibility re-validated server-side:** client preview is advisory; the route recomputes from the DB and `sendInvoiceText` re-checks consent/phone internally.
- **No new migration** — `customers.sms_consent` already exists; bulk ops reuse existing tables.
- **Display helpers:** reuse `formatUSD` + `STATUS_LABEL` from `app/lib/format.ts`; dates via `formatDate` from `app/lib/dates.ts`.
- **Commit style:** Conventional Commits; every commit ends with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Test harness:** Vitest, node env, no jsdom. Integration tests use `serviceClient()` + `makeUserClient(email)` from `tests/helpers.ts` against local Supabase. React components are NOT unit-tested (no jsdom) — UI tasks verify via `npm run typecheck` + `npm run build`.
- **Commands:** typecheck `npm run typecheck` (runs `wrangler types && react-router typegen && tsc -b`); build `npm run build`; tests `npx vitest run <file>`. Run all from `nudgepay-app/`.

### Refinements vs. spec (intentional, not drift)
- `bulk.ts` exposes **minimal structural input types** (`TextableCase`, `RenderableCase`, `RepInvoice`) rather than importing `CaseItem`. `CaseItem` satisfies them structurally, so the queue can pass `CaseItem[]` directly while routes build lightweight objects and tests stay terse.
- The spec's `partitionEligibility` + `renderCaseBody` + a separate `sendBatchTexts` are consolidated: the per-item send loop lives inside **`runBulkSms`** (one tested orchestration) instead of a standalone `sendBatchTexts`.
- The SMS route accepts the resolved/edited **`body`** (with tokens) rather than a `templateId`; the drawer always submits the (possibly edited) template body. Per-case token rendering happens server-side in `runBulkSms`.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `app/lib/worklist.ts` | `CustomerInput` gains `smsConsent?` | 1 |
| `app/lib/cases.ts` | `CaseItem` gains `smsConsent`; `buildCaseItems` sets it | 1 |
| `app/routes/dashboard.tsx` | embed `sms_consent`; thread to `CustomerInput`; result banners; pass `roster`+`returnTo` to `WorkQueue` | 1, 7 |
| `app/lib/bulk.ts` | **NEW** pure: `MAX_BATCH`, eligibility, rendering, clamp | 2 |
| `app/lib/bulk-send.server.ts` | **NEW** `runBulkSms` orchestration | 3 |
| `app/routes/api.bulk-assign.tsx` | **NEW** bulk owner reassign route | 4 |
| `app/routes/api.bulk-sms.tsx` | **NEW** batch SMS route | 5 |
| `app/routes.ts` | register both routes | 4, 5 |
| `app/components/BulkActionBar.tsx` | **NEW** sticky bar (assign select + send/clear) | 6 |
| `app/components/BulkSmsDrawer.tsx` | **NEW** template/preview/confirm drawer | 6 |
| `app/components/WorkQueue.tsx` | checkbox selection + render bar/drawer | 7 |
| `tests/cases.test.ts` | smsConsent threading | 1 |
| `tests/bulk.test.ts` | **NEW** pure eligibility/render/clamp | 2 |
| `tests/bulk-send.test.ts` | **NEW** runBulkSms integration | 3 |
| `tests/api-bulk-assign.test.ts` | **NEW** bulk-assign RLS/guards | 4 |
| `docs/superpowers/2026-06-23-nudgepay-requirements-gap-checklist.md` | mark B5 + C5 | 8 |

---

## Task 1: Thread `smsConsent` into `CaseItem`

**Files:**
- Modify: `nudgepay-app/app/lib/worklist.ts` (`CustomerInput` type)
- Modify: `nudgepay-app/app/lib/cases.ts` (`CaseItem` type + `buildCaseItems`)
- Modify: `nudgepay-app/app/routes/dashboard.tsx` (invoice→customer embed + dedup map)
- Test: `nudgepay-app/tests/cases.test.ts` (append one test)

**Interfaces:**
- Consumes: existing `buildCaseItems(cases, invoices, customers, lastContacts, promises, today, ownerLabels)`.
- Produces: `CustomerInput.smsConsent?: boolean | null`; `CaseItem.smsConsent: boolean` (defaults `false`).

- [ ] **Step 1: Write the failing test** — append to `nudgepay-app/tests/cases.test.ts`:

```ts
test("buildCaseItems threads smsConsent from the customer (defaults false)", () => {
  const today = "2026-06-25";
  const cases = [
    { id: "case-1", customerId: "cust-1", status: "working" as const, nextActionType: null, nextActionAt: null, exceptionReason: null, exceptionNote: null },
    { id: "case-2", customerId: "cust-2", status: "working" as const, nextActionType: null, nextActionAt: null, exceptionReason: null, exceptionNote: null },
  ];
  const invoices = [
    { id: "inv-1", qbo_doc_number: "1001", customer_id: "cust-1", balance: 100, due_date: "2026-05-01" },
    { id: "inv-2", qbo_doc_number: "1002", customer_id: "cust-2", balance: 50, due_date: "2026-05-01" },
  ];
  const customers = [
    { id: "cust-1", name: "Yes Co", phone: "+12295550100", email: null, owner: null, smsConsent: true },
    { id: "cust-2", name: "No Co", phone: "+12295550101", email: null, owner: null }, // smsConsent omitted -> false
  ];
  const items = buildCaseItems(cases, invoices, customers, [], [], today, new Map());
  const byId = Object.fromEntries(items.map((i) => [i.caseId, i]));
  expect(byId["case-1"].smsConsent).toBe(true);
  expect(byId["case-2"].smsConsent).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd nudgepay-app && npx vitest run tests/cases.test.ts`
Expected: FAIL — `byId["case-1"].smsConsent` is `undefined` (property does not exist yet) / type error.

- [ ] **Step 3: Add `smsConsent` to `CustomerInput`** in `nudgepay-app/app/lib/worklist.ts`. Find:

```ts
export type CustomerInput = { id: string; name: string; phone: string | null; email: string | null; owner?: string | null };
```

Replace with:

```ts
export type CustomerInput = { id: string; name: string; phone: string | null; email: string | null; owner?: string | null; smsConsent?: boolean | null };
```

- [ ] **Step 4: Add `smsConsent` to `CaseItem` + set it in `buildCaseItems`** in `nudgepay-app/app/lib/cases.ts`. In the `CaseItem` type, after `phone: string | null;` add:

```ts
  smsConsent: boolean;
```

In `buildCaseItems`'s returned object (the `return { caseId: cse.id, ... }`), after `phone: cust?.phone ?? null,` add:

```ts
      smsConsent: cust?.smsConsent ?? false,
```

- [ ] **Step 5: Embed `sms_consent` in the dashboard loader** in `nudgepay-app/app/routes/dashboard.tsx`. Find the invoice query (~line 268):

```ts
      .select("id, qbo_doc_number, balance, due_date, customer_id, customers(name, phone, email, owner)")
```

Replace with:

```ts
      .select("id, qbo_doc_number, balance, due_date, customer_id, customers(name, phone, email, owner, sms_consent)")
```

Then update the `InvoiceRow` type (~line 89) embed shape:

```ts
  customers: { name: string | null; phone: string | null; email: string | null; owner: string | null } | null;
```

to:

```ts
  customers: { name: string | null; phone: string | null; email: string | null; owner: string | null; sms_consent: boolean | null } | null;
```

And in the customer dedup map (`customerMap.set(...)`, ~line 287) add `smsConsent`:

```ts
        customerMap.set(r.customer_id, {
          id: r.customer_id,
          name: r.customers.name ?? "(unknown customer)",
          phone: r.customers.phone ?? null,
          email: r.customers.email ?? null,
          owner: r.customers.owner ?? null,
          smsConsent: r.customers.sms_consent ?? false,
        });
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd nudgepay-app && npx vitest run tests/cases.test.ts`
Expected: PASS.

- [ ] **Step 7: Typecheck (the embed + types changed)**

Run: `cd nudgepay-app && npm run typecheck`
Expected: exit 0, no errors.

- [ ] **Step 8: Commit**

```bash
git add nudgepay-app/app/lib/worklist.ts nudgepay-app/app/lib/cases.ts nudgepay-app/app/routes/dashboard.tsx nudgepay-app/tests/cases.test.ts
git commit -m "feat(bulk): thread sms_consent into CaseItem for batch eligibility

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Pure `bulk.ts` — eligibility, rendering, clamp

**Files:**
- Create: `nudgepay-app/app/lib/bulk.ts`
- Test: `nudgepay-app/tests/bulk.test.ts`

**Interfaces:**
- Consumes: `applyTemplate` (`./sms-templates`), `formatUSD` (`./format`), `formatDate` (`./dates`).
- Produces: `MAX_BATCH: 50`; `SkipReason`; `TextableCase`; `RepInvoice`; `RenderableCase`; `EligibilitySplit<T>`; `partitionEligibility<T extends TextableCase>(cases): EligibilitySplit<T>`; `renderCaseBody(templateBody, c: RenderableCase): string`; `clampBatch<T>(ids: T[]): T[]`.

- [ ] **Step 1: Write the failing test** — create `nudgepay-app/tests/bulk.test.ts`:

```ts
import { expect, test } from "vitest";
import { partitionEligibility, renderCaseBody, clampBatch, MAX_BATCH } from "../app/lib/bulk";

test("partitionEligibility keeps consented cases that have a phone", () => {
  const { eligible, skipped } = partitionEligibility([
    { caseId: "c1", customerName: "Acme", phone: "+12295550100", smsConsent: true },
  ]);
  expect(eligible).toHaveLength(1);
  expect(skipped).toHaveLength(0);
});

test("partitionEligibility skips no-phone (phone checked first) and no-consent", () => {
  const { eligible, skipped } = partitionEligibility([
    { caseId: "c1", customerName: "A", phone: "+12295550100", smsConsent: true },
    { caseId: "c2", customerName: "B", phone: null, smsConsent: true },
    { caseId: "c3", customerName: "C", phone: "+12295550102", smsConsent: false },
    { caseId: "c4", customerName: "D", phone: null, smsConsent: false },
  ]);
  expect(eligible.map((c) => c.caseId)).toEqual(["c1"]);
  expect(skipped).toEqual([
    { caseId: "c2", name: "B", reason: "no-phone" },
    { caseId: "c3", name: "C", reason: "no-consent" },
    { caseId: "c4", name: "D", reason: "no-phone" },
  ]);
});

test("renderCaseBody fills totals + oldest-invoice tokens", () => {
  const body = renderCaseBody(
    "Hi {customer}, invoice {invoice} for {balance} due {dueDate}.",
    { customerName: "Acme", totalOverdue: 1234.5, invoices: [{ invoiceId: "i1", docNumber: "1042", dueDate: "2026-05-01" }] },
  );
  expect(body).toBe("Hi Acme, invoice 1042 for $1,234.50 due May 1, 2026.");
});

test("renderCaseBody falls back to 'your account' / empty when no doc or due date", () => {
  const body = renderCaseBody("{customer} {invoice} {dueDate}", {
    customerName: "Acme", totalOverdue: 0, invoices: [{ invoiceId: "i1", docNumber: null, dueDate: null }],
  });
  expect(body).toBe("Acme your account ");
});

test("renderCaseBody leaves unknown tokens untouched", () => {
  const body = renderCaseBody("{customer} {unknown}", {
    customerName: "Acme", totalOverdue: 0, invoices: [{ invoiceId: "i1", docNumber: "1", dueDate: "2026-05-01" }],
  });
  expect(body).toBe("Acme {unknown}");
});

test("clampBatch truncates to MAX_BATCH, leaves short lists alone", () => {
  const ids = Array.from({ length: MAX_BATCH + 5 }, (_, i) => String(i));
  expect(clampBatch(ids)).toHaveLength(MAX_BATCH);
  expect(clampBatch(["a", "b"])).toEqual(["a", "b"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd nudgepay-app && npx vitest run tests/bulk.test.ts`
Expected: FAIL — cannot import from `../app/lib/bulk` (module does not exist).

- [ ] **Step 3: Create `nudgepay-app/app/lib/bulk.ts`:**

```ts
// Pure module — no I/O, no node:*, no .server suffix. Bulk-ops eligibility +
// per-case message rendering, shared by routes, components, and tests.
import { applyTemplate } from "./sms-templates";
import { formatUSD } from "./format";
import { formatDate } from "./dates";

export const MAX_BATCH = 50;

export type SkipReason = "no-phone" | "no-consent";

export type TextableCase = {
  caseId: string;
  customerName: string;
  phone: string | null;
  smsConsent: boolean;
};

export type RepInvoice = { invoiceId: string; docNumber: string | null; dueDate: string | null };

export type RenderableCase = {
  customerName: string;
  totalOverdue: number;
  invoices: RepInvoice[];
};

export type EligibilitySplit<T extends TextableCase> = {
  eligible: T[];
  skipped: { caseId: string; name: string; reason: SkipReason }[];
};

// Partition selected cases into textable vs skipped. Phone is checked first: a
// case with neither phone nor consent is reported as "no-phone".
export function partitionEligibility<T extends TextableCase>(cases: T[]): EligibilitySplit<T> {
  const eligible: T[] = [];
  const skipped: { caseId: string; name: string; reason: SkipReason }[] = [];
  for (const c of cases) {
    if (!c.phone) skipped.push({ caseId: c.caseId, name: c.customerName, reason: "no-phone" });
    else if (!c.smsConsent) skipped.push({ caseId: c.caseId, name: c.customerName, reason: "no-consent" });
    else eligible.push(c);
  }
  return { eligible, skipped };
}

// Render one personalized body using case totals + the oldest overdue invoice
// (invoices[0], caller-sorted oldest-first) as the representative. Unknown
// {tokens} pass through (applyTemplate only replaces known keys).
export function renderCaseBody(templateBody: string, c: RenderableCase): string {
  const oldest = c.invoices[0] ?? null;
  return applyTemplate(templateBody, {
    customer: c.customerName,
    invoice: oldest?.docNumber ?? "your account",
    balance: formatUSD(c.totalOverdue),
    dueDate: oldest?.dueDate ? formatDate(oldest.dueDate) : "",
  });
}

// Shared clamp so client select-all and server routes agree on the cap.
export function clampBatch<T>(ids: T[]): T[] {
  return ids.slice(0, MAX_BATCH);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd nudgepay-app && npx vitest run tests/bulk.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add nudgepay-app/app/lib/bulk.ts nudgepay-app/tests/bulk.test.ts
git commit -m "feat(bulk): pure eligibility partition + per-case body rendering + cap

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: `runBulkSms` server orchestration

**Files:**
- Create: `nudgepay-app/app/lib/bulk-send.server.ts`
- Test: `nudgepay-app/tests/bulk-send.test.ts`

**Interfaces:**
- Consumes: `sendInvoiceText` + `MessagingDeps` (`./twilio-messaging.server`); `partitionEligibility`, `renderCaseBody`, `clampBatch`, `TextableCase`, `RenderableCase` (`./bulk`).
- Produces: `BulkSmsResult = { sent: number; failed: number; skipped: number }`; `runBulkSms(deps, { orgId, userId, caseIds, today, templateBody }): Promise<BulkSmsResult>`.

- [ ] **Step 1: Write the failing test** — create `nudgepay-app/tests/bulk-send.test.ts`:

```ts
import { beforeAll, expect, test, vi } from "vitest";
import { serviceClient, makeUserClient } from "./helpers";
import { runBulkSms } from "../app/lib/bulk-send.server";
import type { MessagingDeps } from "../app/lib/twilio-messaging.server";

let userId: string;
beforeAll(async () => { ({ userId } = await makeUserClient("bulk-sms@example.com")); });

const svc = serviceClient();
const today = "2026-06-25";

function jsonResponse(body: unknown, status = 201) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
function deps(fetchFn: any): MessagingDeps {
  return { fetchFn, service: svc, twilio: { accountSid: "AC1", authToken: "tok" }, defaultSender: { from: "+15005550006" }, statusCallback: null };
}
async function seedCase(orgId: string, o: { name: string; phone: string | null; consent: boolean; doc: string; due: string; balance: number }) {
  const { data: cust } = await svc.from("customers")
    .insert({ org_id: orgId, qbo_id: `q-${o.name}`, name: o.name, phone: o.phone, sms_consent: o.consent }).select("id").single();
  const { data: inv } = await svc.from("invoices")
    .insert({ org_id: orgId, qbo_id: `i-${o.name}`, qbo_doc_number: o.doc, customer_id: cust!.id, balance: o.balance, due_date: o.due }).select("id").single();
  const { data: cse } = await svc.from("collection_cases")
    .insert({ org_id: orgId, customer_id: cust!.id, status: "working" }).select("id").single();
  return { customerId: cust!.id as string, invoiceId: inv!.id as string, caseId: cse!.id as string };
}

test("runBulkSms sends to eligible cases, skips no-consent/no-phone, records one row each", async () => {
  const { data: org } = await svc.from("organizations").insert({ name: "Bulk SMS Org" }).select("id").single();
  const orgId = org!.id as string;
  const yes = await seedCase(orgId, { name: "Yes Co", phone: "+12295550100", consent: true, doc: "1001", due: "2026-05-01", balance: 100 });
  const noConsent = await seedCase(orgId, { name: "NoConsent Co", phone: "+12295550101", consent: false, doc: "1002", due: "2026-05-01", balance: 100 });
  const noPhone = await seedCase(orgId, { name: "NoPhone Co", phone: null, consent: true, doc: "1003", due: "2026-05-01", balance: 100 });

  const fetchFn = vi.fn(async () => jsonResponse({ sid: "SM-BULK", status: "queued" }));
  const res = await runBulkSms(deps(fetchFn), {
    orgId, userId, caseIds: [yes.caseId, noConsent.caseId, noPhone.caseId], today,
    templateBody: "Hi {customer}, you owe {balance}.",
  });

  expect(res).toEqual({ sent: 1, failed: 0, skipped: 2 });
  expect(fetchFn).toHaveBeenCalledOnce();
  const { data: rows } = await svc.from("text_messages").select("case_id, invoice_id, body").eq("case_id", yes.caseId);
  expect(rows).toHaveLength(1);
  expect(rows![0].invoice_id).toBe(yes.invoiceId);
  expect(rows![0].body).toBe("Hi Yes Co, you owe $100.00.");
  const { data: skippedRows } = await svc.from("text_messages").select("id").in("case_id", [noConsent.caseId, noPhone.caseId]);
  expect(skippedRows).toHaveLength(0);
});

test("runBulkSms tallies a failed send without aborting siblings", async () => {
  const { data: org } = await svc.from("organizations").insert({ name: "Bulk SMS Fail Org" }).select("id").single();
  const orgId = org!.id as string;
  const a = await seedCase(orgId, { name: "A Co", phone: "+12295550110", consent: true, doc: "2001", due: "2026-05-01", balance: 100 });
  const b = await seedCase(orgId, { name: "B Co", phone: "+12295550111", consent: true, doc: "2002", due: "2026-05-01", balance: 100 });
  let n = 0;
  const fetchFn = vi.fn(async () => { n++; if (n === 1) throw new Error("twilio down"); return jsonResponse({ sid: "SM-OK", status: "queued" }); });
  const res = await runBulkSms(deps(fetchFn), { orgId, userId, caseIds: [a.caseId, b.caseId], today, templateBody: "Hi {customer}" });
  expect(res.sent).toBe(1);
  expect(res.failed).toBe(1);
  expect(res.skipped).toBe(0);
});

test("runBulkSms ignores a foreign-org case id (org-scoped reads drop it)", async () => {
  const { data: orgA } = await svc.from("organizations").insert({ name: "Bulk Scope A" }).select("id").single();
  const { data: orgB } = await svc.from("organizations").insert({ name: "Bulk Scope B" }).select("id").single();
  const inB = await seedCase(orgB!.id as string, { name: "B Only", phone: "+12295550120", consent: true, doc: "3001", due: "2026-05-01", balance: 100 });
  const fetchFn = vi.fn(async () => jsonResponse({ sid: "SM-X", status: "queued" }));
  // Caller resolved to org A but passes org B's case id.
  const res = await runBulkSms(deps(fetchFn), { orgId: orgA!.id as string, userId, caseIds: [inB.caseId], today, templateBody: "Hi {customer}" });
  expect(res).toEqual({ sent: 0, failed: 0, skipped: 0 });
  expect(fetchFn).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd nudgepay-app && npx vitest run tests/bulk-send.test.ts`
Expected: FAIL — cannot import `runBulkSms` (module does not exist).

- [ ] **Step 3: Create `nudgepay-app/app/lib/bulk-send.server.ts`:**

```ts
import { sendInvoiceText, type MessagingDeps } from "./twilio-messaging.server";
import { partitionEligibility, renderCaseBody, clampBatch, type TextableCase, type RenderableCase } from "./bulk";

export type BulkSmsResult = { sent: number; failed: number; skipped: number };

type CaseForSend = TextableCase & RenderableCase & { representativeInvoiceId: string | null };

// Load selected open cases (org-scoped), build per-case totals + oldest-invoice,
// partition eligibility, and send sequentially via sendInvoiceText (each send
// records its own text_messages row, so a mid-loop failure keeps prior sends).
export async function runBulkSms(
  deps: MessagingDeps,
  args: { orgId: string; userId: string; caseIds: string[]; today: string; templateBody: string },
): Promise<BulkSmsResult> {
  const ids = clampBatch(args.caseIds);
  if (ids.length === 0) return { sent: 0, failed: 0, skipped: 0 };
  const svc = deps.service;

  const { data: caseRows, error: caseErr } = await svc.from("collection_cases")
    .select("id, customer_id").eq("org_id", args.orgId).in("id", ids).is("closed_at", null);
  if (caseErr) throw caseErr;
  const cases = ((caseRows as { id: string; customer_id: string }[]) ?? []);
  const customerIds = [...new Set(cases.map((c) => c.customer_id).filter(Boolean))];
  if (customerIds.length === 0) return { sent: 0, failed: 0, skipped: 0 };

  const { data: custRows, error: custErr } = await svc.from("customers")
    .select("id, name, phone, sms_consent").eq("org_id", args.orgId).in("id", customerIds);
  if (custErr) throw custErr;
  const custById = new Map(((custRows as any[]) ?? []).map((c) => [c.id as string, c]));

  const { data: invRows, error: invErr } = await svc.from("invoices")
    .select("id, qbo_doc_number, due_date, balance, customer_id")
    .eq("org_id", args.orgId).in("customer_id", customerIds).gt("balance", 0).lt("due_date", args.today);
  if (invErr) throw invErr;
  const invByCustomer = new Map<string, { id: string; doc: string | null; due: string | null; bal: number }[]>();
  for (const r of ((invRows as any[]) ?? [])) {
    const list = invByCustomer.get(r.customer_id) ?? [];
    list.push({ id: r.id, doc: r.qbo_doc_number, due: r.due_date, bal: Number(r.balance) || 0 });
    invByCustomer.set(r.customer_id, list);
  }

  const built: CaseForSend[] = [];
  for (const c of cases) {
    const cust = custById.get(c.customer_id);
    if (!cust) continue;
    // Oldest overdue invoice first (smallest due_date; ISO strings sort chronologically).
    const invs = (invByCustomer.get(c.customer_id) ?? []).slice()
      .sort((a, b) => (a.due ?? "").localeCompare(b.due ?? ""));
    const totalOverdue = invs.reduce((s, i) => s + i.bal, 0);
    built.push({
      caseId: c.id,
      customerName: (cust.name as string) ?? "(unknown customer)",
      phone: (cust.phone as string) ?? null,
      smsConsent: Boolean(cust.sms_consent),
      totalOverdue,
      invoices: invs.map((i) => ({ invoiceId: i.id, docNumber: i.doc, dueDate: i.due })),
      representativeInvoiceId: invs[0]?.id ?? null,
    });
  }

  const { eligible, skipped } = partitionEligibility(built);
  let sent = 0;
  let failed = 0;
  for (const c of eligible) {
    if (!c.representativeInvoiceId) { failed++; continue; }
    try {
      await sendInvoiceText(deps, {
        orgId: args.orgId,
        invoiceId: c.representativeInvoiceId,
        userId: args.userId,
        body: renderCaseBody(args.templateBody, c),
      });
      sent++;
    } catch {
      failed++; // partial failure is tallied, never fatal
    }
  }
  return { sent, failed, skipped: skipped.length };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd nudgepay-app && npx vitest run tests/bulk-send.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add nudgepay-app/app/lib/bulk-send.server.ts nudgepay-app/tests/bulk-send.test.ts
git commit -m "feat(bulk): runBulkSms — org-scoped load, eligibility, sequential send

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: `api.bulk-assign` route

**Files:**
- Create: `nudgepay-app/app/routes/api.bulk-assign.tsx`
- Modify: `nudgepay-app/app/routes.ts` (register)
- Test: `nudgepay-app/tests/api-bulk-assign.test.ts`

**Interfaces:**
- Consumes: `clampBatch` (`../lib/bulk`); `safeReturnTo` (`../lib/return-to`); `requireUser`, `resolveOrg` (`../lib/session.server`); `getEnv` (`../lib/env.server`).
- Produces: POST `/api/bulk-assign` action; form fields `caseIds` (comma-joined), `ownerId` (`""` = unassign), `returnTo`.

- [ ] **Step 1: Write the failing test** — create `nudgepay-app/tests/api-bulk-assign.test.ts` (mirrors `api-assign.test.ts`: exercises the exact RLS + guard queries the route runs):

```ts
import { expect, test } from "vitest";
import { serviceClient, makeUserClient } from "./helpers";
import { clampBatch, MAX_BATCH } from "../app/lib/bulk";

test("bulk owner update sets every selected customer in one org-scoped query", async () => {
  const svc = serviceClient();
  const { data: org } = await svc.from("organizations").insert({ name: "Bulk Assign A" }).select("id").single();
  const orgId = org!.id as string;
  const a = await makeUserClient("bulk-assign-a@example.com");
  const b = await makeUserClient("bulk-assign-b@example.com");
  await svc.from("memberships").insert([
    { org_id: orgId, user_id: a.userId, role: "owner" },
    { org_id: orgId, user_id: b.userId, role: "member" },
  ]);
  const mk = async (name: string) => {
    const { data: cust } = await svc.from("customers").insert({ org_id: orgId, qbo_id: `ba-${name}`, name }).select("id").single();
    const { data: cse } = await svc.from("collection_cases").insert({ org_id: orgId, customer_id: cust!.id, status: "working" }).select("id").single();
    return { customerId: cust!.id as string, caseId: cse!.id as string };
  };
  const c1 = await mk("One");
  const c2 = await mk("Two");

  // Route: membership guard for the target owner.
  const { data: member } = await a.client.from("memberships").select("user_id").eq("org_id", orgId).eq("user_id", b.userId).maybeSingle();
  expect(member?.user_id).toBe(b.userId);

  // Route: map case ids -> customer ids (org-scoped).
  const caseIds = clampBatch([c1.caseId, c2.caseId]);
  const { data: caseRows } = await a.client.from("collection_cases").select("customer_id").eq("org_id", orgId).in("id", caseIds);
  const customerIds = [...new Set((caseRows ?? []).map((r) => r.customer_id))];
  expect(customerIds.sort()).toEqual([c1.customerId, c2.customerId].sort());

  // Route: one bulk update.
  const { error } = await a.client.from("customers").update({ owner: b.userId }).eq("org_id", orgId).in("id", customerIds);
  expect(error).toBeNull();
  const { data: after } = await svc.from("customers").select("id, owner").in("id", customerIds);
  expect(after!.every((r) => r.owner === b.userId)).toBe(true);
});

test("a foreign-org case id is dropped by the org-scoped case read", async () => {
  const svc = serviceClient();
  const { data: orgA } = await svc.from("organizations").insert({ name: "Bulk Assign Scope A" }).select("id").single();
  const a = await makeUserClient("bulk-assign-scope-a@example.com");
  await svc.from("memberships").insert({ org_id: orgA!.id, user_id: a.userId, role: "owner" });
  // Org B: caller is also a member (RLS alone would permit reads).
  const { data: orgB } = await svc.from("organizations").insert({ name: "Bulk Assign Scope B" }).select("id").single();
  await svc.from("memberships").insert({ org_id: orgB!.id, user_id: a.userId, role: "member" });
  const { data: custB } = await svc.from("customers").insert({ org_id: orgB!.id, qbo_id: "bscope-b1", name: "Org B Co" }).select("id").single();
  const { data: caseB } = await svc.from("collection_cases").insert({ org_id: orgB!.id, customer_id: custB!.id, status: "working" }).select("id").single();

  // Route resolved org = A; binds the case read to A -> B's case id returns nothing.
  const { data: caseRows } = await a.client.from("collection_cases").select("customer_id").eq("org_id", orgA!.id).in("id", [caseB!.id]);
  expect(caseRows).toEqual([]);
});

test("clampBatch caps a bulk-assign id list at MAX_BATCH", () => {
  const ids = Array.from({ length: MAX_BATCH + 10 }, (_, i) => `case-${i}`);
  expect(clampBatch(ids)).toHaveLength(MAX_BATCH);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd nudgepay-app && npx vitest run tests/api-bulk-assign.test.ts`
Expected: FAIL — cannot import `clampBatch`/`MAX_BATCH`? (present from Task 2) — if Task 2 done, the import resolves; the test then exercises live queries and passes for the query parts. To guarantee a red-first signal, run it BEFORE creating the route only to confirm the harness wiring; the route file itself is verified by typecheck in Step 5. (If all assertions already pass because they test queries, that is acceptable — the route is thin wiring over these exact queries.)

> Note: this test validates the queries/guards the route depends on (the established pattern in `api-assign.test.ts`), not the action function directly. The route file is verified by `npm run typecheck`.

- [ ] **Step 3: Create `nudgepay-app/app/routes/api.bulk-assign.tsx`:**

```tsx
import { redirect, type ActionFunctionArgs } from "react-router";
import { getEnv } from "../lib/env.server";
import { requireUser, resolveOrg } from "../lib/session.server";
import { safeReturnTo } from "../lib/return-to";
import { clampBatch } from "../lib/bulk";

function parseIds(form: FormData): string[] {
  const raw = form.get("caseIds");
  if (typeof raw !== "string" || raw.length === 0) return [];
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

function withParams(returnTo: string, params: Record<string, string>): string {
  const url = new URL(returnTo, "http://x");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.pathname + url.search;
}

export async function action({ request, context }: ActionFunctionArgs) {
  const env = getEnv(context as any);
  const { supabase, headers, user } = await requireUser(request, env);
  const org = await resolveOrg(supabase, user.id);
  if (!org) throw redirect("/onboarding", { headers });

  const form = await request.formData();
  const returnTo = safeReturnTo(form.get("returnTo"));
  const caseIds = clampBatch(parseIds(form));
  const ownerRaw = form.get("ownerId");
  const ownerId = typeof ownerRaw === "string" && ownerRaw.length > 0 ? ownerRaw : null;
  if (caseIds.length === 0) return redirect(returnTo, { headers });

  // Membership guard: never assign to a user outside the caller's org.
  if (ownerId) {
    const { data: member } = await supabase
      .from("memberships").select("user_id").eq("org_id", org.org_id).eq("user_id", ownerId).maybeSingle();
    if (!member) return redirect(returnTo, { headers });
  }

  // Map selected case ids -> customer ids, bound to the resolved org (RLS permits
  // every member org, so bind explicitly).
  const { data: caseRows, error: caseErr } = await supabase
    .from("collection_cases").select("customer_id").eq("org_id", org.org_id).in("id", caseIds);
  if (caseErr) throw new Error(`Failed to load cases: ${caseErr.message}`);
  const customerIds = [...new Set(((caseRows as { customer_id: string }[]) ?? []).map((r) => r.customer_id).filter(Boolean))];
  if (customerIds.length === 0) return redirect(returnTo, { headers });

  // One org-scoped bulk update. Throw on error — a silent redirect would imply
  // the assignment saved when it did not.
  const { error } = await supabase
    .from("customers").update({ owner: ownerId }).eq("org_id", org.org_id).in("id", customerIds);
  if (error) throw new Error(`Failed to assign owner: ${error.message}`);

  return redirect(withParams(returnTo, { bulkAssign: "done", count: String(customerIds.length) }), { headers });
}

export function loader() {
  return redirect("/dashboard");
}
```

- [ ] **Step 4: Register the route** in `nudgepay-app/app/routes.ts`. After the `route("api/assign", "routes/api.assign.tsx"),` line add:

```ts
  route("api/bulk-assign", "routes/api.bulk-assign.tsx"),
```

- [ ] **Step 5: Typecheck + run the test**

Run: `cd nudgepay-app && npm run typecheck && npx vitest run tests/api-bulk-assign.test.ts`
Expected: typecheck exit 0; tests PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add nudgepay-app/app/routes/api.bulk-assign.tsx nudgepay-app/app/routes.ts nudgepay-app/tests/api-bulk-assign.test.ts
git commit -m "feat(bulk): org-scoped bulk owner reassignment route

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: `api.bulk-sms` route

**Files:**
- Create: `nudgepay-app/app/routes/api.bulk-sms.tsx`
- Modify: `nudgepay-app/app/routes.ts` (register)

**Interfaces:**
- Consumes: `runBulkSms` (`../lib/bulk-send.server`); `clampBatch` (`../lib/bulk`); `getEnv`, `getTwilioEnv` (`../lib/env.server`); `createSupabaseServiceClient` (`../lib/supabase.server`); `requireUser`, `resolveOrg`; `MessagingDeps` (`../lib/twilio-messaging.server`); `TwilioSender` (`../lib/twilio-client.server`); `safeReturnTo`.
- Produces: POST `/api/bulk-sms` action; form fields `caseIds` (comma-joined), `body` (tokenized template body), `returnTo`.

This route is thin wiring over `runBulkSms` (tested in Task 3) and the env/deps construction copied from `api.text.send.tsx`. Verification is `npm run typecheck` + `npm run build`; no new test (the orchestration + pure logic are already covered).

- [ ] **Step 1: Create `nudgepay-app/app/routes/api.bulk-sms.tsx`:**

```tsx
import { redirect, type ActionFunctionArgs } from "react-router";
import { getEnv, getTwilioEnv } from "../lib/env.server";
import { createSupabaseServiceClient } from "../lib/supabase.server";
import { requireUser, resolveOrg } from "../lib/session.server";
import { type MessagingDeps } from "../lib/twilio-messaging.server";
import type { TwilioSender } from "../lib/twilio-client.server";
import { safeReturnTo } from "../lib/return-to";
import { runBulkSms } from "../lib/bulk-send.server";
import { clampBatch } from "../lib/bulk";

function envSender(t: { TWILIO_MESSAGING_SERVICE_SID: string | null; TWILIO_FROM_NUMBER: string | null }): TwilioSender {
  if (t.TWILIO_MESSAGING_SERVICE_SID) return { messagingServiceSid: t.TWILIO_MESSAGING_SERVICE_SID };
  return { from: t.TWILIO_FROM_NUMBER as string }; // getTwilioEnv guarantees one of the two
}

function parseIds(form: FormData): string[] {
  const raw = form.get("caseIds");
  if (typeof raw !== "string" || raw.length === 0) return [];
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

function withParams(returnTo: string, params: Record<string, string>): string {
  const url = new URL(returnTo, "http://x");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.pathname + url.search;
}

export async function action({ request, context }: ActionFunctionArgs) {
  const env = getEnv(context as any);
  const twilio = getTwilioEnv(context as any);
  const { supabase, headers, user } = await requireUser(request, env);
  const org = await resolveOrg(supabase, user.id);
  if (!org) return redirect("/onboarding", { headers });

  const form = await request.formData();
  const returnTo = safeReturnTo(form.get("returnTo"));
  const caseIds = clampBatch(parseIds(form));
  const bodyRaw = form.get("body");
  const templateBody = typeof bodyRaw === "string" ? bodyRaw.trim() : "";
  if (caseIds.length === 0 || templateBody === "") return redirect(returnTo, { headers });

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
  const today = new Date().toISOString().slice(0, 10);
  const { sent, failed, skipped } = await runBulkSms(deps, {
    orgId: org.org_id, userId: user.id, caseIds, today, templateBody,
  });

  return redirect(
    withParams(returnTo, { bulkSms: "done", sent: String(sent), failed: String(failed), skipped: String(skipped) }),
    { headers },
  );
}

export function loader() {
  return redirect("/dashboard");
}
```

- [ ] **Step 2: Register the route** in `nudgepay-app/app/routes.ts`. After the `route("api/text/send", "routes/api.text.send.tsx"),` line add:

```ts
  route("api/bulk-sms", "routes/api.bulk-sms.tsx"),
```

- [ ] **Step 3: Typecheck + build**

Run: `cd nudgepay-app && npm run typecheck && npm run build`
Expected: typecheck exit 0; build succeeds (client + SSR bundles).

- [ ] **Step 4: Commit**

```bash
git add nudgepay-app/app/routes/api.bulk-sms.tsx nudgepay-app/app/routes.ts
git commit -m "feat(bulk): batch SMS route wiring runBulkSms

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: `BulkActionBar` + `BulkSmsDrawer` components

**Files:**
- Create: `nudgepay-app/app/components/BulkActionBar.tsx`
- Create: `nudgepay-app/app/components/BulkSmsDrawer.tsx`

**Interfaces:**
- Consumes: `MAX_BATCH`, `partitionEligibility`, `renderCaseBody`, `TextableCase`, `RenderableCase` (`../lib/bulk`); `SMS_TEMPLATES` (`../lib/sms-templates`); `Form`, `useNavigation` (`react-router`).
- Produces: `BulkActionBar` (props below); `BulkSmsDrawer` (props below). `DrawerCase = TextableCase & RenderableCase`.

No unit tests (no jsdom in harness). Verify by `npm run typecheck` + `npm run build` at the end of Task 7 when they are rendered.

- [ ] **Step 1: Create `nudgepay-app/app/components/BulkActionBar.tsx`:**

```tsx
import { Form, useNavigation } from "react-router";
import { MAX_BATCH } from "../lib/bulk";

// Roster prop kept minimal (no .server import in a client component).
type RosterOption = { userId: string; label: string };

export function BulkActionBar({
  selectedCaseIds,
  eligibleCount,
  roster,
  returnTo,
  onClear,
  onOpenSms,
}: {
  selectedCaseIds: string[];
  eligibleCount: number;
  roster: RosterOption[];
  returnTo: string;
  onClear: () => void;
  onOpenSms: () => void;
}) {
  const nav = useNavigation();
  const busy = nav.state !== "idle";
  const n = selectedCaseIds.length;

  return (
    <div className="sticky bottom-0 z-30 flex flex-wrap items-center gap-3 border-t border-border bg-surface px-6 py-3 shadow-panel">
      <span className="font-sans text-sm text-text font-medium">
        {n} selected
        <span className="text-muted"> · {eligibleCount} can be texted</span>
        {n >= MAX_BATCH ? <span className="text-muted"> · max {MAX_BATCH} per batch</span> : null}
      </span>

      <Form method="post" action="/api/bulk-assign" className="flex items-center gap-2 ml-auto">
        <input type="hidden" name="caseIds" value={selectedCaseIds.join(",")} />
        <input type="hidden" name="returnTo" value={returnTo} />
        <label htmlFor="bulk-owner" className="sr-only">Assign owner</label>
        <select
          id="bulk-owner"
          name="ownerId"
          defaultValue=""
          className="rounded-md border border-border bg-panel px-2.5 h-9 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
        >
          <option value="">Unassigned</option>
          {roster.map((m) => <option key={m.userId} value={m.userId}>{m.label}</option>)}
        </select>
        <button
          type="submit"
          disabled={busy}
          className="rounded-md border border-border bg-panel px-3 h-9 text-xs font-sans text-text hover:border-copper disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
        >
          Assign
        </button>
      </Form>

      <button
        type="button"
        onClick={onOpenSms}
        disabled={eligibleCount === 0}
        className="rounded-md bg-copper px-3 h-9 text-xs font-sans font-semibold text-ink hover:bg-copper/90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
      >
        Send SMS
      </button>
      <button
        type="button"
        onClick={onClear}
        className="rounded-md border border-border bg-panel px-3 h-9 text-xs font-sans text-muted hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
      >
        Clear
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Create `nudgepay-app/app/components/BulkSmsDrawer.tsx`:**

```tsx
import { useState } from "react";
import { Form, useNavigation } from "react-router";
import { SMS_TEMPLATES } from "../lib/sms-templates";
import { partitionEligibility, renderCaseBody, type SkipReason, type TextableCase, type RenderableCase } from "../lib/bulk";

export type DrawerCase = TextableCase & RenderableCase;

function skippedSummary(skipped: { reason: SkipReason }[]): string {
  const noPhone = skipped.filter((s) => s.reason === "no-phone").length;
  const noConsent = skipped.filter((s) => s.reason === "no-consent").length;
  const parts: string[] = [];
  if (noPhone) parts.push(`${noPhone} no phone`);
  if (noConsent) parts.push(`${noConsent} no consent`);
  return parts.join(", ");
}

export function BulkSmsDrawer({
  open,
  onClose,
  cases,
  returnTo,
}: {
  open: boolean;
  onClose: () => void;
  cases: DrawerCase[];
  returnTo: string;
}) {
  const nav = useNavigation();
  const busy = nav.state !== "idle";
  const [templateId, setTemplateId] = useState(SMS_TEMPLATES[0]?.id ?? "");
  const [body, setBody] = useState(SMS_TEMPLATES[0]?.body ?? "");
  const [confirming, setConfirming] = useState(false);

  if (!open) return null;
  const { eligible, skipped } = partitionEligibility(cases);
  const sample = eligible[0] ? renderCaseBody(body, eligible[0]) : "";

  function pickTemplate(id: string) {
    setTemplateId(id);
    const t = SMS_TEMPLATES.find((x) => x.id === id);
    if (t) setBody(t.body);
  }

  return (
    <div
      role="dialog"
      aria-label="Send batch SMS"
      className="fixed inset-0 z-40 flex items-end sm:items-center justify-center bg-ink/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-lg border border-border bg-surface p-4 shadow-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-display text-lg font-semibold text-text mb-1">
          Send SMS to {eligible.length} customer(s)
        </h2>
        <p className="text-xs font-sans text-muted mb-3">
          {eligible.length} of {cases.length} eligible
          {skipped.length ? ` · ${skipped.length} skipped (${skippedSummary(skipped)})` : ""}
        </p>

        {!confirming ? (
          <>
            <label htmlFor="bulk-template" className="block text-xs font-sans text-muted mb-1">Template</label>
            <select
              id="bulk-template"
              value={templateId}
              onChange={(e) => pickTemplate(e.target.value)}
              className="w-full rounded-md border border-border bg-panel px-2.5 h-9 text-sm text-text mb-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
            >
              {SMS_TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
            <label htmlFor="bulk-body" className="block text-xs font-sans text-muted mb-1">Message</label>
            <textarea
              id="bulk-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
              className="w-full rounded-md border border-border bg-panel px-2.5 py-2 text-sm text-text mb-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
            />
            {sample ? (
              <p className="text-xs font-sans text-muted mb-3">
                <span className="font-medium text-text">Preview:</span> {sample}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className="rounded-md border border-border bg-panel px-3 h-9 text-xs text-muted hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper">
                Cancel
              </button>
              <button
                type="button"
                onClick={() => setConfirming(true)}
                disabled={eligible.length === 0 || body.trim() === ""}
                className="rounded-md bg-copper px-3 h-9 text-xs font-semibold text-ink hover:bg-copper/90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
              >
                Review
              </button>
            </div>
          </>
        ) : (
          <Form method="post" action="/api/bulk-sms">
            <input type="hidden" name="caseIds" value={eligible.map((c) => c.caseId).join(",")} />
            <input type="hidden" name="body" value={body} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <p className="text-sm font-sans text-text mb-3">
              Send this message to {eligible.length} customer(s)? This cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setConfirming(false)} className="rounded-md border border-border bg-panel px-3 h-9 text-xs text-muted hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper">
                Back
              </button>
              <button
                type="submit"
                disabled={busy}
                className="rounded-md bg-copper px-3 h-9 text-xs font-semibold text-ink hover:bg-copper/90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
              >
                {busy ? "Sending…" : `Send ${eligible.length}`}
              </button>
            </div>
          </Form>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `cd nudgepay-app && npm run typecheck`
Expected: exit 0 (components compile; not yet rendered).

- [ ] **Step 4: Commit**

```bash
git add nudgepay-app/app/components/BulkActionBar.tsx nudgepay-app/app/components/BulkSmsDrawer.tsx
git commit -m "feat(bulk): action bar + SMS confirm drawer components

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: WorkQueue selection + dashboard wiring + result banners

**Files:**
- Modify: `nudgepay-app/app/components/WorkQueue.tsx` (selection state, checkboxes, render bar/drawer)
- Modify: `nudgepay-app/app/routes/dashboard.tsx` (parse result params; pass `roster`+`returnTo` to `WorkQueue`; render banners)

**Interfaces:**
- Consumes: `BulkActionBar` (`./BulkActionBar`); `BulkSmsDrawer` + `DrawerCase` (`./BulkSmsDrawer`); `partitionEligibility`, `clampBatch` (`../lib/bulk`); `CaseItem` (already imported).
- Produces: `WorkQueueProps` gains `roster: { userId: string; label: string }[]` and `returnTo: string`.

No unit tests (no jsdom). Verify with `npm run typecheck` + `npm run build`.

- [ ] **Step 1: Add imports + props to `WorkQueue.tsx`.** Replace the top import block (lines 1–7) with:

```tsx
import { useEffect, useState } from "react";
import { Form, Link } from "react-router";
import type { ViewId, SortId } from "../lib/worklist";
import type { CaseItem } from "../lib/cases";
import { formatDate } from "../lib/dates";
import { STATUS_LABEL, formatUSD } from "../lib/format";
import { partitionEligibility, clampBatch } from "../lib/bulk";
import { BulkActionBar } from "./BulkActionBar";
import { BulkSmsDrawer } from "./BulkSmsDrawer";
import { ThermalBand } from "./ThermalBand";
import { Icon } from "./Icons";
```

Update `WorkQueueProps` (the `interface WorkQueueProps { ... }` block) to add two props:

```tsx
interface WorkQueueProps {
  items: CaseItem[];
  view: ViewId;
  sort: SortId;
  search: string;
  selectedCaseId: string | null;
  totalCount: number;
  viewCounts: Record<ViewId, number>;
  roster: { userId: string; label: string }[];
  returnTo: string;
}
```

- [ ] **Step 2: Give `QueueRow` + `MobileCard` a selection checkbox.** Change the `QueueRow` signature to accept selection props and render a checkbox as a SIBLING of the `<Link>` (a checkbox inside the `<Link>` would navigate on click). Replace the entire `QueueRow` function with:

```tsx
function QueueRow({
  item,
  selected,
  view,
  sort,
  search,
  checked,
  onToggle,
}: {
  item: CaseItem;
  selected: boolean;
  view: ViewId;
  sort: SortId;
  search: string;
  checked: boolean;
  onToggle: (id: string) => void;
}) {
  const params = new URLSearchParams({ case: item.caseId, view, sort, ...(search ? { q: search } : {}) });
  const href = `?${params.toString()}`;

  return (
    <div
      className={[
        "flex items-center border-b border-border transition-colors duration-100 hover:bg-panel",
        selected ? "border-l-2 border-l-copper bg-copper/5" : "border-l-2 border-l-transparent",
      ].join(" ")}
    >
      <label className="flex items-center pl-4 pr-1 cursor-pointer" onClick={(e) => e.stopPropagation()}>
        <span className="sr-only">Select {item.customerName}</span>
        <input
          type="checkbox"
          checked={checked}
          onChange={() => onToggle(item.caseId)}
          className="h-4 w-4 rounded border-border text-copper focus-visible:ring-2 focus-visible:ring-copper"
        />
      </label>
      <Link
        to={href}
        aria-label={`Open ${item.customerName}`}
        aria-current={selected ? "true" : undefined}
        className={[
          "group flex-1 grid items-center gap-x-6 gap-y-0",
          "grid-cols-[auto_minmax(140px,1.5fr)_minmax(96px,0.9fr)_minmax(56px,0.5fr)]",
          "lg:grid-cols-[auto_minmax(140px,1.3fr)_minmax(96px,0.8fr)_minmax(56px,0.5fr)_minmax(96px,0.85fr)_minmax(230px,2fr)]",
          "xl:grid-cols-[auto_minmax(140px,1.3fr)_minmax(96px,0.8fr)_minmax(56px,0.5fr)_minmax(96px,0.85fr)_minmax(230px,2fr)_minmax(104px,0.75fr)]",
          "px-4 py-2.5 text-sm",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper focus-visible:ring-inset",
        ].join(" ")}
      >
        {/* Heat */}
        <span data-label="Heat" className="hidden md:flex">
          <ThermalBand heat={item.heat} />
        </span>

        {/* Customer */}
        <span data-label="Customer" className="min-w-0">
          <span className="block font-sans text-text truncate">{item.customerName}</span>
          <span className="flex items-center gap-1.5">
            <span className="font-mono text-xs text-muted">{item.invoiceCount} invoice(s)</span>
            <span className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-sans font-semibold ${LEVEL_BADGE[item.effectiveLevel] ?? "text-muted"}`}>
              {item.override ? <span aria-hidden>📌</span> : null}
              {item.effectiveLevel}
            </span>
          </span>
        </span>

        {/* Total overdue */}
        <span data-label="Total overdue" className="font-mono text-text tabular-nums text-right hidden md:block">
          {formatUSD(item.totalOverdue)}
        </span>

        {/* Oldest age */}
        <span data-label="Oldest age" className="font-mono text-sm text-muted tabular-nums hidden md:block whitespace-nowrap">
          {item.oldestAgeDays > 0 ? `${item.oldestAgeDays}d` : "Due"}
        </span>

        {/* Last contact */}
        <span data-label="Last contact" className="hidden lg:block min-w-0">
          {item.lastContact ? (
            <>
              <span className="block text-text text-xs">{formatDate(item.lastContact.date)}</span>
              <span className="block text-muted text-xs capitalize">{item.lastContact.channel}</span>
            </>
          ) : (
            <span className="text-muted text-xs">Never contacted</span>
          )}
        </span>

        {/* Status + next action date */}
        <span data-label="Status" className="hidden lg:block min-w-0 text-xs font-sans font-medium whitespace-nowrap text-text">
          {STATUS_LABEL[item.status] ?? item.status}
          {item.nextActionAt ? <span className="text-muted"> · {formatDate(item.nextActionAt)}</span> : null}
          {item.promiseStatus === "broken" ? <span className="text-hot"> · Promise broken</span> : null}
        </span>

        {/* Owner chip */}
        <span data-label="Owner" className="hidden xl:inline-flex items-center gap-1 rounded-full bg-panel border border-border px-2 py-0.5 text-xs text-muted font-sans whitespace-nowrap">
          <Icon name="user" size={12} aria-hidden />
          {item.owner}
        </span>
      </Link>
    </div>
  );
}
```

- [ ] **Step 3: Add a checkbox to `MobileCard`.** Change its signature to add `checked`/`onToggle`, and insert a checkbox in the card header. Replace the `MobileCard` `return (` opening and Row-1 block: add, immediately inside the outer `<Link ...>`'s first child `<div className="flex items-start justify-between gap-3 mb-2">`, a leading checkbox. Simplest: wrap the card like `QueueRow` — replace the whole `MobileCard` function with:

```tsx
function MobileCard({
  item, selected, view, sort, search, checked, onToggle,
}: {
  item: CaseItem; selected: boolean; view: ViewId; sort: SortId; search: string;
  checked: boolean; onToggle: (id: string) => void;
}) {
  const params = new URLSearchParams({ case: item.caseId, view, sort, ...(search ? { q: search } : {}) });
  const href = `?${params.toString()}`;
  return (
    <div className={["flex gap-2 items-start bg-surface border rounded-lg p-3 mb-2", selected ? "border-copper ring-2 ring-copper bg-copper/5" : "border-border"].join(" ")}>
      <label className="pt-1 cursor-pointer" onClick={(e) => e.stopPropagation()}>
        <span className="sr-only">Select {item.customerName}</span>
        <input type="checkbox" checked={checked} onChange={() => onToggle(item.caseId)} className="h-4 w-4 rounded border-border text-copper focus-visible:ring-2 focus-visible:ring-copper" />
      </label>
      <Link to={href} aria-label={`Open ${item.customerName}`} aria-current={selected ? "true" : undefined} className="flex-1 min-w-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper rounded">
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="flex items-center gap-2 min-w-0">
            <ThermalBand heat={item.heat} />
            <div className="min-w-0">
              <p className="font-sans text-text font-medium truncate">{item.customerName}</p>
              <p className="flex items-center gap-1.5">
                <span className="font-mono text-xs text-muted">{item.invoiceCount} invoice(s)</span>
                <span className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-sans font-semibold ${LEVEL_BADGE[item.effectiveLevel] ?? "text-muted"}`}>
                  {item.override ? <span aria-hidden>📌</span> : null}
                  {item.effectiveLevel}
                </span>
              </p>
            </div>
          </div>
          <span className="font-mono text-text tabular-nums text-right shrink-0 text-sm">{formatUSD(item.totalOverdue)}</span>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="font-mono text-muted tabular-nums">{item.oldestAgeDays > 0 ? `${item.oldestAgeDays}d` : "Due"}</span>
          <span className="font-sans font-medium text-text">
            {STATUS_LABEL[item.status] ?? item.status}
            {item.nextActionAt ? <span className="text-muted"> · {formatDate(item.nextActionAt)}</span> : null}
            {item.promiseStatus === "broken" ? <span className="text-hot"> · Promise broken</span> : null}
          </span>
        </div>
        <div className="mt-1 text-xs">
          {item.lastContact ? (
            <span className="text-muted">{formatDate(item.lastContact.date)} · {item.lastContact.channel}</span>
          ) : (
            <span className="text-muted">Never contacted</span>
          )}
        </div>
      </Link>
    </div>
  );
}
```

- [ ] **Step 4: Add selection state to the `WorkQueue` component.** Replace the `export function WorkQueue({ ... }: WorkQueueProps) {` signature + opening to destructure the new props and hold selection state. Change the destructure to include `roster, returnTo`, and immediately after it add:

```tsx
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [smsOpen, setSmsOpen] = useState(false);

  // Selection is per-view: clear it whenever the filter/sort/search changes
  // (the queue re-renders with a different item set on navigation).
  useEffect(() => {
    setSelected(new Set());
    setSmsOpen(false);
  }, [view, sort, search]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const allVisibleIds = clampBatch(items.map((i) => i.caseId));
  const allSelected = allVisibleIds.length > 0 && allVisibleIds.every((id) => selected.has(id));
  const toggleAll = () =>
    setSelected((prev) => (allSelected ? new Set() : new Set(allVisibleIds)));

  const selectedCases = items.filter((i) => selected.has(i.caseId));
  const eligibleCount = partitionEligibility(selectedCases).eligible.length;
```

- [ ] **Step 5: Render the header "select all" checkbox + pass selection into rows.** In the desktop column-header grid (the `<div className="grid items-center gap-x-6 px-6 py-2 ...">`), change its grid template to prepend a checkbox track and add a leading header cell. Replace the column-header `<div ...>` opening + its first child with:

```tsx
              <div
                className="flex items-center px-4 py-2 border-b border-border bg-panel"
                aria-hidden="false"
              >
                <label className="flex items-center pr-1 cursor-pointer">
                  <span className="sr-only">Select all matching</span>
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    className="h-4 w-4 rounded border-border text-copper focus-visible:ring-2 focus-visible:ring-copper"
                  />
                </label>
                <div className="flex-1 grid items-center gap-x-6 grid-cols-[auto_minmax(140px,1.5fr)_minmax(96px,0.9fr)_minmax(56px,0.5fr)] lg:grid-cols-[auto_minmax(140px,1.3fr)_minmax(96px,0.8fr)_minmax(56px,0.5fr)_minmax(96px,0.85fr)_minmax(230px,2fr)] xl:grid-cols-[auto_minmax(140px,1.3fr)_minmax(96px,0.8fr)_minmax(56px,0.5fr)_minmax(96px,0.85fr)_minmax(230px,2fr)_minmax(104px,0.75fr)]">
                  <span className="font-sans text-xs text-muted uppercase tracking-wide">Heat</span>
                  <span className="font-sans text-xs text-muted uppercase tracking-wide">Customer</span>
                  <span className="font-sans text-xs text-muted uppercase tracking-wide text-right">Total overdue</span>
                  <span className="font-sans text-xs text-muted uppercase tracking-wide">Oldest age</span>
                  <span className="font-sans text-xs text-muted uppercase tracking-wide hidden lg:block">Last contact</span>
                  <span className="font-sans text-xs text-muted uppercase tracking-wide hidden lg:block">Status</span>
                  <span className="font-sans text-xs text-muted uppercase tracking-wide hidden xl:block">Owner</span>
                </div>
              </div>
```

(Delete the old standalone column-header `<div className="grid ... grid-cols-[auto_...]">` block with its seven `<span>`s — it is replaced by the markup above.)

- [ ] **Step 6: Pass selection props to the rows.** In the desktop `items.map(...)` that renders `<QueueRow .../>`, add `checked` + `onToggle`:

```tsx
                    <QueueRow
                      item={item}
                      selected={selectedCaseId === item.caseId}
                      view={view}
                      sort={sort}
                      search={search}
                      checked={selected.has(item.caseId)}
                      onToggle={toggle}
                    />
```

And in the mobile `items.map(...)` rendering `<MobileCard .../>`:

```tsx
                <MobileCard
                  key={item.caseId}
                  item={item}
                  selected={selectedCaseId === item.caseId}
                  view={view}
                  sort={sort}
                  search={search}
                  checked={selected.has(item.caseId)}
                  onToggle={toggle}
                />
```

- [ ] **Step 7: Render the action bar + drawer.** Immediately before the closing `</section>` of `WorkQueue`, add:

```tsx
      {selected.size > 0 ? (
        <BulkActionBar
          selectedCaseIds={[...selected]}
          eligibleCount={eligibleCount}
          roster={roster}
          returnTo={returnTo}
          onClear={() => setSelected(new Set())}
          onOpenSms={() => setSmsOpen(true)}
        />
      ) : null}
      <BulkSmsDrawer
        open={smsOpen}
        onClose={() => setSmsOpen(false)}
        cases={selectedCases}
        returnTo={returnTo}
      />
```

- [ ] **Step 8: Wire `dashboard.tsx` — pass `roster` + `returnTo` to `WorkQueue`.** In the render (`<WorkQueue ... />`, ~line 552), add the two props:

```tsx
              <WorkQueue
                items={items}
                view={view}
                sort={sort}
                search={q}
                selectedCaseId={selected?.caseId ?? null}
                totalCount={viewCounts["all-open"]}
                viewCounts={viewCounts}
                roster={roster}
                returnTo={`/dashboard?${new URLSearchParams({ view, sort, ...(q ? { q } : {}) }).toString()}`}
              />
```

`roster` is already in `useLoaderData` (destructured at the top of the component). `OrgMember` (`{ userId, email, label }`) is structurally assignable to the bar's `{ userId, label }[]` prop.

- [ ] **Step 9: Parse + render result banners in `dashboard.tsx`.** In the loader, after the existing `const log = sp.get("log") === "1";` block (~line 233), add:

```ts
  const bulkAssign = sp.get("bulkAssign");
  const bulkAssignCount = sp.get("count");
  const bulkSms = sp.get("bulkSms");
  const bulkSent = sp.get("sent");
  const bulkFailed = sp.get("failed");
  const bulkSkipped = sp.get("skipped");
```

Add these to the returned `data({ ... })` object (alongside `saved`):

```ts
      bulkAssign,
      bulkAssignCount,
      bulkSms,
      bulkSent,
      bulkFailed,
      bulkSkipped,
```

Destructure them in the component (`const { ... } = useLoaderData<typeof loader>();`):

```tsx
    bulkAssign,
    bulkAssignCount,
    bulkSms,
    bulkSent,
    bulkFailed,
    bulkSkipped,
```

Render a banner next to the existing `{saved ? ... : null}` block (just after it):

```tsx
      {bulkAssign === "done" ? (
        <div className="px-6 py-2 bg-cool/10 border-b border-cool/30 text-sm font-sans font-medium text-cool" role="status">
          Reassigned {bulkAssignCount ?? "0"} account(s).
        </div>
      ) : null}
      {bulkSms === "done" ? (
        <div className="px-6 py-2 bg-cool/10 border-b border-cool/30 text-sm font-sans font-medium text-cool" role="status">
          Sent {bulkSent ?? "0"} · Failed {bulkFailed ?? "0"} · Skipped {bulkSkipped ?? "0"}.
        </div>
      ) : null}
```

- [ ] **Step 10: Typecheck + build**

Run: `cd nudgepay-app && npm run typecheck && npm run build`
Expected: typecheck exit 0; build succeeds (client + SSR).

- [ ] **Step 11: Run the full test suite (no regressions)**

Run: `cd nudgepay-app && npx vitest run`
Expected: all suites green (the Task 1–4 additions plus existing suites).

- [ ] **Step 12: Commit**

```bash
git add nudgepay-app/app/components/WorkQueue.tsx nudgepay-app/app/routes/dashboard.tsx
git commit -m "feat(bulk): queue multi-select + action bar/drawer wiring + result banners

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Housekeeping — gap checklist marks

**Files:**
- Modify: `docs/superpowers/2026-06-23-nudgepay-requirements-gap-checklist.md`

No code, no test. Documentation correctness fix (the stale B5 mark) + record C5.

- [ ] **Step 1: Mark B5 done.** Replace the B5 block (currently `- [ ] **B5 — Multi-factor + override-able priority.** ...` plus its `Current:` sub-bullet) with:

```markdown
- [x] **B5 — Multi-factor + override-able priority.** ✅ **7b (merged main, PR #1).** `scorePriority` (`priority.ts`) weights age + balance + broken-promise + silence + follow-up-due into a numeric score → level thresholds; `priorAttempts` tiebreaker; manual pinned-level override (migration `0012`, `priority_override*` columns; `overrideToLevel`) shown transparently ("Pinned … · computed …") in the queue + "Why this priority" panel.
```

- [ ] **Step 2: Mark C5 done.** In the C section, replace `- [ ] **C5 — Bulk assignment & batch messaging.** ...` with:

```markdown
- [x] **C5 — Bulk assignment & batch messaging.** ✅ **8a.** Queue multi-select (checkbox + "select all matching", `MAX_BATCH=50`); bulk owner reassign (`api.bulk-assign`, org+membership guarded single UPDATE); batch templated SMS (`api.bulk-sms` → `runBulkSms`: org-scoped load, eligibility partition, sequential per-case send recording each `text_messages` row). Pure `bulk.ts` for eligibility + per-case rendering.
```

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/2026-06-23-nudgepay-requirements-gap-checklist.md
git commit -m "docs: mark B5 (7b) + C5 (8a) complete in gap checklist

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage:**
- §2 selection model → Task 7 (checkbox state, select-all, clear-on-nav, sticky bar). ✓
- §3 bulk assign → Task 4 (org+membership guard, single `.in()` UPDATE, throw on error, count banner). ✓
- §4 batch SMS (eligibility, rendering, sequential capped send, two-step confirm) → Tasks 2 (`bulk.ts`), 3 (`runBulkSms`), 5 (route), 6 (drawer). ✓
- §4 `smsConsent` threading → Task 1. ✓
- §4.8 result banners → Task 7. ✓
- §5 RLS/security/cap/double-submit → Tasks 3/4/5 (org-scoped reads, clamp both sides), 6 (confirm button `useNavigation` disable). ✓
- §6 testing (pure `bulk.test.ts`, integration `bulk-send.test.ts` + `api-bulk-assign.test.ts`, no-jsdom UI verification) → Tasks 2/3/4 + 6/7 typecheck+build. ✓
- §9 stale-B5 + C5 marks → Task 8. ✓

**2. Placeholder scan:** No "TBD"/"TODO"/"handle edge cases"/"similar to Task N" — every code step shows complete code; every command shows the exact invocation + expected result. ✓

**3. Type consistency:** `CaseItem.smsConsent` (Task 1) is consumed by `partitionEligibility` via the structural `TextableCase` (Task 2); `runBulkSms` (Task 3) builds `CaseForSend = TextableCase & RenderableCase & {representativeInvoiceId}` and calls `renderCaseBody`/`partitionEligibility` with matching shapes; routes (Tasks 4/5) import `clampBatch`/`runBulkSms` with the exact signatures produced; `WorkQueue` (Task 7) passes `CaseItem[]` where `DrawerCase = TextableCase & RenderableCase` is expected (CaseItem satisfies both structurally) and `roster: OrgMember[]` where `{userId,label}[]` is expected (OrgMember satisfies it). Form field names (`caseIds`, `ownerId`, `body`, `returnTo`) match between components (Task 6) and routes (Tasks 4/5). ✓

**Note on TDD red-step for Task 4:** its test exercises the queries/guards the route relies on (the `api-assign.test.ts` pattern), so some assertions pass before the route file exists; the route file is gated by `npm run typecheck`. This is the established repo convention for route-action coverage, not a test-hygiene miss.
