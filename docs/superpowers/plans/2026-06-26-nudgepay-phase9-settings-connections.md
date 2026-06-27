# Phase 9 — Settings & Connections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a `/settings` page that is the canonical home for QuickBooks connection (G1), sync health (G3), read-only text-messaging info (G2), and a collections-rules editor (C7 write path), and relocate the existing connection/sync controls out of the dashboard.

**Architecture:** A new member-readable `/settings` route whose loader gathers connection status, sync errors, messaging config, and org scheduling config. Owners get interactive controls; members see read-only values (enforced by existing `is_org_owner` RLS, not just hidden). G1/G3 reuse the existing `/api/qbo/*` and `/api/sync-errors/dismiss` routes; G2 is a read-only panel over `messaging_config`; C7 adds a pure validator, a new `/api/org-settings` action, and a `0018` migration for the `org_settings.updated_at` trigger. The dashboard loses its connection/sync UI and redirects disconnected orgs to `/settings`.

**Tech Stack:** React Router 7 (framework mode, loaders/actions), Supabase/Postgres + RLS, Vitest (node env, no jsdom), Tailwind v4, local Supabase via Docker.

## Global Constraints

- Verification gates, run from `nudgepay-app/`: `npx react-router typegen && npx tsc -b` (exit 0) · `npx vitest run` (green) · `npx react-router build` (clean). **Do NOT use `npx tsc --noEmit`** — the root tsconfig has `files:[]` + project references, so it checks zero files; only `tsc -b` is real.
- Node-only test harness: no jsdom, no `.tsx` render tests. UI is verified by `tsc -b` + `build`; pure modules and DB/RLS carry the real coverage.
- After adding/editing a migration, run `npx supabase db reset` before any DB test (the test global-setup truncates, it does NOT migrate).
- Conventional Commits. Commit trailer on every commit:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_01FRXXDxVnamDk58w8A7m3Qn`
- Commit ONLY the named source files per task — never `git add -A`, never the untracked `nudgepay-app/.superpowers/` or `nudgepay-app/scripts/demo-*` files.
- Pure modules (`app/lib/org-settings.ts`) carry no I/O, no `node:*`, no `.server` suffix.
- Redirect-on-error convention for write routes (mirrors `api.comm-prefs` / `api.sms-consent`) — never throw a 500 for user-correctable input.
- Access model: all members can load `/settings` read-only; owners get the action controls. The DB boundary is `is_org_owner` RLS on `org_settings` / `org_holidays` (already in migration 0016) and the owner gate in the QBO actions.

---

## File Structure

**Create:**
- `supabase/migrations/0018_org_settings_updated_at.sql` — `set_updated_at()` function + `before update` trigger on `org_settings`.
- `app/lib/org-settings.ts` — pure `parseOrgSettingsUpdate` + `parseHolidayDate`.
- `app/routes/api.org-settings.tsx` — owner-gated action (save rules / add holiday / remove holiday).
- `app/routes/settings.tsx` — `/settings` loader + page (connection, sync, messaging cards).
- `app/components/CollectionsRulesForm.tsx` — the C7 editor (grace / working days / cadence / holidays).
- `tests/org-settings.test.ts` — pure parser unit tests.
- `tests/org-settings-rls.test.ts` — `updated_at` trigger test + RLS write-path tests.

**Modify:**
- `app/routes.ts` — register `settings` and `api/org-settings`.
- `app/components/AppShell.tsx` — wire the Settings nav item + status chip + gear button to `/settings`.
- `app/routes/dashboard.tsx` — redirect disconnected orgs to `/settings`; remove header connection/sync controls + the not-connected block.
- `app/routes/api.qbo.disconnect.tsx`, `app/routes/api.qbo.refresh.tsx` — honor a `returnTo` form field (default `/dashboard`).
- `docs/superpowers/2026-06-23-nudgepay-requirements-gap-checklist.md` — mark G1/G2/G3 + C7 done.

---

## Task 1: Migration — `org_settings.updated_at` auto-update trigger

**Files:**
- Create: `supabase/migrations/0018_org_settings_updated_at.sql`
- Test: `tests/org-settings-rls.test.ts`

**Interfaces:**
- Produces: a `before update` trigger on `org_settings` that sets `updated_at = now()`. No app API.

- [ ] **Step 1: Write the failing test**

Create `tests/org-settings-rls.test.ts`:

```ts
import { expect, test } from "vitest";
import { serviceClient } from "./helpers";

test("updating org_settings bumps updated_at via the trigger", async () => {
  const svc = serviceClient();
  const { data: org } = await svc.from("organizations").insert({ name: `OS-trig ${Math.random()}` }).select("id").single();
  const orgId = org!.id as string;
  // Insert with a deliberately old updated_at so the post-update value must differ.
  await svc.from("org_settings").insert({
    org_id: orgId, promise_grace_days: 2, updated_at: "2000-01-01T00:00:00Z",
  });
  await svc.from("org_settings").update({ promise_grace_days: 5 }).eq("org_id", orgId);
  const { data: row } = await svc.from("org_settings").select("promise_grace_days, updated_at").eq("org_id", orgId).single();
  expect(row!.promise_grace_days).toBe(5);
  expect(new Date(row!.updated_at as string).getTime()).toBeGreaterThan(new Date("2020-01-01T00:00:00Z").getTime());
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/org-settings-rls.test.ts`
Expected: FAIL — `updated_at` stays `2000-01-01` (no trigger), so the `toBeGreaterThan` assertion fails.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/0018_org_settings_updated_at.sql`:

```sql
-- Phase 9 (C7 write path): auto-maintain org_settings.updated_at on UPDATE.
-- 0016 added the column with a default of now() for inserts, but nothing advanced
-- it on update. This trigger does. No data change; backward-compatible.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger org_settings_set_updated_at
  before update on org_settings
  for each row
  execute function public.set_updated_at();
```

- [ ] **Step 4: Apply the migration to the local DB**

Run: `npx supabase db reset`
Expected: all migrations re-apply cleanly through `0018`.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/org-settings-rls.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0018_org_settings_updated_at.sql nudgepay-app/tests/org-settings-rls.test.ts
git commit -m "feat(settings): add org_settings.updated_at trigger (C7)"
```

---

## Task 2: Pure `parseOrgSettingsUpdate` + `parseHolidayDate`

**Files:**
- Create: `app/lib/org-settings.ts`
- Test: `tests/org-settings.test.ts`

**Interfaces:**
- Produces:
  - `type OrgSettingsPatch = { promise_grace_days: number; working_days: number[]; cadence_critical: number; cadence_high: number; cadence_medium: number; cadence_low: number }`
  - `type ParseResult = { ok: true; patch: OrgSettingsPatch } | { ok: false; error: string }`
  - `parseOrgSettingsUpdate(form: FormData): ParseResult`
  - `parseHolidayDate(value: FormDataEntryValue | null): string | null`

- [ ] **Step 1: Write the failing tests**

Create `tests/org-settings.test.ts`:

```ts
import { expect, test } from "vitest";
import { parseOrgSettingsUpdate, parseHolidayDate } from "../app/lib/org-settings";

function fd(entries: Array<[string, string]>): FormData {
  const f = new FormData();
  for (const [k, v] of entries) f.append(k, v);
  return f;
}

const valid: Array<[string, string]> = [
  ["promise_grace_days", "3"],
  ["working_days", "1"], ["working_days", "2"], ["working_days", "3"], ["working_days", "4"], ["working_days", "5"],
  ["cadence_critical", "2"], ["cadence_high", "3"], ["cadence_medium", "7"], ["cadence_low", "14"],
];

test("parseOrgSettingsUpdate accepts a valid form and sorts/dedupes working days", () => {
  const r = parseOrgSettingsUpdate(fd([["working_days", "5"], ["working_days", "1"], ["working_days", "1"],
    ["promise_grace_days", "3"], ["cadence_critical", "2"], ["cadence_high", "3"], ["cadence_medium", "7"], ["cadence_low", "14"]]));
  expect(r).toEqual({ ok: true, patch: {
    promise_grace_days: 3, working_days: [1, 5],
    cadence_critical: 2, cadence_high: 3, cadence_medium: 7, cadence_low: 14,
  } });
});

test("grace of 0 is allowed; negative is rejected", () => {
  expect(parseOrgSettingsUpdate(fd(valid.map(([k, v]) => k === "promise_grace_days" ? [k, "0"] : [k, v])))).toMatchObject({ ok: true });
  expect(parseOrgSettingsUpdate(fd(valid.map(([k, v]) => k === "promise_grace_days" ? [k, "-1"] : [k, v])))).toEqual({ ok: false, error: "grace" });
});

test("non-integer / missing grace is rejected", () => {
  expect(parseOrgSettingsUpdate(fd(valid.filter(([k]) => k !== "promise_grace_days")))).toEqual({ ok: false, error: "grace" });
  expect(parseOrgSettingsUpdate(fd(valid.map(([k, v]) => k === "promise_grace_days" ? [k, "2.5"] : [k, v])))).toEqual({ ok: false, error: "grace" });
});

test("empty or out-of-range working days are rejected", () => {
  expect(parseOrgSettingsUpdate(fd(valid.filter(([k]) => k !== "working_days")))).toEqual({ ok: false, error: "working_days" });
  expect(parseOrgSettingsUpdate(fd([...valid.filter(([k]) => k !== "working_days"), ["working_days", "7"]]))).toEqual({ ok: false, error: "working_days" });
});

test("a non-positive cadence is rejected", () => {
  expect(parseOrgSettingsUpdate(fd(valid.map(([k, v]) => k === "cadence_high" ? [k, "0"] : [k, v])))).toEqual({ ok: false, error: "cadence" });
});

test("parseHolidayDate accepts a real YYYY-MM-DD and rejects junk", () => {
  expect(parseHolidayDate("2026-07-04")).toBe("2026-07-04");
  expect(parseHolidayDate("2026-02-31")).toBe(null); // not a real calendar day
  expect(parseHolidayDate("07/04/2026")).toBe(null);
  expect(parseHolidayDate("")).toBe(null);
  expect(parseHolidayDate(null)).toBe(null);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/org-settings.test.ts`
Expected: FAIL — `Cannot find module '../app/lib/org-settings'`.

- [ ] **Step 3: Write the implementation**

Create `app/lib/org-settings.ts`:

```ts
// Pure parsing/validation for the C7 collections-rules editor. No I/O, no .server.
// Mirrors parseCommPrefsUpdate: turn the submitted form into a validated
// org_settings patch, or a typed error. Validation rules mirror the DB CHECKs in
// migration 0016 (grace >= 0; working_days a non-empty subset of {0..6}; each
// cadence > 0).

export type OrgSettingsPatch = {
  promise_grace_days: number;
  working_days: number[];
  cadence_critical: number;
  cadence_high: number;
  cadence_medium: number;
  cadence_low: number;
};

export type ParseResult =
  | { ok: true; patch: OrgSettingsPatch }
  | { ok: false; error: string };

function intField(form: FormData, name: string): number | null {
  const raw = form.get(name);
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isInteger(n) ? n : null;
}

export function parseOrgSettingsUpdate(form: FormData): ParseResult {
  const grace = intField(form, "promise_grace_days");
  if (grace === null || grace < 0) return { ok: false, error: "grace" };

  const days = form.getAll("working_days")
    .filter((v): v is string => typeof v === "string")
    .map((v) => Number(v));
  if (days.length === 0 || days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
    return { ok: false, error: "working_days" };
  }
  const working_days = [...new Set(days)].sort((a, b) => a - b);

  const c = intField(form, "cadence_critical");
  const h = intField(form, "cadence_high");
  const m = intField(form, "cadence_medium");
  const l = intField(form, "cadence_low");
  if ([c, h, m, l].some((x) => x === null || (x as number) <= 0)) {
    return { ok: false, error: "cadence" };
  }

  return {
    ok: true,
    patch: {
      promise_grace_days: grace,
      working_days,
      cadence_critical: c as number,
      cadence_high: h as number,
      cadence_medium: m as number,
      cadence_low: l as number,
    },
  };
}

// Validates a single YYYY-MM-DD holiday date (for add/remove). Returns the
// normalized string, or null when malformed or not a real calendar day.
export function parseHolidayDate(value: FormDataEntryValue | null): string | null {
  if (typeof value !== "string") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(value + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10) === value ? value : null; // round-trip rejects 2026-02-31
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/org-settings.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Typecheck**

Run: `npx react-router typegen && npx tsc -b`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add nudgepay-app/app/lib/org-settings.ts nudgepay-app/tests/org-settings.test.ts
git commit -m "feat(settings): pure org-settings form parser (C7)"
```

---

## Task 3: `api.org-settings` action + route registration + RLS write-path tests

**Files:**
- Create: `app/routes/api.org-settings.tsx`
- Modify: `app/routes.ts`
- Test: `tests/org-settings-rls.test.ts` (append)

**Interfaces:**
- Consumes: `parseOrgSettingsUpdate`, `parseHolidayDate` (Task 2); `safeReturnTo` from `app/lib/return-to`.
- Produces: a POST action at `/api/org-settings` dispatching on `intent` ∈ `save_rules | add_holiday | remove_holiday`.

- [ ] **Step 1: Write the failing RLS tests** (append to `tests/org-settings-rls.test.ts`)

```ts
import { makeUserClient } from "./helpers";

test("an owner writes org_settings + org_holidays via RLS; a member cannot", async () => {
  const svc = serviceClient();
  const { data: org } = await svc.from("organizations").insert({ name: `OS-rls ${Math.random()}` }).select("id").single();
  const orgId = org!.id as string;
  const owner = await makeUserClient(`os-owner-${Math.random()}@example.com`);
  const member = await makeUserClient(`os-member-${Math.random()}@example.com`);
  await svc.from("memberships").insert([
    { org_id: orgId, user_id: owner.userId, role: "owner" },
    { org_id: orgId, user_id: member.userId, role: "member" },
  ]);

  // Owner upsert succeeds.
  const { error: ownErr } = await owner.client.from("org_settings")
    .upsert({ org_id: orgId, promise_grace_days: 4, working_days: [1, 2, 3, 4, 5],
      cadence_critical: 1, cadence_high: 2, cadence_medium: 5, cadence_low: 10 }, { onConflict: "org_id" });
  expect(ownErr).toBeNull();
  await owner.client.from("org_holidays").upsert({ org_id: orgId, holiday_date: "2026-07-04" }, { onConflict: "org_id,holiday_date" });

  // Member can READ.
  const { data: seen } = await member.client.from("org_settings").select("promise_grace_days").eq("org_id", orgId).maybeSingle();
  expect(seen?.promise_grace_days).toBe(4);

  // Member write is blocked by RLS (no error thrown, simply 0 rows affected).
  await member.client.from("org_settings").update({ promise_grace_days: 99 }).eq("org_id", orgId);
  const { data: after } = await svc.from("org_settings").select("promise_grace_days").eq("org_id", orgId).single();
  expect(after!.promise_grace_days).toBe(4); // unchanged
});

test("an outsider can neither read nor write another org's settings", async () => {
  const svc = serviceClient();
  const { data: org } = await svc.from("organizations").insert({ name: `OS-out ${Math.random()}` }).select("id").single();
  const orgId = org!.id as string;
  await svc.from("org_settings").insert({ org_id: orgId, promise_grace_days: 2 });
  const outsider = await makeUserClient(`os-out-${Math.random()}@example.com`);

  const { data: seen } = await outsider.client.from("org_settings").select("promise_grace_days").eq("org_id", orgId);
  expect(seen ?? []).toHaveLength(0); // RLS hides the row
  await outsider.client.from("org_settings").update({ promise_grace_days: 99 }).eq("org_id", orgId);
  const { data: after } = await svc.from("org_settings").select("promise_grace_days").eq("org_id", orgId).single();
  expect(after!.promise_grace_days).toBe(2);
});
```

- [ ] **Step 2: Run tests to verify they pass against RLS** (RLS already exists from 0016)

Run: `npx vitest run tests/org-settings-rls.test.ts`
Expected: PASS — confirms the existing RLS grants behave as designed (these tests are the parked "RLS tests" deliverable; they pass without new SQL).

- [ ] **Step 3: Write the action route**

Create `app/routes/api.org-settings.tsx`:

```tsx
import { redirect, type ActionFunctionArgs } from "react-router";
import { getEnv } from "../lib/env.server";
import { requireUser, resolveOrg } from "../lib/session.server";
import { safeReturnTo } from "../lib/return-to";
import { parseOrgSettingsUpdate, parseHolidayDate } from "../lib/org-settings";

function flag(returnTo: string, key: string, val: string): string {
  return `${returnTo}${returnTo.includes("?") ? "&" : "?"}${key}=${val}`;
}

export async function action({ request, context }: ActionFunctionArgs) {
  const env = getEnv(context as any);
  const { supabase, headers, user } = await requireUser(request, env);
  const org = await resolveOrg(supabase, user.id);
  if (!org) throw redirect("/onboarding", { headers });

  const form = await request.formData();
  const returnTo = safeReturnTo(form.get("returnTo"), "/settings");
  // Owner-only surface gate; RLS (is_org_owner) is the real boundary.
  if (org.role !== "owner") return redirect(returnTo, { headers });

  const intent = form.get("intent");

  if (intent === "save_rules") {
    const parsed = parseOrgSettingsUpdate(form);
    if (!parsed.ok) return redirect(flag(returnTo, "error", parsed.error), { headers });
    const { error } = await supabase.from("org_settings")
      .upsert({ org_id: org.org_id, ...parsed.patch }, { onConflict: "org_id" });
    if (error) return redirect(flag(returnTo, "error", "save"), { headers });
    return redirect(flag(returnTo, "saved", "1"), { headers });
  }

  if (intent === "add_holiday") {
    const date = parseHolidayDate(form.get("holiday_date"));
    if (!date) return redirect(flag(returnTo, "error", "holiday"), { headers });
    const { error } = await supabase.from("org_holidays")
      .upsert({ org_id: org.org_id, holiday_date: date }, { onConflict: "org_id,holiday_date" });
    if (error) return redirect(flag(returnTo, "error", "holiday"), { headers });
    return redirect(flag(returnTo, "saved", "1"), { headers });
  }

  if (intent === "remove_holiday") {
    const date = parseHolidayDate(form.get("holiday_date"));
    if (date) {
      await supabase.from("org_holidays").delete()
        .eq("org_id", org.org_id).eq("holiday_date", date);
    }
    return redirect(flag(returnTo, "saved", "1"), { headers });
  }

  return redirect(returnTo, { headers });
}

export function loader() {
  return redirect("/settings");
}
```

- [ ] **Step 4: Register the route** in `app/routes.ts` — add after the `api/comm-prefs` line (line 17):

```ts
  route("api/org-settings", "routes/api.org-settings.tsx"),
```

- [ ] **Step 5: Run the route-registration test + typecheck**

Run: `npx vitest run tests/routes-registration.test.ts && npx react-router typegen && npx tsc -b`
Expected: registration test PASS (the new api route is registered); tsc exit 0.

- [ ] **Step 6: Commit**

```bash
git add nudgepay-app/app/routes/api.org-settings.tsx nudgepay-app/app/routes.ts nudgepay-app/tests/org-settings-rls.test.ts
git commit -m "feat(settings): org-settings write action + RLS tests (C7)"
```

---

## Task 4: `/settings` route — loader, page, and Collections-rules editor

**Files:**
- Create: `app/components/CollectionsRulesForm.tsx`
- Create: `app/routes/settings.tsx`
- Modify: `app/routes.ts`

**Interfaces:**
- Consumes: `loadOrgConfig` (`app/lib/org-config.server`), `getConnectionStatus` (`app/lib/qbo-connection.server`), `requireUser`/`resolveOrg`, `AppShell`.
- Produces: the `/settings` page. `CollectionsRulesForm` props:
  `{ grace: number; workingDays: number[]; cadence: { Critical: number; High: number; Medium: number; Low: number }; holidays: string[]; isOwner: boolean }`.

- [ ] **Step 1: Write the Collections-rules editor component**

Create `app/components/CollectionsRulesForm.tsx`:

```tsx
import { Form } from "react-router";

const WEEKDAYS: Array<{ value: number; label: string }> = [
  { value: 0, label: "Sun" }, { value: 1, label: "Mon" }, { value: 2, label: "Tue" },
  { value: 3, label: "Wed" }, { value: 4, label: "Thu" }, { value: 5, label: "Fri" }, { value: 6, label: "Sat" },
];

export function CollectionsRulesForm({
  grace, workingDays, cadence, holidays, isOwner,
}: {
  grace: number;
  workingDays: number[];
  cadence: { Critical: number; High: number; Medium: number; Low: number };
  holidays: string[];
  isOwner: boolean;
}) {
  const days = new Set(workingDays);
  const ro = !isOwner;
  return (
    <section className="rounded-lg border border-border bg-surface p-5">
      <h2 className="font-display text-base font-semibold text-text">Collections rules</h2>
      <p className="mt-0.5 mb-4 text-xs text-muted">
        How NudgePay schedules grace periods and follow-ups. {ro ? "Only an owner can change these." : ""}
      </p>

      <Form method="post" action="/api/org-settings" className="flex flex-col gap-4">
        <input type="hidden" name="intent" value="save_rules" />
        <input type="hidden" name="returnTo" value="/settings" />

        <label className="flex flex-col gap-1 max-w-xs">
          <span className="text-xs font-medium uppercase tracking-wider text-muted">Promise grace (business days)</span>
          <input type="number" name="promise_grace_days" min={0} defaultValue={grace} disabled={ro}
            className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-text disabled:opacity-60" />
        </label>

        <fieldset className="flex flex-col gap-1.5">
          <legend className="text-xs font-medium uppercase tracking-wider text-muted">Working days</legend>
          <div className="flex flex-wrap gap-3">
            {WEEKDAYS.map((d) => (
              <label key={d.value} className="flex items-center gap-1.5 text-sm text-text">
                <input type="checkbox" name="working_days" value={d.value} defaultChecked={days.has(d.value)} disabled={ro}
                  className="h-4 w-4 rounded border-border text-copper disabled:opacity-60" />
                {d.label}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-1.5">
          <legend className="text-xs font-medium uppercase tracking-wider text-muted">Follow-up cadence (days)</legend>
          <div className="flex flex-wrap gap-3">
            {([["cadence_critical", "Critical", cadence.Critical], ["cadence_high", "High", cadence.High],
              ["cadence_medium", "Medium", cadence.Medium], ["cadence_low", "Low", cadence.Low]] as const).map(([name, label, val]) => (
              <label key={name} className="flex flex-col gap-1 w-20">
                <span className="text-[11px] text-muted">{label}</span>
                <input type="number" name={name} min={1} defaultValue={val} disabled={ro}
                  className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-text disabled:opacity-60" />
              </label>
            ))}
          </div>
        </fieldset>

        {isOwner ? (
          <div>
            <button type="submit" className="rounded-md bg-copper px-3 py-1.5 text-xs font-semibold text-ink hover:bg-copper/90">
              Save rules
            </button>
          </div>
        ) : null}
      </Form>

      <div className="mt-5">
        <h3 className="text-xs font-medium uppercase tracking-wider text-muted">Holidays</h3>
        <ul className="mt-2 flex flex-col gap-1" role="list">
          {holidays.length === 0 ? <li className="text-sm text-muted">No holidays configured.</li> : null}
          {holidays.map((h) => (
            <li key={h} className="flex items-center gap-3 text-sm text-text">
              <span className="tabular-nums">{h}</span>
              {isOwner ? (
                <Form method="post" action="/api/org-settings">
                  <input type="hidden" name="intent" value="remove_holiday" />
                  <input type="hidden" name="holiday_date" value={h} />
                  <input type="hidden" name="returnTo" value="/settings" />
                  <button type="submit" className="text-xs text-hot hover:underline">Remove</button>
                </Form>
              ) : null}
            </li>
          ))}
        </ul>
        {isOwner ? (
          <Form method="post" action="/api/org-settings" className="mt-2 flex items-center gap-2">
            <input type="hidden" name="intent" value="add_holiday" />
            <input type="hidden" name="returnTo" value="/settings" />
            <input type="date" name="holiday_date" required
              className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-text" />
            <button type="submit" className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text hover:border-copper">
              Add holiday
            </button>
          </Form>
        ) : null}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Write the settings route (loader + page)**

Create `app/routes/settings.tsx`:

```tsx
import { redirect, useLoaderData, Form, type LoaderFunctionArgs } from "react-router";
import { getEnv } from "../lib/env.server";
import { requireUser, resolveOrg } from "../lib/session.server";
import { getConnectionStatus } from "../lib/qbo-connection.server";
import { loadOrgConfig } from "../lib/org-config.server";
import { AppShell } from "../components/AppShell";
import { CollectionsRulesForm } from "../components/CollectionsRulesForm";

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = getEnv(context as any);
  const { supabase, headers, user } = await requireUser(request, env);
  const org = await resolveOrg(supabase, user.id);
  if (!org) throw redirect("/onboarding", { headers });
  const isOwner = org.role === "owner";

  const { data: orgRow } = await supabase.from("organizations").select("name").eq("id", org.org_id).single();
  const emailParts = (user.email ?? "").split("@")[0].split(/[.\-_]/);
  const initials = emailParts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";

  const conn = await getConnectionStatus(supabase, org.org_id);
  const connected = conn?.status === "connected";

  const { data: connMeta } = await supabase.from("qbo_connections").select("last_sync_at").eq("org_id", org.org_id).maybeSingle();
  const lastSyncAt = (connMeta?.last_sync_at as string | null) ?? null;

  const { data: syncErrorRows } = await supabase.from("sync_errors")
    .select("id, source, scope, message, occurred_at").eq("org_id", org.org_id)
    .is("resolved_at", null).order("occurred_at", { ascending: false });
  const syncIssues = ((syncErrorRows as any[]) ?? []).map((r) => ({
    id: r.id as string, source: r.source as string, scope: r.scope as string,
    message: r.message as string, occurredAt: r.occurred_at as string,
  }));

  const { data: msg } = await supabase.from("messaging_config")
    .select("sender, messaging_service_sid").eq("org_id", org.org_id).maybeSingle();
  const sender = (msg?.sender as string | null) ?? null;
  const messagingConfigured = Boolean(msg?.messaging_service_sid || msg?.sender);

  const config = await loadOrgConfig(supabase, org.org_id);

  return Response.json({
    orgName: (orgRow?.name as string) ?? "Workspace",
    initials, isOwner, connected, lastSyncAt, syncIssues,
    messaging: { sender, configured: messagingConfigured },
    rules: {
      grace: config.promiseGraceDays,
      workingDays: [...config.workingDays],
      cadence: config.cadenceDays,
      holidays: [...config.holidays].sort(),
    },
  }, { headers });
}

function relTime(iso: string | null): string {
  if (!iso) return "never";
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 2) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  return hr < 24 ? `${hr}h ago` : `${Math.floor(hr / 24)}d ago`;
}

export default function Settings() {
  const d = useLoaderData<typeof loader>();
  const syncLabel = d.connected ? `Synced ${relTime(d.lastSyncAt)}` : "Not connected";

  return (
    <AppShell orgName={d.orgName} userInitials={d.initials} syncLabel={syncLabel} connected={d.connected} isOwner={d.isOwner}>
      <div className="h-full overflow-auto bg-panel p-6">
        <div className="mx-auto flex max-w-3xl flex-col gap-5">
          <h1 className="font-display text-xl font-semibold text-text">Settings</h1>

          {/* QuickBooks connection (G1) */}
          <section className="rounded-lg border border-border bg-surface p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-base font-semibold text-text">QuickBooks</h2>
              <span className={`text-xs font-medium ${d.connected ? "text-cool" : "text-muted"}`}>
                {d.connected ? `Connected · ${syncLabel}` : "Not connected"}
              </span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {d.connected ? (
                <>
                  <Form method="post" action="/api/qbo/refresh">
                    <input type="hidden" name="returnTo" value="/settings" />
                    <button type="submit" className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text hover:border-copper">Refresh</button>
                  </Form>
                  {d.isOwner ? (
                    <>
                      <Form method="post" action="/api/qbo/connect">
                        <button type="submit" className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text hover:border-copper">Reconnect</button>
                      </Form>
                      <Form method="post" action="/api/qbo/disconnect">
                        <input type="hidden" name="returnTo" value="/settings" />
                        <button type="submit" className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-hot hover:border-hot">Disconnect</button>
                      </Form>
                    </>
                  ) : null}
                </>
              ) : d.isOwner ? (
                <Form method="post" action="/api/qbo/connect">
                  <button type="submit" className="rounded-md bg-copper px-3 py-1.5 text-xs font-semibold text-ink hover:bg-copper/90">Connect QuickBooks</button>
                </Form>
              ) : (
                <p className="text-sm text-muted">Not connected — ask an owner to connect QuickBooks.</p>
              )}
            </div>
          </section>

          {/* Sync health (G3) */}
          <section className="rounded-lg border border-border bg-surface p-5">
            <h2 className="font-display text-base font-semibold text-text">Sync health</h2>
            <p className="mt-0.5 text-xs text-muted">Last sync {relTime(d.lastSyncAt)} · {d.syncIssues.length} unresolved {d.syncIssues.length === 1 ? "error" : "errors"}.</p>
            <ul className="mt-3 flex flex-col gap-2" role="list">
              {d.syncIssues.map((it) => (
                <li key={it.id} className="rounded-md border border-border p-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium capitalize text-text">{it.source}</span>
                    <span className="text-muted" suppressHydrationWarning>{relTime(it.occurredAt)}</span>
                  </div>
                  <p className="mt-0.5 break-words text-text/80">{it.message}</p>
                  <Form method="post" action="/api/sync-errors/dismiss" className="mt-1.5">
                    <input type="hidden" name="id" value={it.id} />
                    <input type="hidden" name="returnTo" value="/settings" />
                    <button type="submit" className="text-[11px] font-medium text-copper hover:underline">Dismiss</button>
                  </Form>
                </li>
              ))}
            </ul>
          </section>

          {/* Text messaging (G2, read-only) */}
          <section className="rounded-lg border border-border bg-surface p-5">
            <h2 className="font-display text-base font-semibold text-text">Text messaging</h2>
            <dl className="mt-2 flex flex-col gap-1 text-sm">
              <div className="flex gap-2"><dt className="text-muted w-28">From</dt><dd className="text-text tabular-nums">{d.messaging.sender ?? "Not provisioned"}</dd></div>
              <div className="flex gap-2"><dt className="text-muted w-28">Status</dt><dd className={d.messaging.configured ? "text-cool" : "text-muted"}>{d.messaging.configured ? "Set up" : "Not provisioned"}</dd></div>
            </dl>
            <p className="mt-2 text-xs text-muted">Text-message carrier registration is managed by NudgePay.</p>
          </section>

          {/* Collections rules (C7) */}
          <CollectionsRulesForm grace={d.rules.grace} workingDays={d.rules.workingDays} cadence={d.rules.cadence} holidays={d.rules.holidays} isOwner={d.isOwner} />
        </div>
      </div>
    </AppShell>
  );
}
```

- [ ] **Step 3: Register the route** in `app/routes.ts` — add after the `reports` line (line 12):

```ts
  route("settings", "routes/settings.tsx"),
```

- [ ] **Step 4: Typecheck and build**

Run: `npx react-router typegen && npx tsc -b && npx react-router build`
Expected: tsc exit 0; build clean.

- [ ] **Step 5: Commit**

```bash
git add nudgepay-app/app/components/CollectionsRulesForm.tsx nudgepay-app/app/routes/settings.tsx nudgepay-app/app/routes.ts
git commit -m "feat(settings): /settings page — connection, sync, messaging, collections rules"
```

---

## Task 5: Wire AppShell to `/settings`

**Files:**
- Modify: `app/components/AppShell.tsx`

**Interfaces:**
- Consumes: `Link` (already imported), the `/settings` route (Task 4).

- [ ] **Step 1: Make the status chip a link.** Replace the sync-chip `<div>` (the block starting `{/* Sync chip */}` with `<div className="hidden sm:flex items-center gap-1.5 px-2 py-1 rounded bg-surface/5 border border-surface/10" aria-label=...>`) with a `Link`:

```tsx
          {/* Sync chip → Settings */}
          <Link
            to="/settings"
            className="hidden sm:flex items-center gap-1.5 px-2 py-1 rounded bg-surface/5 border border-surface/10 hover:border-copper transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
            aria-label={connected ? `Connected — ${syncLabel}` : `Disconnected — ${syncLabel}`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full shrink-0 ${connected ? "bg-copper" : "bg-muted"}`}
              aria-hidden="true"
            />
            <span className="text-[11px] font-sans text-surface/60 leading-none">
              {syncLabel}
            </span>
          </Link>
```

- [ ] **Step 2: Make the gear button a link.** Replace the `{/* Settings */}` `<button ... disabled title="Settings coming soon">` block with:

```tsx
          {/* Settings */}
          <Link
            to="/settings"
            className="flex items-center justify-center w-8 h-8 rounded text-surface/60 hover:text-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
            aria-label="Settings"
            title="Settings"
          >
            <Icon name="settings" size={16} />
          </Link>
```

- [ ] **Step 3: Make the side-nav Settings item a link.** In the `NAV_ITEMS.map`, add a settings branch immediately before the `/* Inert future nav items */` fallback `return`:

```tsx
              if (item.name === "settings") {
                return (
                  <li key={item.name} className="relative w-full">
                    <Link
                      to="/settings"
                      className="flex flex-col items-center justify-center w-full py-3 gap-1 text-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper focus-visible:ring-inset"
                      aria-label={item.label}
                      onClick={() => setNavOpen(false)}
                    >
                      <Icon name={item.icon} size={18} />
                      <span className="text-[9px] font-sans font-medium uppercase tracking-wide leading-none">{item.label}</span>
                    </Link>
                  </li>
                );
              }
```

- [ ] **Step 4: Typecheck and build**

Run: `npx react-router typegen && npx tsc -b && npx react-router build`
Expected: tsc exit 0; build clean.

- [ ] **Step 5: Commit**

```bash
git add nudgepay-app/app/components/AppShell.tsx
git commit -m "feat(settings): wire AppShell nav + status chip to /settings"
```

---

## Task 6: Relocate connection/sync UI out of the dashboard

**Files:**
- Modify: `app/routes/dashboard.tsx`

**Interfaces:**
- Consumes: the `/settings` route (Task 4). `redirect` is already imported in `dashboard.tsx`.

- [ ] **Step 1: Redirect disconnected orgs.** In the loader, immediately after `const connected = conn?.status === "connected";` (around line 175), add:

```ts
  if (!connected) throw redirect("/settings", { headers });
```

- [ ] **Step 2: Remove the sync-errors loader read.** Delete the `sync_errors` query and the `syncIssues` mapping (the block reading `.from("sync_errors")` … building `const syncIssues = (...)`, around lines 205–215). Remove `syncIssues` from the loader's returned object (the `syncIssues,` line near 505) and from the component destructure of `useLoaderData` (the `syncIssues,` near line 552).

- [ ] **Step 3: Drop the header actions + sync indicator from the AppShell usage.** In the component's `return`, remove the `syncIssues={<SyncIssues .../>}` prop and the `headerActions={ connected ? (<div>…Refresh…Disconnect…</div>) : null }` prop entirely from the `<AppShell ...>` opening tag. Remove the now-unused `import { SyncIssues } from "../components/SyncIssues";` if present.

- [ ] **Step 4: Unwrap the connected conditional + delete the not-connected block.** The loader now guarantees `connected`. Replace the `{connected ? ( <connected workspace JSX> ) : ( <Not connected> … Connect QuickBooks … </> )}` expression so only the connected workspace JSX renders (drop the ternary and the entire "Not connected" branch, including its `<Form method="post" action="/api/qbo/connect">`).

- [ ] **Step 5: Typecheck, build, and run the dashboard tests**

Run: `npx react-router typegen && npx tsc -b && npx react-router build && npx vitest run tests/dashboard-worklist.test.ts`
Expected: tsc exit 0 (no unused-symbol errors — confirms all removed references are gone); build clean; dashboard-worklist tests PASS.

- [ ] **Step 6: Commit**

```bash
git add nudgepay-app/app/routes/dashboard.tsx
git commit -m "refactor(dashboard): relocate connection/sync UI to /settings"
```

---

## Task 7: Honor `returnTo` in the QBO refresh + disconnect actions

**Files:**
- Modify: `app/routes/api.qbo.refresh.tsx`, `app/routes/api.qbo.disconnect.tsx`

**Interfaces:**
- Consumes: `safeReturnTo` from `app/lib/return-to`.

- [ ] **Step 1: Thread `returnTo` through refresh.** In `app/routes/api.qbo.refresh.tsx`, import the helper and read the field:

```ts
import { safeReturnTo } from "../lib/return-to";
```

After `if (!org) return redirect("/onboarding", { headers });`, add:

```ts
  const form = await request.formData();
  const returnTo = safeReturnTo(form.get("returnTo"));
  const sep = returnTo.includes("?") ? "&" : "?";
```

Then change the two result redirects: `return redirect(\`${returnTo}${sep}sync=ok\`, { headers });` on success and `return redirect(\`${returnTo}${sep}sync=error\`, { headers });` in the catch.

- [ ] **Step 2: Thread `returnTo` through disconnect.** In `app/routes/api.qbo.disconnect.tsx`, import `safeReturnTo`. After the owner check, add:

```ts
  const form = await request.formData();
  const returnTo = safeReturnTo(form.get("returnTo"));
  const sep = returnTo.includes("?") ? "&" : "?";
```

Change the final redirect to `return redirect(\`${returnTo}${sep}qbo=disconnected\`, { headers });`. (Leave the `loader` Intuit-landing handler and the `?qbo=forbidden` owner-rejection redirect unchanged — those have no caller-supplied `returnTo`.)

- [ ] **Step 3: Typecheck and build**

Run: `npx react-router typegen && npx tsc -b && npx react-router build`
Expected: tsc exit 0; build clean. (These auth-gated actions follow the codebase convention of not being unit-tested directly — see `tests/api-comm-prefs.test.ts`, which tests the parser + RLS, not the action.)

- [ ] **Step 4: Commit**

```bash
git add nudgepay-app/app/routes/api.qbo.refresh.tsx nudgepay-app/app/routes/api.qbo.disconnect.tsx
git commit -m "feat(settings): QBO refresh/disconnect honor returnTo"
```

---

## Task 8: Final verification + checklist update

**Files:**
- Modify: `docs/superpowers/2026-06-23-nudgepay-requirements-gap-checklist.md`

- [ ] **Step 1: Full verification sweep**

Run (from `nudgepay-app/`): `npx react-router typegen && npx tsc -b && npx vitest run && npx react-router build`
Expected: tsc exit 0; full suite green; build clean.

- [ ] **Step 2: Update the gap checklist.** In section G, mark G1/G2/G3 `[x]` with the Settings-page implementation, and update the C7 line's deferred-minors note to record that the `updated_at` trigger + RLS tests landed in Phase 9. (Edit the `## G.` items and the C7 line text accordingly.)

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/2026-06-23-nudgepay-requirements-gap-checklist.md
git commit -m "docs: mark G1-G3 + C7 settings write-path complete (Phase 9)"
```

---

## Self-Review

**Spec coverage:**
- G1 connection management → Task 4 (Settings connection card, reuses `/api/qbo/*`) + Task 7 (returnTo). ✅
- G2 read-only SMS panel → Task 4 (messaging card, no schema change). ✅
- G3 sync status & errors → Task 4 (sync-health card, reuses `/api/sync-errors/dismiss`). ✅
- C7 write path → Task 1 (trigger), Task 2 (parser), Task 3 (action + RLS tests), Task 4 (editor UI). ✅
- Full relocate → Task 6 (dashboard redirect + removals), Task 5 (AppShell links). ✅
- Members-view/owners-manage → loader is member-readable (Task 4); owner gates in Task 3 action + RLS; `isOwner` drives disabled inputs / hidden actions. ✅

**Placeholder scan:** No TBD/TODO; every code step shows complete code. ✅

**Type consistency:** `parseOrgSettingsUpdate` → `ParseResult`/`OrgSettingsPatch` used identically in Task 2 (def), Task 3 (action), and tests. `CollectionsRulesForm` prop shape in Task 4 matches the loader's `rules` object (`grace`, `workingDays`, `cadence` as `{Critical,High,Medium,Low}` from `OrgConfig.cadenceDays`, `holidays`). `loadOrgConfig` returns `OrgConfig` with `ReadonlySet` fields → the loader spreads them to arrays for JSON. `safeReturnTo(value, fallback)` signature matches usage. ✅

**Notes for the executor:**
- Task 1 adds a migration → its `npx supabase db reset` (Step 4) must run before any later DB test.
- Task 6 edits the large `dashboard.tsx`; rely on `tsc -b` to catch any dangling reference to a removed symbol (`syncIssues`, `SyncIssues`).
- The disconnected-dashboard redirect (Task 6) is verified by `tsc -b` + build + reasoning; route-loader redirects are not unit-tested elsewhere in this codebase.
