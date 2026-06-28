# Phase 14 — Settings Channel Config Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give org owners a server-enforced per-org SMS on/off toggle in Settings, tighten `messaging_config` RLS to owner-write, and create the disabled `email_config` storage that subsystem #3 will consume.

**Architecture:** A migration adds `messaging_config.sms_enabled` (default true), retightens `messaging_config` RLS (member-read / owner-write), and creates an `email_config` table (disabled, owner-write, no secrets). A pure `channel-settings.ts` parses/resolves the toggle. The owner-gated `/api/org-settings` gains a `save_channels` intent. `sendInvoiceText` reads `sms_enabled` and throws when off — the single gate covers both `/api/text/send` and `/api/bulk-sms` (via `runBulkSms`). The dashboard and Messages loaders expose `smsEnabled`; both composers disable Send with a reason when off.

**Tech Stack:** React Router v7 (framework mode) on Cloudflare Workers · Supabase (RLS via `is_org_member`/`is_org_owner`) · Tailwind v4 · Vitest against local Supabase.

## Global Constraints

- React Router v7 framework mode on Cloudflare Workers. No `node:*` imports in `app/**`. No client→`.server.ts` module-graph reference; pure modules stay suffix-free (`channel-settings.ts`).
- Tailwind v4 CSS-first; static **literal** class strings only. Phase-10 warm tokens (copper/cool/hot/ink, bg-surface/panel/paper, border-border, text-text/muted). Reuse the existing Settings panel styling.
- Supabase RLS via `is_org_member`/`is_org_owner`. **User client** for reads + the settings write; **service client** only where already used (the send path, connection status, roster). Browser never touches the DB.
- **Sender stays read-only** (shared-account impersonation risk) — do NOT add a sender text input. **Email is groundwork only** — create the disabled `email_config` table; build NO email UI, NO sending, NO secret/API-key column.
- **SMS-off behavior:** disable composing/sending; still read threads and receive inbound. The org gate is enforced **server-side** in `sendInvoiceText` (covers single + bulk) AND reflected in the composers — never UI-only.
- No row in `messaging_config` ⇒ SMS treated as **enabled** (preserves today's behavior).
- Vitest against local Supabase; per-test fresh orgs + globally-unique data; never global truncation. **Run `supabase db reset` after adding migration `0020`** so the edited RLS + new table apply locally.
- Conventional Commits with trailers:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_01M8bM6o1UNb4R1dzWHe52fe`
- Never `git add -A` — untracked scratch (`nudgepay-app/.superpowers/`, demo scripts) must not be committed.
- Gates per task touching `app/**` or migrations (run from `nudgepay-app/`): `npx react-router typegen && npx tsc -b` (exit 0) · `npx vitest run` (green; local Supabase up) · `npx react-router build` (clean).

---

### Task 1: Migration `0020` — `sms_enabled`, retighten `messaging_config` RLS, create `email_config`

**Files:**
- Create: `nudgepay-app/supabase/migrations/0020_channel_settings.sql`
- Test: `nudgepay-app/tests/messaging-config-rls.test.ts`

**Interfaces:**
- Consumes: existing `is_org_member`/`is_org_owner` (0002/0016), `organizations`, `messaging_config`.
- Produces: `messaging_config.sms_enabled boolean not null default true`; table `email_config(org_id pk, email_enabled bool default false, from_address text, from_name text, provider text, created_at, updated_at)`; RLS so members read / owners write both `messaging_config` and `email_config`.

- [ ] **Step 1: Write the migration**

Create `nudgepay-app/supabase/migrations/0020_channel_settings.sql`:

```sql
-- Phase 14 (subsystem #2): per-org channel config.
--  * messaging_config gains sms_enabled (default true => existing behavior preserved)
--  * messaging_config RLS tightened from member-write to members-read / owners-write,
--    matching org_settings (fixes a pre-existing member-write looseness).
--  * email_config created as disabled groundwork for the future email backend
--    (subsystem #3). No secret/API-key column — provider credentials are a #3 decision.

alter table messaging_config add column sms_enabled boolean not null default true;

-- Retighten messaging_config RLS: replace the member read+write policy with
-- members-read / owners-write (is_org_owner exists from 0016).
drop policy if exists messaging_config_all on messaging_config;
create policy messaging_config_member_read on messaging_config
  for select using (is_org_member(org_id));
create policy messaging_config_owner_write on messaging_config
  for all using (is_org_owner(org_id)) with check (is_org_owner(org_id));

create table email_config (
  org_id uuid primary key references organizations(id) on delete cascade,
  email_enabled boolean not null default false,
  from_address text,
  from_name text,
  provider text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table email_config enable row level security;
create policy email_config_member_read on email_config
  for select using (is_org_member(org_id));
create policy email_config_owner_write on email_config
  for all using (is_org_owner(org_id)) with check (is_org_owner(org_id));
```

- [ ] **Step 2: Apply the migration locally**

Run: `cd nudgepay-app && npx supabase db reset`
Expected: all migrations apply through `0020` with no error.

- [ ] **Step 3: Write the failing RLS test**

Create `nudgepay-app/tests/messaging-config-rls.test.ts`:

```ts
import { expect, test } from "vitest";
import { serviceClient, makeUserClient } from "./helpers";

test("messaging_config: sms_enabled defaults true; owner writes, member reads only", async () => {
  const svc = serviceClient();
  const { data: org } = await svc.from("organizations").insert({ name: `MC-rls ${Math.random()}` }).select("id").single();
  const orgId = org!.id as string;
  const owner = await makeUserClient(`mc-owner-${Math.random()}@example.com`);
  const member = await makeUserClient(`mc-member-${Math.random()}@example.com`);
  await svc.from("memberships").insert([
    { org_id: orgId, user_id: owner.userId, role: "owner" },
    { org_id: orgId, user_id: member.userId, role: "member" },
  ]);

  // Owner upsert succeeds and default sms_enabled is true on a bare insert.
  const { error: ownErr } = await owner.client.from("messaging_config")
    .upsert({ org_id: orgId, sender: "+15005550006" }, { onConflict: "org_id" });
  expect(ownErr).toBeNull();
  const { data: row } = await svc.from("messaging_config").select("sms_enabled, sender").eq("org_id", orgId).single();
  expect(row!.sms_enabled).toBe(true);
  expect(row!.sender).toBe("+15005550006");

  // Owner can toggle off.
  await owner.client.from("messaging_config").update({ sms_enabled: false }).eq("org_id", orgId);
  const { data: off } = await svc.from("messaging_config").select("sms_enabled").eq("org_id", orgId).single();
  expect(off!.sms_enabled).toBe(false);

  // Member can READ.
  const { data: seen } = await member.client.from("messaging_config").select("sms_enabled").eq("org_id", orgId).maybeSingle();
  expect(seen?.sms_enabled).toBe(false);

  // Member write is blocked by RLS (no error; 0 rows affected).
  await member.client.from("messaging_config").update({ sms_enabled: true }).eq("org_id", orgId);
  const { data: after } = await svc.from("messaging_config").select("sms_enabled").eq("org_id", orgId).single();
  expect(after!.sms_enabled).toBe(false); // unchanged
});

test("email_config: created disabled by default; owner writes, member reads only", async () => {
  const svc = serviceClient();
  const { data: org } = await svc.from("organizations").insert({ name: `EC-rls ${Math.random()}` }).select("id").single();
  const orgId = org!.id as string;
  const owner = await makeUserClient(`ec-owner-${Math.random()}@example.com`);
  const member = await makeUserClient(`ec-member-${Math.random()}@example.com`);
  await svc.from("memberships").insert([
    { org_id: orgId, user_id: owner.userId, role: "owner" },
    { org_id: orgId, user_id: member.userId, role: "member" },
  ]);

  const { error: ownErr } = await owner.client.from("email_config")
    .upsert({ org_id: orgId, from_address: "ar@chancey.test" }, { onConflict: "org_id" });
  expect(ownErr).toBeNull();
  const { data: row } = await svc.from("email_config").select("email_enabled, from_address").eq("org_id", orgId).single();
  expect(row!.email_enabled).toBe(false); // disabled by default
  expect(row!.from_address).toBe("ar@chancey.test");

  const { data: seen } = await member.client.from("email_config").select("email_enabled").eq("org_id", orgId).maybeSingle();
  expect(seen?.email_enabled).toBe(false);

  await member.client.from("email_config").update({ email_enabled: true }).eq("org_id", orgId);
  const { data: after } = await svc.from("email_config").select("email_enabled").eq("org_id", orgId).single();
  expect(after!.email_enabled).toBe(false); // RLS blocked the member write
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd nudgepay-app && npx vitest run tests/messaging-config-rls.test.ts`
Expected: PASS (2 tests). (If it errors that `sms_enabled`/`email_config` don't exist, the reset in Step 2 didn't take — re-run `npx supabase db reset`.)

- [ ] **Step 5: Full suite (no regression from the RLS change)**

Run: `cd nudgepay-app && npx vitest run`
Expected: full suite green (the old `messaging_config_all` policy is gone; existing reads use the service client or member-read, so nothing regresses).

- [ ] **Step 6: Commit**

```bash
git add nudgepay-app/supabase/migrations/0020_channel_settings.sql nudgepay-app/tests/messaging-config-rls.test.ts
git commit -m "feat(settings): channel-config migration (sms_enabled, messaging_config RLS, email_config)"
```

---

### Task 2: Pure `channel-settings.ts`

**Files:**
- Create: `nudgepay-app/app/lib/channel-settings.ts`
- Test: `nudgepay-app/tests/channel-settings.test.ts`

**Interfaces:**
- Produces: `type ChannelSettings = { smsEnabled: boolean }`; `resolveChannelSettings(row: { sms_enabled?: boolean | null } | null | undefined): ChannelSettings` (nullish ⇒ `{ smsEnabled: true }`); `parseChannelSettingsUpdate(form: FormData): { sms_enabled: boolean }` (`sms_enabled` form value `=== "true"`).

- [ ] **Step 1: Write the failing test**

Create `nudgepay-app/tests/channel-settings.test.ts`:

```ts
import { expect, test } from "vitest";
import { resolveChannelSettings, parseChannelSettingsUpdate } from "../app/lib/channel-settings";

function fd(entries: Array<[string, string]>): FormData {
  const f = new FormData();
  for (const [k, v] of entries) f.append(k, v);
  return f;
}

test("resolveChannelSettings: explicit true/false; nullish row or column defaults enabled", () => {
  expect(resolveChannelSettings({ sms_enabled: true })).toEqual({ smsEnabled: true });
  expect(resolveChannelSettings({ sms_enabled: false })).toEqual({ smsEnabled: false });
  expect(resolveChannelSettings({})).toEqual({ smsEnabled: true });        // column absent
  expect(resolveChannelSettings(null)).toEqual({ smsEnabled: true });      // no row
  expect(resolveChannelSettings(undefined)).toEqual({ smsEnabled: true });
});

test("parseChannelSettingsUpdate: only the literal 'true' enables", () => {
  expect(parseChannelSettingsUpdate(fd([["sms_enabled", "true"]]))).toEqual({ sms_enabled: true });
  expect(parseChannelSettingsUpdate(fd([["sms_enabled", "false"]]))).toEqual({ sms_enabled: false });
  expect(parseChannelSettingsUpdate(fd([]))).toEqual({ sms_enabled: false }); // missing => off
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd nudgepay-app && npx vitest run tests/channel-settings.test.ts`
Expected: FAIL — `Cannot find module '../app/lib/channel-settings'`.

- [ ] **Step 3: Write the implementation**

Create `nudgepay-app/app/lib/channel-settings.ts`:

```ts
// Pure parse/resolve for per-org channel settings. No I/O, no node:*, no .server.
// Mirrors org-settings.ts / comm-prefs.ts. SMS-only this phase; email config is
// storage-only groundwork (subsystem #3) and is not represented here yet.

export type ChannelSettings = { smsEnabled: boolean };

export type ChannelSettingsRow = { sms_enabled?: boolean | null };

// A missing row or missing column means SMS is ENABLED (preserves the pre-toggle
// default — orgs without a messaging_config row still send).
export function resolveChannelSettings(row: ChannelSettingsRow | null | undefined): ChannelSettings {
  if (!row || row.sms_enabled == null) return { smsEnabled: true };
  return { smsEnabled: row.sms_enabled === true };
}

// The Settings toggle posts an explicit "true"/"false"; anything else is off.
export function parseChannelSettingsUpdate(form: FormData): { sms_enabled: boolean } {
  return { sms_enabled: form.get("sms_enabled") === "true" };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd nudgepay-app && npx vitest run tests/channel-settings.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck**

Run: `cd nudgepay-app && npx react-router typegen && npx tsc -b`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add nudgepay-app/app/lib/channel-settings.ts nudgepay-app/tests/channel-settings.test.ts
git commit -m "feat(settings): pure channel-settings parse/resolve + tests"
```

---

### Task 3: Server enforcement — `sendInvoiceText` gate + send-path surfacing

**Files:**
- Modify: `nudgepay-app/app/lib/twilio-messaging.server.ts`
- Modify: `nudgepay-app/app/routes/api.text.send.tsx`
- Modify: `nudgepay-app/app/routes/api.bulk-sms.tsx`
- Test: `nudgepay-app/tests/twilio-send.test.ts` (extend)

**Interfaces:**
- Consumes: `messaging_config.sms_enabled` (Task 1).
- Produces: `sendInvoiceText` throws `Error("SMS disabled for this workspace")` when the org has `sms_enabled = false`; `/api/text/send` maps it to `sms=disabled`; `/api/bulk-sms` short-circuits to `bulkSms=disabled`.

- [ ] **Step 1: Write the failing test**

In `nudgepay-app/tests/twilio-send.test.ts`, add after the existing `do_not_text` test:

```ts
test("sendInvoiceText refuses when the org has SMS disabled (no Twilio call, no row)", async () => {
  const { orgId, customerId, invoiceId } = await seed(true, "+12295550166");
  await svc.from("messaging_config").insert({ org_id: orgId, sms_enabled: false });
  const fetchFn = vi.fn();
  await expect(sendInvoiceText(deps(fetchFn), { orgId, invoiceId, userId, body: "x" }))
    .rejects.toThrow(/disabled/i);
  expect(fetchFn).not.toHaveBeenCalled();
  const { data: rows } = await svc.from("text_messages").select("id").eq("customer_id", customerId);
  expect(rows ?? []).toHaveLength(0);
});

test("sendInvoiceText sends when sms_enabled is true", async () => {
  const { orgId, invoiceId } = await seed(true, "+12295550177");
  await svc.from("messaging_config").insert({ org_id: orgId, sms_enabled: true });
  const fetchFn = vi.fn(async () => jsonResponse({ sid: "SM-ON", status: "queued" }));
  const res = await sendInvoiceText(deps(fetchFn), { orgId, invoiceId, userId, body: "ok" });
  expect(res.sid).toBe("SM-ON");
  expect(fetchFn).toHaveBeenCalledOnce();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd nudgepay-app && npx vitest run tests/twilio-send.test.ts -t "SMS disabled"`
Expected: FAIL — the send currently succeeds (no gate), so `rejects.toThrow(/disabled/i)` fails.

- [ ] **Step 3: Add the gate in `sendInvoiceText`**

In `nudgepay-app/app/lib/twilio-messaging.server.ts`, inside `sendInvoiceText`, add the org-level check immediately after the customer is loaded and before the consent/contact-block logic — i.e. right after the `if (!cust.sms_consent) throw new Error("Customer has not consented to SMS");` line is the latest it can go, but place it at the top of the function's checks for clarity. Insert this block immediately after the `if (!cust?.phone) throw new Error("Customer has no phone number");` line:

```ts
  // Org-level SMS switch (Phase 14). Absent row => enabled (default). This single
  // gate also covers /api/bulk-sms, which sends via this function.
  const { data: mc } = await deps.service.from("messaging_config")
    .select("sms_enabled").eq("org_id", args.orgId).maybeSingle();
  if (mc && mc.sms_enabled === false) throw new Error("SMS disabled for this workspace");
```

- [ ] **Step 4: Run the send tests**

Run: `cd nudgepay-app && npx vitest run tests/twilio-send.test.ts`
Expected: PASS (all, incl. the two new tests; the gate runs before `sendSms`, so the disabled case makes no Twilio call).

- [ ] **Step 5: Map the disabled outcome in `/api/text/send`**

In `nudgepay-app/app/routes/api.text.send.tsx`, in the `catch` block, add a `disabled` arm to the reason chain. Replace:

```ts
    const reason = /blocked/i.test(msg) ? "blocked"
      : /opted out/i.test(msg) ? "optout"
      : /consent/i.test(msg) ? "noconsent"
      : "error";
```

with:

```ts
    const reason = /disabled/i.test(msg) ? "disabled"
      : /blocked/i.test(msg) ? "blocked"
      : /opted out/i.test(msg) ? "optout"
      : /consent/i.test(msg) ? "noconsent"
      : "error";
```

- [ ] **Step 6: Short-circuit `/api/bulk-sms` when SMS is disabled**

In `nudgepay-app/app/routes/api.bulk-sms.tsx`, after `const service = createSupabaseServiceClient(env);` (and before building `deps`/calling `runBulkSms`), add an early org-level check so a disabled org gets a clean banner instead of N per-case failures:

```ts
  const { data: mc } = await service.from("messaging_config")
    .select("sms_enabled").eq("org_id", org.org_id).maybeSingle();
  if (mc && mc.sms_enabled === false) {
    return redirect(withParams(returnTo, { bulkSms: "disabled" }), { headers });
  }
```

- [ ] **Step 7: Typecheck + build + full suite**

Run: `cd nudgepay-app && npx react-router typegen && npx tsc -b && npx react-router build && npx vitest run`
Expected: tsc 0; build clean; suite green.

- [ ] **Step 8: Commit**

```bash
git add nudgepay-app/app/lib/twilio-messaging.server.ts nudgepay-app/app/routes/api.text.send.tsx nudgepay-app/app/routes/api.bulk-sms.tsx nudgepay-app/tests/twilio-send.test.ts
git commit -m "feat(settings): enforce per-org SMS switch in sendInvoiceText + send paths"
```

---

### Task 4: Settings UI toggle + `save_channels` intent

**Files:**
- Modify: `nudgepay-app/app/routes/api.org-settings.tsx`
- Modify: `nudgepay-app/app/routes/settings.tsx`
- Test: `nudgepay-app/tests/messaging-config-rls.test.ts` (extend with the upsert-preserves-sender assertion)

**Interfaces:**
- Consumes: `parseChannelSettingsUpdate` / `resolveChannelSettings` (Task 2); `messaging_config.sms_enabled` (Task 1).
- Produces: `/api/org-settings` handles `intent=save_channels` (owner-gated upsert of `messaging_config.sms_enabled`); `settings.tsx` loader returns `messaging.smsEnabled`; the page renders an owner SMS toggle.

- [ ] **Step 1: Add the `save_channels` intent**

In `nudgepay-app/app/routes/api.org-settings.tsx`, add the import at the top:

```ts
import { parseChannelSettingsUpdate } from "../lib/channel-settings";
```

Then add this block after the existing `if (intent === "save_rules") { ... }` block (the owner guard above it already applies):

```ts
  if (intent === "save_channels") {
    const { sms_enabled } = parseChannelSettingsUpdate(form);
    // Upsert only org_id + sms_enabled; an existing row's sender / messaging_service_sid
    // are left untouched (upsert updates just the provided columns on conflict).
    const { error } = await supabase.from("messaging_config")
      .upsert({ org_id: org.org_id, sms_enabled }, { onConflict: "org_id" });
    if (error) return redirect(flag(returnTo, "error", "save"), { headers });
    return redirect(flag(returnTo, "saved", "1"), { headers });
  }
```

- [ ] **Step 2: Write the failing test (upsert preserves sender; owner-only)**

In `nudgepay-app/tests/messaging-config-rls.test.ts`, add:

```ts
test("save_channels upsert toggles sms_enabled and preserves an existing sender", async () => {
  const svc = serviceClient();
  const { data: org } = await svc.from("organizations").insert({ name: `MC-up ${Math.random()}` }).select("id").single();
  const orgId = org!.id as string;
  const owner = await makeUserClient(`mc-up-owner-${Math.random()}@example.com`);
  await svc.from("memberships").insert({ org_id: orgId, user_id: owner.userId, role: "owner" });

  // Seed a sender (simulating operator provisioning).
  await svc.from("messaging_config").insert({ org_id: orgId, sender: "+15005550009", sms_enabled: true });

  // Mirror the route's upsert: only org_id + sms_enabled.
  await owner.client.from("messaging_config").upsert({ org_id: orgId, sms_enabled: false }, { onConflict: "org_id" });

  const { data: row } = await svc.from("messaging_config").select("sms_enabled, sender").eq("org_id", orgId).single();
  expect(row!.sms_enabled).toBe(false);
  expect(row!.sender).toBe("+15005550009"); // preserved
});
```

- [ ] **Step 3: Run it**

Run: `cd nudgepay-app && npx vitest run tests/messaging-config-rls.test.ts`
Expected: PASS (3 tests — the two from Task 1 plus this).

- [ ] **Step 4: Loader returns `smsEnabled`**

In `nudgepay-app/app/routes/settings.tsx`:

Add the import:

```ts
import { resolveChannelSettings } from "../lib/channel-settings";
```

Change the messaging read + return. Replace:

```ts
  const { data: msg } = await supabase.from("messaging_config")
    .select("sender, messaging_service_sid").eq("org_id", org.org_id).maybeSingle();
  const sender = (msg?.sender as string | null) ?? null;
  const messagingConfigured = Boolean(msg?.messaging_service_sid || msg?.sender);
```

with:

```ts
  const { data: msg } = await supabase.from("messaging_config")
    .select("sender, messaging_service_sid, sms_enabled").eq("org_id", org.org_id).maybeSingle();
  const sender = (msg?.sender as string | null) ?? null;
  const messagingConfigured = Boolean(msg?.messaging_service_sid || msg?.sender);
  const smsEnabled = resolveChannelSettings(msg as { sms_enabled?: boolean | null } | null).smsEnabled;
```

Then add `smsEnabled` to the `messaging` object in the returned `data(...)`. Replace:

```ts
    messaging: { sender, configured: messagingConfigured },
```

with:

```ts
    messaging: { sender, configured: messagingConfigured, smsEnabled },
```

- [ ] **Step 5: Render the owner toggle in the Text-messaging panel**

In `nudgepay-app/app/routes/settings.tsx`, replace the entire Text-messaging `<section>` (the one with `<h2>Text messaging</h2>`) with:

```tsx
          {/* Text messaging (G2 sender read-only; Phase 14 SMS toggle) */}
          <section className="rounded-lg border border-border bg-surface p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-base font-semibold text-text">Text messaging</h2>
              {d.isOwner ? (
                <Form method="post" action="/api/org-settings">
                  <input type="hidden" name="intent" value="save_channels" />
                  <input type="hidden" name="returnTo" value="/settings" />
                  <label className="sr-only" htmlFor="sms-enabled">SMS enabled</label>
                  <select
                    id="sms-enabled" name="sms_enabled" defaultValue={d.messaging.smsEnabled ? "true" : "false"}
                    onChange={(e) => e.currentTarget.form?.requestSubmit()}
                    className="h-8 rounded-md border border-border bg-panel px-2 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
                  >
                    <option value="true">On</option>
                    <option value="false">Off</option>
                  </select>
                </Form>
              ) : (
                <span className={`text-xs font-medium ${d.messaging.smsEnabled ? "text-cool" : "text-muted"}`}>
                  {d.messaging.smsEnabled ? "On" : "Off"}
                </span>
              )}
            </div>
            <dl className="mt-2 flex flex-col gap-1 text-sm">
              <div className="flex gap-2"><dt className="text-muted w-28">From</dt><dd className="text-text tabular-nums">{d.messaging.sender ?? "Not provisioned"}</dd></div>
              <div className="flex gap-2"><dt className="text-muted w-28">Status</dt><dd className={d.messaging.configured ? "text-cool" : "text-muted"}>{d.messaging.configured ? "Set up" : "Not provisioned"}</dd></div>
            </dl>
            <p className="mt-2 text-xs text-muted">Text-message carrier registration is managed by NudgePay.</p>
            {!d.messaging.smsEnabled ? (
              <p className="mt-1 text-xs text-hot">Outbound texts are turned off — composers are disabled and sends are blocked.</p>
            ) : null}
          </section>
```

(`Form` is already imported in `settings.tsx`.)

- [ ] **Step 6: Typecheck + build + full suite**

Run: `cd nudgepay-app && npx react-router typegen && npx tsc -b && npx react-router build && npx vitest run`
Expected: tsc 0; build clean; suite green.

- [ ] **Step 7: Commit**

```bash
git add nudgepay-app/app/routes/api.org-settings.tsx nudgepay-app/app/routes/settings.tsx nudgepay-app/tests/messaging-config-rls.test.ts
git commit -m "feat(settings): owner SMS on/off toggle (save_channels)"
```

---

### Task 5: Composer UI enforcement (dashboard + Messages)

**Files:**
- Modify: `nudgepay-app/app/routes/dashboard.tsx`
- Modify: `nudgepay-app/app/routes/messages.tsx`
- Modify: `nudgepay-app/app/components/DetailPanel.tsx`
- Modify: `nudgepay-app/app/components/MessageThreadPanel.tsx`

**Interfaces:**
- Consumes: `messaging_config.sms_enabled` (Task 1), `resolveChannelSettings` (Task 2).
- Produces: both loaders return `smsEnabled: boolean`; both composers disable Send + show a reason when `!smsEnabled`, and render a `sms=disabled` banner.

No new unit tests (no render-test infra; loaders have no unit tests by project convention). Verified by typecheck + build + full suite.

- [ ] **Step 1: `dashboard.tsx` loader exposes `smsEnabled` and passes it to `DetailPanel`**

In `nudgepay-app/app/routes/dashboard.tsx`:

Add the import:

```ts
import { resolveChannelSettings } from "../lib/channel-settings";
```

In the loader, after the org is resolved and a Supabase client is available (near the other org-scoped reads), add:

```ts
  const { data: mcfg } = await supabase.from("messaging_config")
    .select("sms_enabled").eq("org_id", org.org_id).maybeSingle();
  const smsEnabled = resolveChannelSettings(mcfg as { sms_enabled?: boolean | null } | null).smsEnabled;
```

Add `smsEnabled` to the loader's returned `data({...})` object (alongside `sms`, `repInvoiceId`, etc.).

Then in the JSX, pass it to the `DetailPanel` render (the `<DetailPanel ... />` block):

```tsx
                  smsEnabled={smsEnabled}
```

(Read `smsEnabled` from the destructured loader data at the top of the component, next to `sms`/`repInvoiceId`.)

- [ ] **Step 2: `DetailPanel.tsx` — accept `smsEnabled`, gate the composer**

In `nudgepay-app/app/components/DetailPanel.tsx`:

Add `disabled` to the `SMS_BANNER` map:

```tsx
const SMS_BANNER: Record<string, { text: string; tone: string }> = {
  sent:      { text: "Text sent.",                                                    tone: "text-cool" },
  noconsent: { text: "Not sent — customer has not consented to SMS.",                 tone: "text-hot" },
  optout:    { text: "Not sent — customer opted out of texts.",                       tone: "text-hot" },
  error:     { text: "Could not send the text.",                                      tone: "text-hot" },
  blocked:   { text: "Not sent — this case is marked do-not-contact / legal.",        tone: "text-hot" },
  disabled:  { text: "Not sent — text messaging is turned off for this workspace.",   tone: "text-hot" },
};
```

Thread `smsEnabled` into the component: add `smsEnabled: boolean;` to the `DetailPanel` props type and destructure it; add `smsEnabled` to the `MessagesTab` props type and destructure it; pass `smsEnabled={smsEnabled}` where `DetailPanel` renders `<MessagesTab ... />`.

In `MessagesTab`, update the Send disabled condition and reason. Replace the disabled-reason `<span>` chain and the button `disabled=` expression:

```tsx
            {contactBlocked ? (
              <span className="text-xs text-hot">Messaging blocked — {exceptionLabel(selected.exceptionReason)}.</span>
            ) : noInvoice ? (
              <span className="text-xs text-muted">No invoice to reference.</span>
            ) : !consent ? (
              <span className="text-xs text-muted">Mark consent to enable sending.</span>
            ) : prefs.doNotText ? (
              <span className="text-xs text-hot">Customer opted out of texts.</span>
            ) : !phone ? (
              <span className="text-xs text-muted">Customer has no phone number.</span>
            ) : <span />}
            <button
              type="submit"
              disabled={!canSendSms(prefs, consent) || noInvoice || contactBlocked || !phone}
```

with (add the `!smsEnabled` branch first, and to the `disabled` expression):

```tsx
            {!smsEnabled ? (
              <span className="text-xs text-hot">Text messaging is turned off for this workspace.</span>
            ) : contactBlocked ? (
              <span className="text-xs text-hot">Messaging blocked — {exceptionLabel(selected.exceptionReason)}.</span>
            ) : noInvoice ? (
              <span className="text-xs text-muted">No invoice to reference.</span>
            ) : !consent ? (
              <span className="text-xs text-muted">Mark consent to enable sending.</span>
            ) : prefs.doNotText ? (
              <span className="text-xs text-hot">Customer opted out of texts.</span>
            ) : !phone ? (
              <span className="text-xs text-muted">Customer has no phone number.</span>
            ) : <span />}
            <button
              type="submit"
              disabled={!smsEnabled || !canSendSms(prefs, consent) || noInvoice || contactBlocked || !phone}
```

- [ ] **Step 3: `messages.tsx` loader exposes `smsEnabled` and passes it to `MessageThreadPanel`**

In `nudgepay-app/app/routes/messages.tsx`:

Add the import:

```ts
import { resolveChannelSettings } from "../lib/channel-settings";
```

In the loader, near the other reads, add (the `supabase` user client is in scope):

```ts
  const { data: mcfg } = await supabase.from("messaging_config")
    .select("sms_enabled").eq("org_id", org.org_id).maybeSingle();
  const smsEnabled = resolveChannelSettings(mcfg as { sms_enabled?: boolean | null } | null).smsEnabled;
```

Add `smsEnabled` to the returned `data({...})`. In the page component, destructure `d.smsEnabled` and pass it to `MessageThreadPanel`:

```tsx
            smsEnabled={d.smsEnabled}
```

- [ ] **Step 4: `MessageThreadPanel.tsx` — accept `smsEnabled`, gate the composer**

In `nudgepay-app/app/components/MessageThreadPanel.tsx`:

Add `disabled` to `SMS_BANNER`:

```tsx
  disabled: { text: "Not sent — text messaging is turned off for this workspace.", tone: "text-hot" },
```

Add `smsEnabled: boolean;` to the `Props` interface and to the destructured params. Then update the composer's disabled state + reason. Replace:

```tsx
          <div className="flex items-center justify-between gap-2">
            {thread.canReply ? <span /> : <span className="text-xs text-muted">{thread.replyDisabledReason}</span>}
            <button
              type="submit" disabled={!thread.canReply}
```

with:

```tsx
          <div className="flex items-center justify-between gap-2">
            {!smsEnabled ? (
              <span className="text-xs text-hot">Text messaging is turned off for this workspace.</span>
            ) : thread.canReply ? <span /> : <span className="text-xs text-muted">{thread.replyDisabledReason}</span>}
            <button
              type="submit" disabled={!smsEnabled || !thread.canReply}
```

- [ ] **Step 5: Typecheck + build + full suite**

Run: `cd nudgepay-app && npx react-router typegen && npx tsc -b && npx react-router build && npx vitest run`
Expected: tsc 0 (both composer props wired); build clean; suite green.

- [ ] **Step 6: Commit**

```bash
git add nudgepay-app/app/routes/dashboard.tsx nudgepay-app/app/routes/messages.tsx nudgepay-app/app/components/DetailPanel.tsx nudgepay-app/app/components/MessageThreadPanel.tsx
git commit -m "feat(settings): disable composers when org SMS is off"
```

- [ ] **Step 7: Record the phase in the gap checklist (docs)**

Append a section to `docs/superpowers/2026-06-23-nudgepay-requirements-gap-checklist.md` (REPO ROOT) — a "## L. Settings channel config — Phase 14" entry mirroring the prior tab sections, recording: per-org SMS on/off toggle (owner-only, server-enforced in `sendInvoiceText` covering single + bulk; composers disabled), `messaging_config` RLS tightened member-write → owner-write, disabled `email_config` groundwork for subsystem #3 (no email UI/sending/secret column), sender editing deliberately dropped. Note gates (vitest count, tsc 0, build clean) and the deferred live-Chrome pass. Commit:

```bash
git add docs/superpowers/2026-06-23-nudgepay-requirements-gap-checklist.md
git commit -m "docs: record Phase 14 channel config in gap checklist"
```

---

## Self-Review

**1. Spec coverage:**
- §5.1 migration (sms_enabled + RLS retighten + email_config) → Task 1. ✅
- §5.2 pure `channel-settings.ts` → Task 2. ✅
- §5.3 `save_channels` intent → Task 4. ✅
- §5.4 `sendInvoiceText` gate → Task 3. ✅
- §5.5 `/api/text/send` `disabled` mapping + `/api/bulk-sms` short-circuit → Task 3. ✅
- §5.6 settings loader + owner toggle → Task 4. ✅
- §5.7 composer enforcement (loaders + DetailPanel + MessageThreadPanel) → Task 5. ✅
- §6 security (owner-write RLS + surface gate; tightened messaging_config; email_config) → Tasks 1, 4. ✅
- §7 edges (no row ⇒ enabled; mid-session disable; bulk; non-owner; inbound unaffected) → Task 1 default, Task 3 gate, Task 4 owner gate. ✅
- §8 tests (channel-settings pure; messaging_config/email_config RLS; sendInvoiceText gate; save_channels) → Tasks 1, 2, 3, 4. ✅
- §11 out-of-scope (email sending, sender editing, Call toggle) → not built; email_config is groundwork only. ✅

**2. Placeholder scan:** No "TBD"/"handle errors"/"similar to". Every code step shows complete code or an exact edit. ✅

**3. Type consistency:** `resolveChannelSettings(row) → { smsEnabled }` and `parseChannelSettingsUpdate(form) → { sms_enabled }` are used identically in Tasks 2/4/5. The loader cast `{ sms_enabled?: boolean | null } | null` matches `ChannelSettingsRow`. `smsEnabled` prop name is consistent across loaders → `DetailPanel`/`MessageThreadPanel`. The `disabled` banner key + `sms=disabled` reason align across `api.text.send` (Task 3) and both composers (Task 5). ✅

**Note on a spec→plan refinement:** the spec's §5.2 sketched a `ChannelParseResult` discriminated union for `parseChannelSettingsUpdate`; the plan simplifies it to return `{ sms_enabled: boolean }` directly, since a boolean toggle has no invalid state (YAGNI). Internally consistent across all consumers.
