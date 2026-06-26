# C6 — Communication Preferences Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-customer communication preferences — a single preferred channel plus per-channel opt-outs — captured in a dedicated panel, enforced on the SMS path, and surfaced as case-row badges.

**Architecture:** A new pure module `comm-prefs.ts` is the single source of truth for SMS eligibility (`canSendSms`) and badge state (`channelBlocked`). Four columns on `customers` store the prefs (no new table, no RLS change). `do_not_text` layers on the existing legal `sms_consent` gate in bulk + single send; `do_not_call`/`do_not_email` are advisory until C3. Reps edit prefs via a slide-over that POSTs to a new RLS-scoped `api.comm-prefs` action, mirroring `api.sms-consent`.

**Tech Stack:** React Router framework-mode (loaders/actions + GET-form/Link navigation), Supabase/Postgres with RLS, Vitest (DB-integration via local Supabase + pure unit tests), TypeScript.

## Global Constraints

- `comm-prefs.ts` is PURE: no I/O, no `node:*`, no `.server` suffix. Imported by routes, components, and tests.
- `sms_consent` is the **legal** consent record and is NEVER modified by a preferences write. STOP/START continues to govern it exclusively. The new opt-outs are **preferences**.
- SMS eligibility = `sms_consent AND NOT do_not_text` (`canSendSms`). `do_not_text` is a distinct skip reason from `no-consent`.
- `do_not_call` / `do_not_email` have no outbound path in C6 (deferred to C3) — advisory badges only, never block anything.
- `preferred_channel` ∈ `{'call','text','email'}` or `NULL` (no preference). Channels match the contact-log methods.
- Preferences write path is the RLS-scoped USER client (the `customers_all` policy already permits org-member CRUD); resolve the customer via an org-readable `invoiceId`, exactly like `api.sms-consent`. No service client, no new RLS.
- Tests: `npx vitest run` (NOT `npm test`), from `nudgepay-app/`. DB-integration tests use `serviceClient()` / `makeUserClient()` from `./helpers`; env var is `SUPABASE_SERVICE_KEY`. Local Supabase must be up (Docker).
- Verification gates: `npx vitest run` (all green), `npx tsc --noEmit` (exit 0), `npx react-router build` (clean).
- Conventional Commits. Commit trailer on every commit: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Commit ONLY named source files (never `.superpowers/` scratch).

---

### Task 1: Pure `comm-prefs.ts` module + tests

**Files:**
- Create: `nudgepay-app/app/lib/comm-prefs.ts`
- Test: `nudgepay-app/tests/comm-prefs.test.ts`

**Interfaces:**
- Consumes: nothing (foundational pure module).
- Produces:
  - `CHANNELS: readonly ["call","text","email"]`, `type Channel = "call"|"text"|"email"`
  - `type CommPrefs = { preferredChannel: Channel|null; doNotCall: boolean; doNotEmail: boolean; doNotText: boolean }`
  - `DEFAULT_COMM_PREFS: CommPrefs`
  - `type CommPrefsRow = { preferred_channel?: string|null; do_not_call?: boolean|null; do_not_email?: boolean|null; do_not_text?: boolean|null }`
  - `resolveCommPrefs(row: CommPrefsRow|null|undefined): CommPrefs`
  - `canSendSms(prefs: CommPrefs, smsConsent: boolean): boolean`
  - `channelBlocked(prefs: CommPrefs, channel: Channel): boolean`

- [ ] **Step 1: Write the failing test**

Create `nudgepay-app/tests/comm-prefs.test.ts`:

```ts
import { expect, test } from "vitest";
import {
  resolveCommPrefs, canSendSms, channelBlocked, DEFAULT_COMM_PREFS,
} from "../app/lib/comm-prefs";

test("resolveCommPrefs maps a full snake_case row", () => {
  expect(resolveCommPrefs({
    preferred_channel: "email", do_not_call: true, do_not_email: false, do_not_text: true,
  })).toEqual({ preferredChannel: "email", doNotCall: true, doNotEmail: false, doNotText: true });
});

test("resolveCommPrefs returns defaults for null/undefined", () => {
  expect(resolveCommPrefs(null)).toEqual(DEFAULT_COMM_PREFS);
  expect(resolveCommPrefs(undefined)).toEqual(DEFAULT_COMM_PREFS);
});

test("resolveCommPrefs coerces nullish booleans to false and unknown channel to null", () => {
  expect(resolveCommPrefs({ preferred_channel: "fax", do_not_call: null, do_not_text: undefined }))
    .toEqual({ preferredChannel: null, doNotCall: false, doNotEmail: false, doNotText: false });
  expect(resolveCommPrefs({ preferred_channel: null })).toEqual(DEFAULT_COMM_PREFS);
});

test("canSendSms requires legal consent AND not opted out of text", () => {
  const base = { preferredChannel: null, doNotCall: false, doNotEmail: false } as const;
  expect(canSendSms({ ...base, doNotText: false }, true)).toBe(true);
  expect(canSendSms({ ...base, doNotText: true }, true)).toBe(false);   // preference opt-out
  expect(canSendSms({ ...base, doNotText: false }, false)).toBe(false); // no legal consent
  expect(canSendSms({ ...base, doNotText: true }, false)).toBe(false);
});

test("channelBlocked reads the matching per-channel flag", () => {
  const prefs = { preferredChannel: null, doNotCall: true, doNotEmail: false, doNotText: true };
  expect(channelBlocked(prefs, "call")).toBe(true);
  expect(channelBlocked(prefs, "email")).toBe(false);
  expect(channelBlocked(prefs, "text")).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd nudgepay-app && npx vitest run tests/comm-prefs.test.ts`
Expected: FAIL — cannot resolve `../app/lib/comm-prefs`.

- [ ] **Step 3: Write the implementation**

Create `nudgepay-app/app/lib/comm-prefs.ts`:

```ts
// Pure module — no I/O, no node:*, no .server suffix. Per-customer communication
// preferences: a single preferred channel plus per-channel opt-outs. Single
// source of truth for SMS eligibility (canSendSms) and badge state
// (channelBlocked). These are PREFERENCES, distinct from the legal sms_consent
// record (TCPA/A2P) which STOP/START governs exclusively.

export const CHANNELS = ["call", "text", "email"] as const;
export type Channel = (typeof CHANNELS)[number];

export type CommPrefs = {
  preferredChannel: Channel | null;
  doNotCall: boolean;
  doNotEmail: boolean;
  doNotText: boolean;
};

export const DEFAULT_COMM_PREFS: CommPrefs = {
  preferredChannel: null,
  doNotCall: false,
  doNotEmail: false,
  doNotText: false,
};

export type CommPrefsRow = {
  preferred_channel?: string | null;
  do_not_call?: boolean | null;
  do_not_email?: boolean | null;
  do_not_text?: boolean | null;
};

function isChannel(v: string | null | undefined): v is Channel {
  return v === "call" || v === "text" || v === "email";
}

// Map a (possibly partial/nullable) DB row to CommPrefs. Unknown
// preferred_channel coerces to null; nullish booleans coerce to false.
export function resolveCommPrefs(row: CommPrefsRow | null | undefined): CommPrefs {
  if (!row) return { ...DEFAULT_COMM_PREFS };
  return {
    preferredChannel: isChannel(row.preferred_channel) ? row.preferred_channel : null,
    doNotCall: Boolean(row.do_not_call),
    doNotEmail: Boolean(row.do_not_email),
    doNotText: Boolean(row.do_not_text),
  };
}

// Single source of truth for SMS eligibility: legal consent AND not opted out.
export function canSendSms(prefs: CommPrefs, smsConsent: boolean): boolean {
  return smsConsent && !prefs.doNotText;
}

// Is a given channel opted out (for badge/warning rendering)?
export function channelBlocked(prefs: CommPrefs, channel: Channel): boolean {
  switch (channel) {
    case "call": return prefs.doNotCall;
    case "text": return prefs.doNotText;
    case "email": return prefs.doNotEmail;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd nudgepay-app && npx vitest run tests/comm-prefs.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Typecheck**

Run: `cd nudgepay-app && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add nudgepay-app/app/lib/comm-prefs.ts nudgepay-app/tests/comm-prefs.test.ts
git commit -m "feat(comm-prefs): pure preference model + SMS eligibility (C6)"
```

---

### Task 2: Migration `0017_comm_preferences.sql` + schema test

**Files:**
- Create: `nudgepay-app/supabase/migrations/0017_comm_preferences.sql`
- Test: `nudgepay-app/tests/comm-prefs-schema.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: four columns on `customers` — `preferred_channel text CHECK (... in ('call','text','email'))`, `do_not_call`/`do_not_email`/`do_not_text boolean NOT NULL DEFAULT false`.

**Migration apply note:** the local Supabase DB picks up new migrations on `npx supabase db reset` (or `stop`/`start`). The global test setup (`tests/global-setup.ts`) only truncates; it does NOT run migrations. After writing the migration file, run `cd nudgepay-app && npx supabase migration up` (or `npx supabase db reset` if `migration up` is unavailable) so the columns exist before running the schema test.

- [ ] **Step 1: Write the migration**

Create `nudgepay-app/supabase/migrations/0017_comm_preferences.sql`:

```sql
-- C6: per-customer communication preferences. A single preferred channel plus
-- per-channel opt-outs. These are PREFERENCES, distinct from the legal
-- sms_consent record (TCPA/A2P) which STOP/START continues to govern. RLS is
-- unchanged: the existing customers_all policy already gates read and write by
-- org membership.
alter table customers
  add column preferred_channel text
    check (preferred_channel in ('call', 'text', 'email')),
  add column do_not_call  boolean not null default false,
  add column do_not_email boolean not null default false,
  add column do_not_text  boolean not null default false;
```

- [ ] **Step 2: Apply the migration locally**

Run: `cd nudgepay-app && npx supabase migration up`
Expected: applies `0017_comm_preferences.sql` with no error. (If the CLI reports the migration is already applied or unavailable, run `npx supabase db reset` to rebuild the local DB from all migrations.)

- [ ] **Step 3: Write the failing test**

Create `nudgepay-app/tests/comm-prefs-schema.test.ts`:

```ts
import { expect, test } from "vitest";
import { serviceClient } from "./helpers";

const svc = serviceClient();

async function newOrg(name: string) {
  const { data: org } = await svc.from("organizations").insert({ name }).select("id").single();
  return org!.id as string;
}

test("customers accepts a valid preferred_channel and the opt-out flags", async () => {
  const orgId = await newOrg("C6 schema ok");
  const { data, error } = await svc.from("customers")
    .insert({ org_id: orgId, name: "Acme", preferred_channel: "text", do_not_call: true })
    .select("preferred_channel, do_not_call, do_not_email, do_not_text").single();
  expect(error).toBeNull();
  expect(data!.preferred_channel).toBe("text");
  expect(data!.do_not_call).toBe(true);
  expect(data!.do_not_email).toBe(false); // default
  expect(data!.do_not_text).toBe(false);  // default
});

test("customers accepts a NULL preferred_channel (no preference)", async () => {
  const orgId = await newOrg("C6 schema null");
  const { error } = await svc.from("customers")
    .insert({ org_id: orgId, name: "NoPref", preferred_channel: null });
  expect(error).toBeNull();
});

test("customers rejects an out-of-set preferred_channel", async () => {
  const orgId = await newOrg("C6 schema bad");
  const { error } = await svc.from("customers")
    .insert({ org_id: orgId, name: "BadChan", preferred_channel: "fax" });
  expect(error).not.toBeNull();
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd nudgepay-app && npx vitest run tests/comm-prefs-schema.test.ts`
Expected: PASS (3 tests). (If it fails because the columns are missing, the migration was not applied — re-run Step 2.)

- [ ] **Step 5: Commit**

```bash
git add nudgepay-app/supabase/migrations/0017_comm_preferences.sql nudgepay-app/tests/comm-prefs-schema.test.ts
git commit -m "feat(db): comm-preferences columns on customers (C6)"
```

---

### Task 3: Bulk SMS eligibility — `do-not-text` skip reason

**Files:**
- Modify: `nudgepay-app/app/lib/bulk.ts`
- Modify: `nudgepay-app/app/lib/bulk-send.server.ts`
- Test: `nudgepay-app/tests/bulk.test.ts` (extend)

**Interfaces:**
- Consumes: `partitionEligibility<T extends TextableCase>(cases: T[])` from `bulk.ts`.
- Produces: `SkipReason` now includes `"do-not-text"`; `TextableCase` now requires `doNotText: boolean`.

- [ ] **Step 1: Write the failing tests**

Append to `nudgepay-app/tests/bulk.test.ts` (use the existing import of `partitionEligibility` / `TextableCase`; add one if absent):

```ts
test("partitionEligibility skips a do-not-text customer with reason do-not-text", () => {
  const { eligible, skipped } = partitionEligibility([
    { caseId: "c1", customerName: "OptOut", phone: "+1", smsConsent: true, doNotText: true },
  ]);
  expect(eligible).toHaveLength(0);
  expect(skipped).toEqual([{ caseId: "c1", name: "OptOut", reason: "do-not-text" }]);
});

test("partitionEligibility reports no-consent before do-not-text when both apply", () => {
  const { skipped } = partitionEligibility([
    { caseId: "c2", customerName: "Both", phone: "+1", smsConsent: false, doNotText: true },
  ]);
  expect(skipped[0].reason).toBe("no-consent");
});

test("partitionEligibility keeps a consented, non-opted-out customer eligible", () => {
  const { eligible, skipped } = partitionEligibility([
    { caseId: "c3", customerName: "Ok", phone: "+1", smsConsent: true, doNotText: false },
  ]);
  expect(eligible).toHaveLength(1);
  expect(skipped).toHaveLength(0);
});
```

Note: existing `bulk.test.ts` cases that construct `TextableCase` objects must add `doNotText: false` (the field is now required). Update any such existing constructions in the same edit.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd nudgepay-app && npx vitest run tests/bulk.test.ts`
Expected: FAIL — `"do-not-text"` not produced / type error on `doNotText`.

- [ ] **Step 3: Update `bulk.ts`**

In `nudgepay-app/app/lib/bulk.ts`:

Change the `SkipReason` union (line ~9):
```ts
export type SkipReason = "no-phone" | "no-consent" | "do-not-contact" | "do-not-text";
```

Add `doNotText` to `TextableCase` (the type at line ~11):
```ts
export type TextableCase = {
  caseId: string;
  customerName: string;
  phone: string | null;
  smsConsent: boolean;
  doNotText: boolean;
  contactBlocked?: boolean;
};
```

Add the `do-not-text` branch in `partitionEligibility` (after the `no-consent` branch):
```ts
export function partitionEligibility<T extends TextableCase>(cases: T[]): EligibilitySplit<T> {
  const eligible: T[] = [];
  const skipped: { caseId: string; name: string; reason: SkipReason }[] = [];
  for (const c of cases) {
    if (c.contactBlocked) skipped.push({ caseId: c.caseId, name: c.customerName, reason: "do-not-contact" });
    else if (!c.phone) skipped.push({ caseId: c.caseId, name: c.customerName, reason: "no-phone" });
    else if (!c.smsConsent) skipped.push({ caseId: c.caseId, name: c.customerName, reason: "no-consent" });
    else if (c.doNotText) skipped.push({ caseId: c.caseId, name: c.customerName, reason: "do-not-text" });
    else eligible.push(c);
  }
  return { eligible, skipped };
}
```

- [ ] **Step 4: Update `bulk-send.server.ts`**

In `nudgepay-app/app/lib/bulk-send.server.ts`:

Extend `CustomerRow` (line ~9):
```ts
type CustomerRow = { id: string; name: string | null; phone: string | null; sms_consent: boolean | null; do_not_text: boolean | null };
```

Add `do_not_text` to the customers select (line ~30-31):
```ts
  const { data: custRows, error: custErr } = await svc.from("customers")
    .select("id, name, phone, sms_consent, do_not_text").eq("org_id", args.orgId).in("id", customerIds);
```

Set `doNotText` when building each case (the `built.push({...})` block, line ~54):
```ts
    built.push({
      caseId: c.id,
      customerName: cust.name ?? "(unknown customer)",
      phone: cust.phone ?? null,
      smsConsent: Boolean(cust.sms_consent),
      doNotText: Boolean(cust.do_not_text),
      contactBlocked: isContactBlocked(c.exception_reason),
      totalOverdue,
      invoices: invs.map((i) => ({ invoiceId: i.id, docNumber: i.doc, dueDate: i.due })),
      representativeInvoiceId: invs[0]?.id ?? null,
    });
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd nudgepay-app && npx vitest run tests/bulk.test.ts tests/bulk-send.test.ts`
Expected: PASS. If `bulk-send.test.ts` constructs customers without `do_not_text`, that column is simply read as null → `doNotText: false` (no test change needed unless it asserts on it).

- [ ] **Step 6: Typecheck**

Run: `cd nudgepay-app && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add nudgepay-app/app/lib/bulk.ts nudgepay-app/app/lib/bulk-send.server.ts nudgepay-app/tests/bulk.test.ts
git commit -m "feat(bulk): skip do-not-text customers in batch SMS (C6)"
```

---

### Task 4: Single-send enforcement — block `do_not_text`

**Files:**
- Modify: `nudgepay-app/app/lib/twilio-messaging.server.ts` (`sendInvoiceText`, ~lines 65-69)
- Modify: `nudgepay-app/app/routes/api.text.send.tsx` (reason mapping, ~line 44)
- Test: `nudgepay-app/tests/twilio-send.test.ts` (extend)

**Interfaces:**
- Consumes: `sendInvoiceText(deps, { orgId, invoiceId, userId, body })` throwing on ineligibility.
- Produces: `sendInvoiceText` throws `"Customer has opted out of SMS"` when `do_not_text`; `api.text.send` maps that to `reason="optout"`.

- [ ] **Step 1: Write the failing test**

Append to `nudgepay-app/tests/twilio-send.test.ts`:

```ts
test("sendInvoiceText refuses a do_not_text customer (no Twilio call, no row)", async () => {
  const { orgId, customerId, invoiceId } = await seed(true, "+12295550144");
  await svc.from("customers").update({ do_not_text: true }).eq("id", customerId);
  const fetchFn = vi.fn();
  await expect(sendInvoiceText(deps(fetchFn), { orgId, invoiceId, userId, body: "x" }))
    .rejects.toThrow(/opted out/i);
  expect(fetchFn).not.toHaveBeenCalled();
  const { data: rows } = await svc.from("text_messages").select("id").eq("customer_id", customerId);
  expect(rows ?? []).toHaveLength(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd nudgepay-app && npx vitest run tests/twilio-send.test.ts`
Expected: FAIL — the send proceeds (fetch called) instead of throwing `/opted out/i`.

- [ ] **Step 3: Enforce in `sendInvoiceText`**

In `nudgepay-app/app/lib/twilio-messaging.server.ts`, change the customer select (line ~65-66) to include `do_not_text`, and add the opt-out guard right after the consent guard (line ~69):

```ts
  const { data: cust, error: custErr } = await deps.service.from("customers")
    .select("id, phone, sms_consent, do_not_text").eq("id", inv.customer_id as string).maybeSingle();
  if (custErr) throw custErr;
  if (!cust?.phone) throw new Error("Customer has no phone number");
  if (!cust.sms_consent) throw new Error("Customer has not consented to SMS");
  if (cust.do_not_text) throw new Error("Customer has opted out of SMS");
```

- [ ] **Step 4: Map the reason in `api.text.send.tsx`**

In `nudgepay-app/app/routes/api.text.send.tsx`, update the reason mapping (line ~44). The opt-out message must be matched BEFORE the `/consent/i` check (it contains neither "consent" nor "blocked", but order it explicitly for clarity):

```ts
    const msg = err instanceof Error ? err.message : "";
    const reason = /blocked/i.test(msg) ? "blocked"
      : /opted out/i.test(msg) ? "optout"
      : /consent/i.test(msg) ? "noconsent"
      : "error";
    return redirect(withSms(returnTo, reason), { headers });
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd nudgepay-app && npx vitest run tests/twilio-send.test.ts tests/api-text-send.test.ts`
Expected: PASS. (The `optout` banner string is added with the rest of the UI in Task 7; until then an `sms=optout` redirect simply renders no banner, which is harmless.)

- [ ] **Step 6: Typecheck**

Run: `cd nudgepay-app && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add nudgepay-app/app/lib/twilio-messaging.server.ts nudgepay-app/app/routes/api.text.send.tsx nudgepay-app/tests/twilio-send.test.ts
git commit -m "feat(sms): block single send for do-not-text customers (C6)"
```

---

### Task 5: Write route `api.comm-prefs.tsx` + register + test

**Files:**
- Create: `nudgepay-app/app/routes/api.comm-prefs.tsx`
- Modify: `nudgepay-app/app/routes.ts` (register the route)
- Test: `nudgepay-app/tests/api-comm-prefs.test.ts`

**Interfaces:**
- Consumes: `requireUser`/`resolveOrg` (`session.server`), `safeReturnTo` (`return-to`), `CHANNELS` (`comm-prefs`).
- Produces: a POST action at `/api/comm-prefs` that updates `preferred_channel` + the three opt-outs for the customer behind `invoiceId`, RLS-scoped, redirecting to `returnTo`. Never touches `sms_consent`.

**Pattern reference:** mirror `nudgepay-app/app/routes/api.sms-consent.tsx` exactly (USER client via `requireUser`; resolve `customer_id` from an org-readable invoice; a foreign `invoiceId` resolves to nothing and updates nothing).

- [ ] **Step 1: Write the failing test**

Create `nudgepay-app/tests/api-comm-prefs.test.ts` (mirror `tests/api-sms-consent.test.ts` structure — load it first to match the exact `action` invocation / form-data helper used in this repo):

```ts
import { beforeAll, expect, test } from "vitest";
import { serviceClient, makeUserClient } from "./helpers";
import { action } from "../app/routes/api.comm-prefs";

const svc = serviceClient();
let userId: string;
let accessToken: string;

beforeAll(async () => {
  ({ userId, accessToken } = await makeUserClient("comm-prefs@example.com"));
});

// Seed an org the user is an owner of, with one customer + invoice.
async function seedOrg() {
  const { data: org } = await svc.from("organizations").insert({ name: "C6 prefs org" }).select("id").single();
  const orgId = org!.id as string;
  await svc.from("memberships").insert({ org_id: orgId, user_id: userId, role: "owner" });
  const { data: cust } = await svc.from("customers")
    .insert({ org_id: orgId, name: "Acme", sms_consent: true }).select("id").single();
  const { data: inv } = await svc.from("invoices")
    .insert({ org_id: orgId, qbo_id: "i1", customer_id: cust!.id, balance: 100 }).select("id").single();
  return { orgId, customerId: cust!.id as string, invoiceId: inv!.id as string };
}

function req(body: Record<string, string>) {
  const form = new URLSearchParams(body);
  return new Request("http://localhost/api/comm-prefs", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: `sb-access-token=${accessToken}`, // match the cookie scheme tests/helpers uses
    },
    body: form.toString(),
  });
}

test("updates preferred_channel + opt-outs for an in-org customer", async () => {
  const { invoiceId, customerId } = await seedOrg();
  await action({ request: req({
    invoiceId, returnTo: "/dashboard", preferred_channel: "email",
    do_not_call: "true", do_not_email: "false", do_not_text: "true",
  }), context: {}, params: {} } as any);
  const { data } = await svc.from("customers")
    .select("preferred_channel, do_not_call, do_not_email, do_not_text, sms_consent")
    .eq("id", customerId).single();
  expect(data!.preferred_channel).toBe("email");
  expect(data!.do_not_call).toBe(true);
  expect(data!.do_not_email).toBe(false);
  expect(data!.do_not_text).toBe(true);
  expect(data!.sms_consent).toBe(true); // NEVER modified by a prefs write
});

test("a foreign invoiceId updates nothing (RLS)", async () => {
  // Customer in an org the user is NOT a member of.
  const { data: org2 } = await svc.from("organizations").insert({ name: "Other org" }).select("id").single();
  const { data: cust2 } = await svc.from("customers")
    .insert({ org_id: org2!.id, name: "Foreign" }).select("id").single();
  const { data: inv2 } = await svc.from("invoices")
    .insert({ org_id: org2!.id, qbo_id: "ix", customer_id: cust2!.id, balance: 50 }).select("id").single();
  await action({ request: req({
    invoiceId: inv2!.id as string, returnTo: "/dashboard", preferred_channel: "call", do_not_call: "true",
  }), context: {}, params: {} } as any);
  const { data } = await svc.from("customers").select("preferred_channel, do_not_call").eq("id", cust2!.id).single();
  expect(data!.preferred_channel).toBe(null);
  expect(data!.do_not_call).toBe(false);
});

test("empty preferred_channel clears to NULL (no preference)", async () => {
  const { invoiceId, customerId } = await seedOrg();
  await svc.from("customers").update({ preferred_channel: "text" }).eq("id", customerId);
  await action({ request: req({ invoiceId, returnTo: "/dashboard", preferred_channel: "" }), context: {}, params: {} } as any);
  const { data } = await svc.from("customers").select("preferred_channel").eq("id", customerId).single();
  expect(data!.preferred_channel).toBe(null);
});
```

Note: the exact `Request` construction (cookie name, how `requireUser` reads the session) must match `tests/api-sms-consent.test.ts`. Read that file first and copy its request/auth helper verbatim rather than guessing the cookie scheme. If that test calls a shared helper to build an authenticated request, use the same helper here.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd nudgepay-app && npx vitest run tests/api-comm-prefs.test.ts`
Expected: FAIL — cannot resolve `../app/routes/api.comm-prefs`.

- [ ] **Step 3: Write the action**

Create `nudgepay-app/app/routes/api.comm-prefs.tsx`:

```ts
import { redirect, type ActionFunctionArgs } from "react-router";
import { getEnv } from "../lib/env.server";
import { requireUser, resolveOrg } from "../lib/session.server";
import { safeReturnTo } from "../lib/return-to";
import { CHANNELS, type Channel } from "../lib/comm-prefs";

function parseChannel(v: FormDataEntryValue | null): Channel | null {
  const s = typeof v === "string" ? v : "";
  return (CHANNELS as readonly string[]).includes(s) ? (s as Channel) : null;
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
  if (!invoiceId) return redirect(returnTo, { headers });

  // RLS-scoped: a member can only read invoices in their org, so a foreign
  // invoiceId resolves to nothing and updates nothing. Identical to api.sms-consent.
  const { data: inv } = await supabase
    .from("invoices").select("customer_id").eq("id", invoiceId).maybeSingle();
  if (!inv?.customer_id) return redirect(returnTo, { headers });

  const { error } = await supabase.from("customers").update({
    preferred_channel: parseChannel(form.get("preferred_channel")), // empty/unknown -> NULL
    do_not_call: form.get("do_not_call") === "true",
    do_not_email: form.get("do_not_email") === "true",
    do_not_text: form.get("do_not_text") === "true",
    // sms_consent intentionally NOT set here — it is the legal record, governed by STOP/START.
  }).eq("id", inv.customer_id as string);
  if (error) return redirect(returnTo, { headers });

  return redirect(returnTo, { headers });
}

export function loader() {
  return redirect("/dashboard");
}
```

- [ ] **Step 4: Register the route**

In `nudgepay-app/app/routes.ts`, add next to the existing `api/sms-consent` registration:

```ts
  route("api/comm-prefs", "routes/api.comm-prefs.tsx"),
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd nudgepay-app && npx vitest run tests/api-comm-prefs.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Typecheck + build**

Run: `cd nudgepay-app && npx tsc --noEmit && npx react-router build`
Expected: tsc exit 0; build clean (the new route chunk emits).

- [ ] **Step 7: Commit**

```bash
git add nudgepay-app/app/routes/api.comm-prefs.tsx nudgepay-app/app/routes.ts nudgepay-app/tests/api-comm-prefs.test.ts
git commit -m "feat(comm-prefs): RLS-scoped write route for customer preferences (C6)"
```

---

### Task 6: Thread prefs through loader → CaseItem

**Files:**
- Modify: `nudgepay-app/app/lib/worklist.ts` (`CustomerInput`, ~line 40)
- Modify: `nudgepay-app/app/lib/cases.ts` (`CaseItem` + `buildCaseItems`, ~lines 55-215)
- Modify: `nudgepay-app/app/routes/dashboard.tsx` (customer embed type ~line 94; invoice select ~line 282; `customerMap` build ~line 302; selected-customer read ~line 478; loader return ~line 491)

**Interfaces:**
- Consumes: `resolveCommPrefs`, `CommPrefs`, `DEFAULT_COMM_PREFS` from `comm-prefs.ts`.
- Produces: `CustomerInput.commPrefs?: CommPrefs`; `CaseItem.commPrefs: CommPrefs`; loader returns `selectedPrefs: CommPrefs`.

This is integration wiring verified by `tsc` + `build` + the existing suite (loaders are not unit-tested in this repo, consistent with the dashboard). `resolveCommPrefs` is the single mapping point — call it at the loader boundary; downstream stays typed `CommPrefs`.

- [ ] **Step 1: Extend `CustomerInput` in `worklist.ts`**

Add the import at the top of `nudgepay-app/app/lib/worklist.ts` (type-only) and a field on `CustomerInput` (line ~40):

```ts
import type { CommPrefs } from "./comm-prefs";
```
```ts
export type CustomerInput = { id: string; name: string; phone: string | null; email: string | null; owner?: string | null; smsConsent?: boolean | null; commPrefs?: CommPrefs };
```

- [ ] **Step 2: Extend `CaseItem` + populate it in `cases.ts`**

In `nudgepay-app/app/lib/cases.ts`, add a type-only import and a `commPrefs` field on `CaseItem`, then populate it in the `buildCaseItems` return.

Add near the existing imports:
```ts
import { DEFAULT_COMM_PREFS, type CommPrefs } from "./comm-prefs";
```

Add to the `CaseItem` type (next to `smsConsent`, line ~76):
```ts
  commPrefs: CommPrefs;
```

Populate it in the returned object (next to `smsConsent: cust?.smsConsent ?? false,`, line ~208):
```ts
      commPrefs: cust?.commPrefs ?? DEFAULT_COMM_PREFS,
```

- [ ] **Step 3: Wire the dashboard loader**

In `nudgepay-app/app/routes/dashboard.tsx`:

(a) Add `resolveCommPrefs` to the imports from the cases/comm-prefs layer:
```ts
import { resolveCommPrefs } from "../lib/comm-prefs";
```

(b) Extend the embedded `customers` shape on `InvoiceRow` (line ~94) to include the four columns:
```ts
  customers: { name: string | null; phone: string | null; email: string | null; owner: string | null; sms_consent: boolean | null; preferred_channel: string | null; do_not_call: boolean | null; do_not_email: boolean | null; do_not_text: boolean | null } | null;
```

(c) Add the columns to the invoice select (line ~282):
```ts
      .select("id, qbo_doc_number, balance, due_date, customer_id, customers(name, phone, email, owner, sms_consent, preferred_channel, do_not_call, do_not_email, do_not_text)")
```

(d) Populate `commPrefs` when building `customerMap` (line ~302), using the single resolver on the snake_case embed:
```ts
        customerMap.set(r.customer_id, {
          id: r.customer_id,
          name: r.customers.name ?? "(unknown customer)",
          phone: r.customers.phone ?? null,
          email: r.customers.email ?? null,
          owner: r.customers.owner ?? null,
          smsConsent: r.customers.sms_consent ?? false,
          commPrefs: resolveCommPrefs(r.customers),
        });
```

(e) Extend the selected-customer read (line ~478) and derive `selectedPrefs`:
```ts
      const { data: custRow } = await supabase
        .from("customers").select("phone, sms_consent, preferred_channel, do_not_call, do_not_email, do_not_text").eq("id", customerId).maybeSingle();
      selectedConsent = (custRow as any)?.sms_consent ?? false;
      selectedPhone = (custRow as any)?.phone ?? null;
      selectedPrefs = resolveCommPrefs(custRow as any);
      selectedRepInvoiceId = repInvoiceId;
```

Declare `selectedPrefs` next to the other `selected*` locals (near `selectedConsent`), initialized to the default:
```ts
  let selectedPrefs: CommPrefs = DEFAULT_COMM_PREFS;
```
…and add the type import at the top:
```ts
import { resolveCommPrefs, DEFAULT_COMM_PREFS, type CommPrefs } from "../lib/comm-prefs";
```
(Combine with (a) — single import line.)

(f) Add `selectedPrefs` to the loader's returned `data({...})` object (line ~491 block, next to `selectedConsent`):
```ts
      selectedPrefs,
```

- [ ] **Step 4: Typecheck + build**

Run: `cd nudgepay-app && npx tsc --noEmit && npx react-router build`
Expected: tsc exit 0; build clean.

- [ ] **Step 5: Run the full suite (no regressions)**

Run: `cd nudgepay-app && npx vitest run`
Expected: all green (existing count + the new tests from Tasks 1-5).

- [ ] **Step 6: Commit**

```bash
git add nudgepay-app/app/lib/worklist.ts nudgepay-app/app/lib/cases.ts nudgepay-app/app/routes/dashboard.tsx
git commit -m "feat(cases): carry comm preferences on CaseItem + loader (C6)"
```

---

### Task 7: Capture panel + badges (UI)

**Files:**
- Create: `nudgepay-app/app/components/CommPrefsDrawer.tsx`
- Modify: `nudgepay-app/app/components/DetailPanel.tsx` (trigger link in the consent row ~line 111; `optout` banner ~line 51; send-button disable + hint ~line 215-221; accept a `prefs` prop)
- Modify: `nudgepay-app/app/components/WorkQueue.tsx` (badges on the case row ~line 235)
- Modify: `nudgepay-app/app/routes/dashboard.tsx` (read `?prefs=1`; pass `selectedPrefs` to `DetailPanel`; mount `CommPrefsDrawer`)

**Interfaces:**
- Consumes: `CommPrefs`, `Channel`, `channelBlocked`, `canSendSms` from `comm-prefs.ts`; the loader's `selectedPrefs`; `item.commPrefs` on each `CaseItem`.
- Produces: a slide-over that POSTs to `/api/comm-prefs`; preference badges on the queue row; SMS send disabled when `!canSendSms`.

This task is JSX-structural and verified by `tsc` + `build` + the full suite. Match the existing slide-over chrome (`LogContactDrawer`) and badge styling already in `WorkQueue`.

- [ ] **Step 1: Create the `CommPrefsDrawer` component**

Create `nudgepay-app/app/components/CommPrefsDrawer.tsx`. Read `nudgepay-app/app/components/LogContactDrawer.tsx` first and reuse its slide-over wrapper/overlay/close-link chrome and class tokens; the body below is the C6-specific content:

```tsx
import { Link } from "react-router";
import type { CommPrefs, Channel } from "~/lib/comm-prefs";

const CHANNEL_OPTIONS: { value: "" | Channel; label: string }[] = [
  { value: "", label: "No preference" },
  { value: "call", label: "Call" },
  { value: "text", label: "Text" },
  { value: "email", label: "Email" },
];

export function CommPrefsDrawer({
  customerName, repInvoiceId, prefs, returnTo, closeHref,
}: {
  customerName: string;
  repInvoiceId: string | null;
  prefs: CommPrefs;
  returnTo: string;
  closeHref: string;
}) {
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/40" role="dialog" aria-modal="true" aria-label="Communication preferences">
      {/* Overlay click closes (Link to the case without ?prefs) */}
      <Link to={closeHref} aria-label="Close" className="absolute inset-0" />
      <div className="relative z-50 flex h-full w-full max-w-md flex-col gap-4 overflow-y-auto border-l border-border bg-surface p-5 shadow-panel">
        <div className="flex items-center justify-between">
          <h2 className="font-sans text-sm font-semibold text-text">Communication preferences</h2>
          <Link to={closeHref} className="text-xs text-muted hover:text-text">Close</Link>
        </div>
        <p className="text-xs text-muted">{customerName}</p>

        <form method="post" action="/api/comm-prefs" className="flex flex-col gap-4">
          <input type="hidden" name="invoiceId" value={repInvoiceId ?? ""} />
          <input type="hidden" name="returnTo" value={returnTo} />

          <label className="flex flex-col gap-1">
            <span className="text-xs font-sans font-medium uppercase tracking-wider text-muted">Preferred channel</span>
            <select name="preferred_channel" defaultValue={prefs.preferredChannel ?? ""}
              className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-text">
              {CHANNEL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-xs font-sans font-medium uppercase tracking-wider text-muted">Do not contact on</legend>
            {/* Checkbox only (value "true"): an unchecked box submits nothing, so the action's
                `form.get("do_not_*") === "true"` correctly resolves to false. Do NOT add a hidden
                "false" sibling — same-named fields make get() ambiguous (returns the first value). */}
            <label className="flex items-center gap-2 text-sm text-text">
              <input type="checkbox" name="do_not_call" value="true" defaultChecked={prefs.doNotCall} className="h-4 w-4 rounded border-border text-copper" />
              Do not call
            </label>
            <label className="flex items-center gap-2 text-sm text-text">
              <input type="checkbox" name="do_not_email" value="true" defaultChecked={prefs.doNotEmail} className="h-4 w-4 rounded border-border text-copper" />
              Do not email
            </label>
            <label className="flex items-center gap-2 text-sm text-text">
              <input type="checkbox" name="do_not_text" value="true" defaultChecked={prefs.doNotText} className="h-4 w-4 rounded border-border text-copper" />
              Do not text <span className="text-[10px] text-muted">(blocks SMS sending)</span>
            </label>
          </fieldset>

          <div className="flex justify-end gap-2">
            <Link to={closeHref} className="rounded-md px-3 py-1.5 text-xs text-muted hover:text-text">Cancel</Link>
            <button type="submit" className="rounded-md bg-copper px-3 py-1.5 text-xs font-sans font-semibold text-surface hover:bg-copper/90">Save preferences</button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add the `optout` SMS banner + trigger + send-disable in `DetailPanel.tsx`**

In `nudgepay-app/app/components/DetailPanel.tsx`:

(a) Add the `optout` entry to `SMS_BANNER` (next to `noconsent`, ~line 52):
```ts
  optout: { text: "Not sent — customer opted out of texts.", tone: "text-hot" },
```

(b) Accept a `prefs: CommPrefs` prop on the component (add to its props type and destructuring; thread it from the parent in Step 4). Import the helper:
```ts
import { canSendSms, type CommPrefs } from "~/lib/comm-prefs";
```

(c) Add a "Communication preferences" trigger in the consent row (~line 111-128), as a Link that opens the panel (the parent reads `?prefs=1`):
```tsx
        <Link
          to={prefsHref}
          className="text-xs font-medium text-copper hover:underline"
        >
          Communication preferences
        </Link>
```
where `prefsHref` is built next to the component's other hrefs:
```ts
  const prefsHref = `?${new URLSearchParams({ case: selected.caseId, tab, view, sort, ...(q ? { q } : {}), prefs: "1" }).toString()}`;
```
(Match the exact param set the component already uses for its other Links — read the surrounding code and reuse its `params` builder if one exists.)

(d) Gate the send button on `do_not_text` too. Compute eligibility and add the disable + hint. Where the button is built (~line 215-221), replace the `!consent` hint branch chain and the `disabled` expression:
```tsx
            ) : !consent ? (
              <span className="text-xs text-muted">Mark consent to enable sending.</span>
            ) : prefs.doNotText ? (
              <span className="text-xs text-hot">Customer opted out of texts.</span>
            ) : null}
            <button
              ...
              disabled={!consent || noInvoice || contactBlocked || prefs.doNotText}
```
Equivalently `disabled={!canSendSms(prefs, consent) || noInvoice || contactBlocked}` — use `canSendSms` to keep one source of truth.

- [ ] **Step 3: Wire `dashboard.tsx`**

In `nudgepay-app/app/routes/dashboard.tsx`:

(a) Read the panel flag from search params (near the other `sp.get(...)` reads, ~line 230):
```ts
  const prefsOpen = sp.get("prefs") === "1";
```

(b) Pass `prefs={selectedPrefs}` to `DetailPanel` (line ~654 block):
```tsx
                <DetailPanel
                  ...
                  consent={selectedConsent}
                  prefs={selectedPrefs}
                  ...
                />
```

(c) Mount `CommPrefsDrawer` when `prefsOpen && selected` (alongside the `LogContactDrawer` mount, ~line 675), importing it at the top:
```tsx
import { CommPrefsDrawer } from "../components/CommPrefsDrawer";
```
```tsx
          {prefsOpen && selected ? (
            <CommPrefsDrawer
              key={selected.caseId}
              customerName={selected.customerName}
              repInvoiceId={repInvoiceId ?? null}
              prefs={selectedPrefs}
              returnTo={`/dashboard?${new URLSearchParams({ case: selected.caseId, tab, view, sort, ...(q ? { q } : {}) }).toString()}`}
              closeHref={`?${new URLSearchParams({ case: selected.caseId, tab, view, sort, ...(q ? { q } : {}) }).toString()}`}
            />
          ) : null}
```
Ensure `selectedPrefs` is destructured from the loader data with the other fields.

- [ ] **Step 4: Add preference badges on the queue row in `WorkQueue.tsx`**

In `nudgepay-app/app/components/WorkQueue.tsx`, add a compact badge cluster. Define a small helper near the row component:

```tsx
const PREF_CHANNEL_LABEL: Record<string, string> = { call: "Prefers call", text: "Prefers text", email: "Prefers email" };

function CommPrefBadges({ prefs }: { prefs: { preferredChannel: string | null; doNotCall: boolean; doNotEmail: boolean; doNotText: boolean } }) {
  const badges: { key: string; label: string; cls: string }[] = [];
  if (prefs.preferredChannel && PREF_CHANNEL_LABEL[prefs.preferredChannel]) {
    badges.push({ key: "pref", label: PREF_CHANNEL_LABEL[prefs.preferredChannel], cls: "bg-cool/15 text-cool" });
  }
  if (prefs.doNotText) badges.push({ key: "nt", label: "No text", cls: "bg-hot/15 text-hot" });   // enforced
  if (prefs.doNotCall) badges.push({ key: "nc", label: "No call", cls: "bg-amber-500/15 text-amber-200" }); // advisory
  if (prefs.doNotEmail) badges.push({ key: "ne", label: "No email", cls: "bg-amber-500/15 text-amber-200" }); // advisory
  if (badges.length === 0) return null;
  return (
    <span className="flex flex-wrap items-center gap-1">
      {badges.map((b) => (
        <span key={b.key} className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-sans font-semibold ${b.cls}`}>{b.label}</span>
      ))}
    </span>
  );
}
```

Render it on the customer-name line (inside the `min-w-0` div, after the invoice-count/level line, ~line 241):
```tsx
              <CommPrefBadges prefs={item.commPrefs} />
```

- [ ] **Step 5: Typecheck + build**

Run: `cd nudgepay-app && npx tsc --noEmit && npx react-router build`
Expected: tsc exit 0; build clean.

- [ ] **Step 6: Run the full suite**

Run: `cd nudgepay-app && npx vitest run`
Expected: all green (no regressions; UI is not snapshot-tested).

- [ ] **Step 7: Commit**

```bash
git add nudgepay-app/app/components/CommPrefsDrawer.tsx nudgepay-app/app/components/DetailPanel.tsx nudgepay-app/app/components/WorkQueue.tsx nudgepay-app/app/routes/dashboard.tsx
git commit -m "feat(comm-prefs): capture panel + queue badges + SMS gating (C6)"
```

---

### Task 8: Verification sweep + mark C6 complete

**Files:**
- Modify: `docs/superpowers/2026-06-23-nudgepay-requirements-gap-checklist.md` (mark C6 `[x]`)

- [ ] **Step 1: Full verification**

Run: `cd nudgepay-app && npx vitest run && npx tsc --noEmit && npx react-router build`
Expected: all tests green; tsc exit 0; build clean. Record the test count.

- [ ] **Step 2: Mark C6 complete in the checklist**

In `docs/superpowers/2026-06-23-nudgepay-requirements-gap-checklist.md`, change the C6 line from `- [ ]` to `- [x]` and append a one-line summary of what shipped (columns on `customers`; `comm-prefs.ts`; `do_not_text` enforcement in bulk + single send; `api.comm-prefs`; capture panel + badges; `sms_consent` left as the untouched legal record).

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/2026-06-23-nudgepay-requirements-gap-checklist.md
git commit -m "docs: mark C6 complete in gap checklist (Phase 8)"
```

---

## Notes for the executor

- **Out of scope (do NOT build):** enforcing `do_not_call`/`do_not_email` (no outbound path until C3 — advisory badges only); STOP auto-setting `do_not_text`; preferred-channel auto-reordering the queue or auto-selecting the drawer method; ranked preferences; bulk preference editing; mail/in-person channels.
- **Never** modify `sms_consent` from the preferences write path. STOP/START remains its sole mutator.
- **Migration application** (Task 2 Step 2) is the one non-obvious environment step: the test harness truncates but does not migrate. If Task 2's schema test fails on missing columns, the migration was not applied to the local DB.
- The two-same-named-field form trick is explicitly rejected in Task 7 — use checkboxes alone (unchecked → absent → `false` in the action).
