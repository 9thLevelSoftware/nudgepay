# NudgePay C3 — Channel Rationalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make NudgePay a call + text collections tool: purge email entirely as a channel (no backend exists for it) and make click-to-call a first-class, `do_not_call`-enforced, auto-captured channel.

**Architecture:** Two parts on two branches. **Part A** amends the unmerged C6 PR (`phase8-c6-comm-preferences`) so email never ships — atomic removal, no half-removed intermediate. **Part B** (`phase8-c3-email-click-to-call`, rebased onto amended C6) removes email's remaining action surfaces and adds click-to-call enforcement + capture. Real test coverage lives on pure modules (`comm-prefs.ts`, `contact-log.ts`, a new `channel-actions.ts`); UI is verified by `tsc` + `react-router build`, matching the repo's node-only test harness (no testing-library/jsdom).

**Tech Stack:** React Router 7 (framework mode, loaders/actions), Supabase/Postgres + RLS, Vitest (node env), Tailwind v4, local Supabase via Docker.

## Global Constraints

- **Pure modules** (`comm-prefs.ts`, `contact-log.ts`, `channel-actions.ts`): no I/O, no `node:*`, no `.server` suffix — imported by routes, components, and tests.
- **Email is removed, never stubbed.** No transactional-email provider, no `email_messages` table, no composer.
- **Backwards-compat:** historical `contact_logs` with `method='email'` must still render — keep the `email` entry in DetailPanel `METHOD_ICON` (line ~39) and dashboard `methodLabel` (line ~351). Only the *input* method list (`CONTACT_METHODS`) loses email.
- **Email address stays visible** as passive reference (Overview InfoRow, `cases.ts` `email` field) — only channel *affordances* are removed.
- `sms_consent` is the legal record; never touched by this work. `canSendSms = sms_consent && !doNotText` unchanged.
- Tests run from `nudgepay-app/` with `npx vitest run` (NOT `npm test`). DB tests use `serviceClient()`/`makeUserClient()` from `./helpers`; local Supabase must be up (Docker).
- Editing the already-applied migration `0017` requires `npx supabase db reset` locally before DB tests see the change.
- Gates per task: `npx vitest run` green · `npx tsc --noEmit` exit 0 · `npx react-router build` clean.
- Conventional Commits. Commit trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` + `Claude-Session: https://claude.ai/code/session_01FRXXDxVnamDk58w8A7m3Qn`. Commit ONLY named source files (never `.superpowers/` scratch, never `git add -A`).

---

## PART A — Amend C6 (branch: `phase8-c6-comm-preferences`)

> **Controller note:** Before dispatching Task 1, `git checkout phase8-c6-comm-preferences`. Tasks 1–2 commit on this branch. After Task 2 review is clean, the controller force-pushes (updates PR #11), then rebases `phase8-c3-email-click-to-call` onto it before Part B.

### Task 1: Remove email from the preferences UI consumers

Drop every email read in the UI/loader layer **while `comm-prefs.ts` still defines `doNotEmail`** (harmlessly unused after this task), so the build stays green. Task 2 then removes the field itself.

**Files:**
- Modify: `app/components/CommPrefsDrawer.tsx` (CHANNEL_OPTIONS line 4–9; do_not_email checkbox line 52–55)
- Modify: `app/components/WorkQueue.tsx` (CommPrefBadges param type line 35; "No email" badge line 42; PREF_CHANNEL_LABEL line 33)
- Modify: `app/routes/dashboard.tsx` (InvoiceRow `customers` type line 96; queue SELECT line 286; selected-customer SELECT line 484)

**Interfaces:**
- Consumes: `CommPrefs` (still has `doNotEmail` until Task 2), `item.commPrefs` on queue rows.
- Produces: nothing new; a UI with no email surfaces.

- [ ] **Step 1: Remove the Email option from the preferred-channel select**

In `app/components/CommPrefsDrawer.tsx`, change CHANNEL_OPTIONS (lines 4–9) to:

```tsx
const CHANNEL_OPTIONS: { value: "" | Channel; label: string }[] = [
  { value: "", label: "No preference" },
  { value: "call", label: "Call" },
  { value: "text", label: "Text" },
];
```

- [ ] **Step 2: Remove the "Do not email" checkbox**

In the same file, delete this block (lines 52–55):

```tsx
            <label className="flex items-center gap-2 text-sm text-text">
              <input type="checkbox" name="do_not_email" value="true" defaultChecked={prefs.doNotEmail} className="h-4 w-4 rounded border-border text-copper" />
              Do not email
            </label>
```

- [ ] **Step 3: Remove the "No email" badge and its inline type field**

In `app/components/WorkQueue.tsx`:

Change the `PREF_CHANNEL_LABEL` (line 33) to drop email:

```tsx
const PREF_CHANNEL_LABEL: Record<string, string> = { call: "Prefers call", text: "Prefers text" };
```

Change the `CommPrefBadges` signature (line 35) to drop `doNotEmail`:

```tsx
function CommPrefBadges({ prefs }: { prefs: { preferredChannel: string | null; doNotCall: boolean; doNotText: boolean } }) {
```

Delete the "No email" badge line (line 42):

```tsx
  if (prefs.doNotEmail) badges.push({ key: "ne", label: "No email", cls: "bg-amber-500/15 text-amber-200" }); // advisory
```

- [ ] **Step 4: Drop do_not_email from the dashboard type and both SELECTs**

In `app/routes/dashboard.tsx`:

Line 96 — InvoiceRow `customers` type, remove `do_not_email`:

```tsx
  customers: { name: string | null; phone: string | null; email: string | null; owner: string | null; sms_consent: boolean | null; preferred_channel: string | null; do_not_call: boolean | null; do_not_text: boolean | null } | null;
```

Line 286 — queue SELECT, drop `do_not_email`:

```tsx
      .select("id, qbo_doc_number, balance, due_date, customer_id, customers(name, phone, email, owner, sms_consent, preferred_channel, do_not_call, do_not_text)")
```

Line 484 — selected-customer SELECT, drop `do_not_email`:

```tsx
        .from("customers").select("phone, sms_consent, preferred_channel, do_not_call, do_not_text").eq("id", customerId).maybeSingle();
```

- [ ] **Step 5: Verify gates**

Run: `npx tsc --noEmit` → Expected: exit 0 (note: `comm-prefs.ts` still exports `doNotEmail`; that's fine, it's just unused now).
Run: `npx react-router build` → Expected: clean.
Run: `npx vitest run` → Expected: full suite green (no test asserts the removed badge/option).

- [ ] **Step 6: Commit**

```bash
git add app/components/CommPrefsDrawer.tsx app/components/WorkQueue.tsx app/routes/dashboard.tsx
git commit -m "refactor(comm-prefs): remove email from preference UI surfaces"
```

---

### Task 2: Remove email from the preferences core (types, route, migration, tests)

Now delete the `doNotEmail`/`do_not_email`/`email`-channel definitions and narrow the DB.

**Files:**
- Modify: `app/lib/comm-prefs.ts` (CHANNELS line 7; CommPrefs line 10–15; DEFAULT line 17–22; CommPrefsRow line 24–29; isChannel line 31–33; resolveCommPrefs line 37–45; channelBlocked line 53–59)
- Modify: `app/routes/api.comm-prefs.tsx` (return type line 10–15; body line 18–23)
- Modify: `supabase/migrations/0017_comm_preferences.sql`
- Test: `tests/comm-prefs.test.ts`, `tests/comm-prefs-schema.test.ts`, `tests/api-comm-prefs.test.ts`

**Interfaces:**
- Produces: `CHANNELS = ["call","text"]`; `Channel = "call"|"text"`; `CommPrefs = { preferredChannel: Channel|null; doNotCall: boolean; doNotText: boolean }`; `channelBlocked(prefs, "call"|"text")`; `parseCommPrefsUpdate` returns `{ preferred_channel: Channel|null; do_not_call: boolean; do_not_text: boolean }`.
- Consumes: Task 1 already removed all UI reads of `doNotEmail`.

- [ ] **Step 1: Update the pure-logic tests to call/text only (write the failing test first)**

Replace `tests/comm-prefs.test.ts` entirely with:

```ts
import { expect, test } from "vitest";
import {
  resolveCommPrefs, canSendSms, channelBlocked, DEFAULT_COMM_PREFS,
} from "../app/lib/comm-prefs";

test("resolveCommPrefs maps a full snake_case row", () => {
  expect(resolveCommPrefs({
    preferred_channel: "text", do_not_call: true, do_not_text: true,
  })).toEqual({ preferredChannel: "text", doNotCall: true, doNotText: true });
});

test("resolveCommPrefs returns defaults for null/undefined", () => {
  expect(resolveCommPrefs(null)).toEqual(DEFAULT_COMM_PREFS);
  expect(resolveCommPrefs(undefined)).toEqual(DEFAULT_COMM_PREFS);
});

test("resolveCommPrefs coerces nullish booleans to false and unknown/email channel to null", () => {
  expect(resolveCommPrefs({ preferred_channel: "fax", do_not_call: null, do_not_text: undefined }))
    .toEqual({ preferredChannel: null, doNotCall: false, doNotText: false });
  expect(resolveCommPrefs({ preferred_channel: "email" }).preferredChannel).toBe(null); // email no longer a channel
  expect(resolveCommPrefs({ preferred_channel: null })).toEqual(DEFAULT_COMM_PREFS);
});

test("canSendSms requires legal consent AND not opted out of text", () => {
  const base = { preferredChannel: null, doNotCall: false } as const;
  expect(canSendSms({ ...base, doNotText: false }, true)).toBe(true);
  expect(canSendSms({ ...base, doNotText: true }, true)).toBe(false);   // preference opt-out
  expect(canSendSms({ ...base, doNotText: false }, false)).toBe(false); // no legal consent
  expect(canSendSms({ ...base, doNotText: true }, false)).toBe(false);
});

test("channelBlocked reads the matching per-channel flag", () => {
  const prefs = { preferredChannel: null, doNotCall: true, doNotText: false };
  expect(channelBlocked(prefs, "call")).toBe(true);
  expect(channelBlocked(prefs, "text")).toBe(false);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/comm-prefs.test.ts`
Expected: FAIL / tsc-level errors — `DEFAULT_COMM_PREFS` still has `doNotEmail`, `channelBlocked` types still expect `"email"`.

- [ ] **Step 3: Rewrite `app/lib/comm-prefs.ts` to call/text only**

```ts
// Pure module — no I/O, no node:*, no .server suffix. Per-customer communication
// preferences: a single preferred channel plus per-channel opt-outs. Single
// source of truth for SMS eligibility (canSendSms) and badge state
// (channelBlocked). These are PREFERENCES, distinct from the legal sms_consent
// record (TCPA/A2P) which STOP/START governs exclusively. Email is not a NudgePay
// channel — call and text only.

export const CHANNELS = ["call", "text"] as const;
export type Channel = (typeof CHANNELS)[number];

export type CommPrefs = {
  preferredChannel: Channel | null;
  doNotCall: boolean;
  doNotText: boolean;
};

export const DEFAULT_COMM_PREFS: CommPrefs = {
  preferredChannel: null,
  doNotCall: false,
  doNotText: false,
};

export type CommPrefsRow = {
  preferred_channel?: string | null;
  do_not_call?: boolean | null;
  do_not_text?: boolean | null;
};

function isChannel(v: string | null | undefined): v is Channel {
  return v === "call" || v === "text";
}

// Map a (possibly partial/nullable) DB row to CommPrefs. Unknown
// preferred_channel coerces to null; nullish booleans coerce to false.
export function resolveCommPrefs(row: CommPrefsRow | null | undefined): CommPrefs {
  if (!row) return { ...DEFAULT_COMM_PREFS };
  return {
    preferredChannel: isChannel(row.preferred_channel) ? row.preferred_channel : null,
    doNotCall: Boolean(row.do_not_call),
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
  }
}
```

- [ ] **Step 4: Run to verify the pure tests pass**

Run: `npx vitest run tests/comm-prefs.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Update `app/routes/api.comm-prefs.tsx` (drop do_not_email)**

Replace the `parseCommPrefsUpdate` function (lines 10–24) with:

```ts
export function parseCommPrefsUpdate(form: FormData): {
  preferred_channel: Channel | null;
  do_not_call: boolean;
  do_not_text: boolean;
} {
  const raw = form.get("preferred_channel");
  const ch = typeof raw === "string" ? raw : "";
  return {
    preferred_channel: (CHANNELS as readonly string[]).includes(ch) ? (ch as Channel) : null,
    do_not_call: form.get("do_not_call") === "true",
    do_not_text: form.get("do_not_text") === "true",
  };
}
```

(The action body at lines 26–49 is unchanged — it calls `parseCommPrefsUpdate(form)` and updates `customers`.)

- [ ] **Step 6: Update `tests/api-comm-prefs.test.ts` (drop do_not_email, swap email→text/call)**

Replace lines 12–15 (first pure test) with:

```ts
test("parseCommPrefsUpdate maps a valid channel and the checked opt-outs", () => {
  expect(parseCommPrefsUpdate(fd({ preferred_channel: "text", do_not_call: "true", do_not_text: "true" })))
    .toEqual({ preferred_channel: "text", do_not_call: true, do_not_text: true });
});
```

Replace lines 27–32 (the "non-true checkbox" test) with:

```ts
test("a non-true checkbox value resolves to false", () => {
  const u = parseCommPrefsUpdate(fd({ do_not_call: "false" }));
  expect(u.do_not_call).toBe(false);
  expect(u.do_not_text).toBe(false);
});
```

In the RLS test (lines 49–53), change the `email` channel to `call`:

```ts
  await user.client.from("customers")
    .update({ preferred_channel: "call", do_not_call: true, do_not_text: true }).eq("id", cust!.id);
  const { data: after } = await svc.from("customers")
    .select("preferred_channel, do_not_call, do_not_text, sms_consent").eq("id", cust!.id).single();
  expect(after!.preferred_channel).toBe("call");
```

(The "never includes sms_consent" test at lines 23–25 stays as-is.)

- [ ] **Step 7: Edit the migration `0017` (narrow CHECK, drop do_not_email)**

Replace `supabase/migrations/0017_comm_preferences.sql` with:

```sql
-- C6: per-customer communication preferences. A single preferred channel (call
-- or text) plus per-channel opt-outs. These are PREFERENCES, distinct from the
-- legal sms_consent record (TCPA/A2P) which STOP/START continues to govern. RLS
-- is unchanged: the existing customers_all policy already gates read and write by
-- org membership. Email is not a NudgePay channel.
alter table customers
  add column preferred_channel text
    check (preferred_channel in ('call', 'text')),
  add column do_not_call  boolean not null default false,
  add column do_not_text  boolean not null default false;
```

- [ ] **Step 8: Update `tests/comm-prefs-schema.test.ts` (email now rejected, no do_not_email)**

Replace the file entirely with:

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
    .select("preferred_channel, do_not_call, do_not_text").single();
  expect(error).toBeNull();
  expect(data!.preferred_channel).toBe("text");
  expect(data!.do_not_call).toBe(true);
  expect(data!.do_not_text).toBe(false);  // default
});

test("customers accepts a NULL preferred_channel (no preference)", async () => {
  const orgId = await newOrg("C6 schema null");
  const { error } = await svc.from("customers")
    .insert({ org_id: orgId, name: "NoPref", preferred_channel: null });
  expect(error).toBeNull();
});

test("customers rejects an out-of-set preferred_channel (including email)", async () => {
  const orgId = await newOrg("C6 schema bad");
  const fax = await svc.from("customers").insert({ org_id: orgId, name: "BadChan", preferred_channel: "fax" });
  expect(fax.error).not.toBeNull();
  const email = await svc.from("customers").insert({ org_id: orgId, name: "EmailChan", preferred_channel: "email" });
  expect(email.error).not.toBeNull(); // email is no longer a valid channel
});
```

- [ ] **Step 9: Re-apply the edited migration and run the full suite**

Run: `npx supabase db reset` → Expected: migrations re-applied; `customers` now has `do_not_call`/`do_not_text` only, CHECK `in ('call','text')`, no `do_not_email`.
Run: `npx vitest run` → Expected: full suite green.
Run: `npx tsc --noEmit` → Expected: exit 0.
Run: `npx react-router build` → Expected: clean.

- [ ] **Step 10: Commit**

```bash
git add app/lib/comm-prefs.ts app/routes/api.comm-prefs.tsx supabase/migrations/0017_comm_preferences.sql tests/comm-prefs.test.ts tests/comm-prefs-schema.test.ts tests/api-comm-prefs.test.ts
git commit -m "refactor(comm-prefs): drop email channel + do_not_email column"
```

---

> **Controller checkpoint (between Part A and Part B):**
> 1. Confirm Tasks 1–2 reviews are clean.
> 2. `git push --force-with-lease origin phase8-c6-comm-preferences` (updates PR #11).
> 3. `git checkout phase8-c3-email-click-to-call && git rebase phase8-c6-comm-preferences` (resolve the spec/plan-doc commits cleanly; they don't touch the same lines).
> 4. `npx supabase db reset` once on the rebased branch so local DB matches the edited 0017.
> 5. Proceed to Part B on `phase8-c3-email-click-to-call`.

---

## PART B — C3 click-to-call (branch: `phase8-c3-email-click-to-call`)

### Task 3: Remove email as a loggable contact method

**Files:**
- Modify: `app/lib/contact-log.ts` (CONTACT_METHODS line 7)
- Test: `tests/contact-log.test.ts` (add a rejection case)

**Interfaces:**
- Produces: `CONTACT_METHODS = ["call","text","note"]`; `ContactMethod = "call"|"text"|"note"`.
- Backwards-compat: this only narrows the *input* set. Historical reads of `method='email'` are display-only (DetailPanel/dashboard maps), untouched here.

- [ ] **Step 1: Write the failing test**

Append to `tests/contact-log.test.ts`:

```ts
test("parseContactLogForm rejects email as a method (email is not a NudgePay channel)", () => {
  const r = parseContactLogForm(fd({ caseId: "c1", method: "email", outcome: "no-answer", nextStep: "follow_up", followUpAt: "2026-07-01" }));
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error).toBe("bad-method");
});

test("parseContactLogForm still accepts call/text/note", () => {
  for (const method of ["call", "text", "note"]) {
    const r = parseContactLogForm(fd({ caseId: "c1", method, outcome: "other", nextStep: "follow_up", followUpAt: "2026-07-01" }));
    expect(r.ok).toBe(true);
  }
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/contact-log.test.ts`
Expected: FAIL — `method: "email"` currently parses as a valid method (`r.ok === true`).

- [ ] **Step 3: Narrow CONTACT_METHODS**

In `app/lib/contact-log.ts`, change line 7:

```ts
export const CONTACT_METHODS = ["call", "text", "note"] as const;
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/contact-log.test.ts`
Expected: PASS (all, including the two new cases).

- [ ] **Step 5: Commit**

```bash
git add app/lib/contact-log.ts tests/contact-log.test.ts
git commit -m "refactor(contact-log): drop email from loggable methods"
```

---

### Task 4: Pure click-to-call action state — `channel-actions.ts`

A pure resolver so the Call control's three states (hidden / blocked / live) are unit-tested without a render harness.

**Files:**
- Create: `app/lib/channel-actions.ts`
- Test: `tests/channel-actions.test.ts`

**Interfaces:**
- Consumes: `CommPrefs`, `channelBlocked` from `./comm-prefs`.
- Produces: `type CallAction = { kind: "hidden" } | { kind: "blocked"; reason: string } | { kind: "live" }`; `resolveCallAction(prefs: CommPrefs, phone: string | null): CallAction`.

- [ ] **Step 1: Write the failing test**

Create `tests/channel-actions.test.ts`:

```ts
import { expect, test } from "vitest";
import { resolveCallAction } from "../app/lib/channel-actions";
import { DEFAULT_COMM_PREFS } from "../app/lib/comm-prefs";

test("no phone → hidden", () => {
  expect(resolveCallAction(DEFAULT_COMM_PREFS, null)).toEqual({ kind: "hidden" });
  expect(resolveCallAction(DEFAULT_COMM_PREFS, "")).toEqual({ kind: "hidden" });
});

test("phone + do_not_call → blocked with reason", () => {
  const prefs = { ...DEFAULT_COMM_PREFS, doNotCall: true };
  expect(resolveCallAction(prefs, "555-0100")).toEqual({ kind: "blocked", reason: "Customer asked not to be called" });
});

test("phone + not opted out → live", () => {
  expect(resolveCallAction(DEFAULT_COMM_PREFS, "555-0100")).toEqual({ kind: "live" });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/channel-actions.test.ts`
Expected: FAIL — module `../app/lib/channel-actions` does not exist.

- [ ] **Step 3: Implement `app/lib/channel-actions.ts`**

```ts
// Pure module — no I/O, no node:*, no .server suffix. Presentation state for the
// per-customer Call action: hidden (no phone), blocked (do_not_call), or live.
// Keeps the DetailPanel JSX trivial and the gating unit-testable.

import { channelBlocked, type CommPrefs } from "./comm-prefs";

export type CallAction =
  | { kind: "hidden" }
  | { kind: "blocked"; reason: string }
  | { kind: "live" };

export function resolveCallAction(prefs: CommPrefs, phone: string | null): CallAction {
  if (!phone) return { kind: "hidden" };
  if (channelBlocked(prefs, "call")) return { kind: "blocked", reason: "Customer asked not to be called" };
  return { kind: "live" };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/channel-actions.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add app/lib/channel-actions.ts tests/channel-actions.test.ts
git commit -m "feat(channel-actions): pure resolver for Call action state"
```

---

### Task 5: Pre-fill the Log drawer method from a URL param

**Files:**
- Modify: `app/components/LogContactDrawer.tsx` (props + METHOD_LABEL + method `<select>` default)
- Modify: `app/routes/dashboard.tsx` (LogContactDrawer mount line 687–696)

**Interfaces:**
- Consumes: `CONTACT_METHODS` from `../lib/contact-log` (already imported by the drawer).
- Produces: `LogContactDrawer` accepts an optional `method?: string | null` prop; when it matches a valid `CONTACT_METHODS` value it becomes the method `<select>` default (else `"call"`).

- [ ] **Step 1: Add the `method` prop and validated default to LogContactDrawer**

In `app/components/LogContactDrawer.tsx`, update the `METHOD_LABEL` map (lines 10–12) to drop the now-dead `email` entry:

```tsx
const METHOD_LABEL: Record<string, string> = {
  call: "Call", text: "Text", note: "Note",
};
```

Add `method` to the props (signature lines 30–38):

```tsx
export function LogContactDrawer({
  selected, repInvoiceId, returnTo, logError, collision, method,
}: {
  selected: CaseItem;
  repInvoiceId: string | null;
  returnTo: string;
  logError: string | null;
  collision: Collision | null;
  method?: string | null;
}) {
```

Just inside the function body (before `const [outcome, ...]` at line 39), compute the validated default:

```tsx
  const defaultMethod = method && (CONTACT_METHODS as readonly string[]).includes(method) ? method : "call";
```

Change the method `<select>` (line 143) from `defaultValue="call"` to:

```tsx
              defaultValue={defaultMethod}
```

- [ ] **Step 2: Thread the param from the dashboard**

In `app/routes/dashboard.tsx`, update the LogContactDrawer mount (lines 687–696) to pass `method={sp.get("method")}`:

```tsx
          {log && selected ? (
            <LogContactDrawer
              key={selected.caseId}
              selected={selected}
              repInvoiceId={repInvoiceId ?? null}
              returnTo={`/dashboard?${new URLSearchParams({ case: selected.caseId, tab, view, sort, ...(q ? { q } : {}) }).toString()}`}
              logError={logError}
              collision={collisions[selected.caseId] ?? null}
              method={sp.get("method")}
            />
          ) : null}
```

- [ ] **Step 3: Verify gates**

Run: `npx tsc --noEmit` → Expected: exit 0.
Run: `npx react-router build` → Expected: clean.
Run: `npx vitest run` → Expected: full suite green.

- [ ] **Step 4: Commit**

```bash
git add app/components/LogContactDrawer.tsx app/routes/dashboard.tsx
git commit -m "feat(log-drawer): pre-fill method from ?method= param"
```

---

### Task 6: DetailPanel — remove Email button, enforce + capture click-to-call

**Files:**
- Modify: `app/components/DetailPanel.tsx` (imports; action row lines 421–466)

**Interfaces:**
- Consumes: `resolveCallAction` (Task 4); `prefs: CommPrefs` (already a DetailPanel prop); `useNavigate` from react-router.
- Keeps `METHOD_ICON` (line 39) with its `email` entry for historical-log rendering.

- [ ] **Step 1: Add imports**

In `app/components/DetailPanel.tsx`, extend the react-router import (line 2) to include `useNavigate`, and import the resolver:

```tsx
import { Link, useNavigate, useRevalidator } from "react-router";
```

Add after the existing comm-prefs import (line 12):

```tsx
import { resolveCallAction } from "~/lib/channel-actions";
```

- [ ] **Step 2: Compute the call action + capture href inside `DetailPanel`**

In the main `DetailPanel` function, just after `const overviewReturnTo = ...` (line 355), add:

```tsx
  const navigate = useNavigate();
  const callAction = resolveCallAction(prefs, selected.phone);
  const callLogHref = `?${new URLSearchParams({ case: selected.caseId, tab: "activity", view, sort, ...(q ? { q } : {}), log: "1", method: "call" }).toString()}`;
```

- [ ] **Step 3: Replace the Call link and remove the Email button**

Replace the Call block (lines 427–436) with the three-state control. The `tel:` handoff opens the OS dialer without unloading the SPA, so the `onClick` navigation can also open the Log drawer pre-filled `method=call`:

```tsx
          {/* Call — hidden if no phone; disabled-with-reason if do_not_call; else tel: + capture */}
          {callAction.kind === "live" ? (
            <a
              href={`tel:${selected.phone}`}
              onClick={() => navigate(callLogHref)}
              className="inline-flex items-center gap-1.5 text-xs font-sans font-medium text-copper border border-copper/40 rounded-md px-3 h-9 hover:bg-copper/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper transition-colors"
            >
              <Icon name="phone" size={14} aria-hidden />
              Call
            </a>
          ) : callAction.kind === "blocked" ? (
            <span
              aria-disabled="true"
              title={callAction.reason}
              className="inline-flex items-center gap-1.5 text-xs font-sans font-medium text-muted border border-border rounded-md px-3 h-9 opacity-50 cursor-not-allowed"
            >
              <Icon name="phone" size={14} aria-hidden />
              Call
            </span>
          ) : null}
```

Then delete the Email block (lines 447–456):

```tsx
          {/* Email — omit if no email */}
          {selected.email ? (
            <a
              href={`mailto:${selected.email}`}
              className="inline-flex items-center gap-1.5 text-xs font-sans font-medium text-copper border border-copper/40 rounded-md px-3 h-9 hover:bg-copper/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper transition-colors"
            >
              <Icon name="mail" size={14} aria-hidden />
              Email
            </a>
          ) : null}
```

(The Text link and Log link in the same action row are unchanged. `METHOD_ICON` at line 39 keeps `email: "mail"` for historical timeline rendering — do NOT remove it.)

- [ ] **Step 4: Verify gates**

Run: `npx tsc --noEmit` → Expected: exit 0.
Run: `npx react-router build` → Expected: clean.
Run: `npx vitest run` → Expected: full suite green (`resolveCallAction` covered by Task 4; DetailPanel consumes it).

- [ ] **Step 5: Manual smoke note (for the controller, not a gate)**

The `tel:` handoff and SPA navigation cannot be unit-tested in the node harness. On a real dashboard: a customer with a phone and no `do_not_call` shows a live **Call** that opens the dialer and the Log drawer (method pre-set to Call); a `do_not_call` customer shows a greyed, non-clickable **Call** with the "asked not to be called" tooltip; the **Email** button is gone.

- [ ] **Step 6: Commit**

```bash
git add app/components/DetailPanel.tsx
git commit -m "feat(detail-panel): enforce + capture click-to-call, remove email button"
```

---

### Task 7: Verification sweep + checklist

**Files:**
- Modify: `docs/superpowers/2026-06-23-nudgepay-requirements-gap-checklist.md` (C3 line 45)

- [ ] **Step 1: Full gate sweep**

Run from `nudgepay-app/`:
- `npx vitest run` → Expected: full suite green.
- `npx tsc --noEmit` → Expected: exit 0.
- `npx react-router build` → Expected: clean.

- [ ] **Step 2: Confirm no stray email-channel references remain**

Run: `grep -rnE "mailto|do_not_email|doNotEmail" app/ tests/`
Expected: no matches (login/invite/signup `email` *inputs* and customer `email` *address* fields are unrelated and remain).

- [ ] **Step 3: Mark C3 complete in the gap checklist**

In `docs/superpowers/2026-06-23-nudgepay-requirements-gap-checklist.md`, change the C3 line (line 45) from `- [ ]` to `- [x]` and append a summary noting: email removed entirely (no backend ever existed); click-to-call enforced via `resolveCallAction`/`channelBlocked` and auto-captured by opening the Log drawer pre-filled `method=call`; historical email logs still render; Phase 8 complete.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/2026-06-23-nudgepay-requirements-gap-checklist.md
git commit -m "docs: mark C3 complete (Phase 8) in gap checklist"
```

---

## Final whole-branch review

After Task 7, dispatch the final code-reviewer (most capable model) with the package `scripts/review-package <merge-base> HEAD` for **each** branch's diff, then use superpowers:finishing-a-development-branch. Key invariants for the reviewer:

1. **No email channel anywhere** post-merge: no `mailto:`, no `do_not_email`/`doNotEmail`, no `email` in `CHANNELS`/`CONTACT_METHODS`/preferred-channel CHECK.
2. **Historical email logs still render** (METHOD_ICON + dashboard methodLabel retain `email`).
3. **Email address still displayed** (Overview InfoRow, `cases.ts` email field) — data, not a channel.
4. **Click-to-call:** live only when phone present and not `do_not_call`; blocked → non-link span with reason; both via `resolveCallAction` (single source).
5. **Capture:** live Call navigates to `?…&log=1&method=call`; the drawer pre-selects Call.
6. **`sms_consent` untouched**; `canSendSms` unchanged.
7. **Part A is atomic** — no commit on `phase8-c6-comm-preferences` leaves a half-removed email channel.
