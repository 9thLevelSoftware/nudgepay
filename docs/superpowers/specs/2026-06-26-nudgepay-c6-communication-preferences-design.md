# NudgePay C6 — Communication Preferences (Design Spec)

**Created:** 2026-06-26
**Phase:** 8 (P1 throughput & consistency)
**Gap item:** C6 — "Communication preferences. Beyond `sms_consent` + STOP handling: preferred channel/contact, per-channel preference."
**Builds on:** the `customers` table (`email`/`phone`/`sms_consent`, 0001), STOP/START consent handling (`twilio-messaging.server.ts`), bulk SMS eligibility (`bulk.ts`/`bulk-send.server.ts`, 8a/C5), single SMS send (`twilio-messaging.server.ts`/`api.text.send`), the case pipeline (`cases.ts`), and the dashboard case surface.

---

## 1. Problem

Today the only customer communication signal is a single `sms_consent boolean` plus STOP/START keyword handling that flips it. A rep cannot record that a customer **prefers** to be reached one way, or that a customer has asked **not** to be contacted on a specific channel. The blunt "contact blocked" exception (do_not_contact / legal_agency) is all-or-nothing. C6 adds richer per-customer communication preferences: a preferred channel and per-channel opt-outs.

## 2. Goal

Let reps capture and act on per-customer communication preferences:

- A **preferred channel** (call / text / email, or none) — informational, guides the rep.
- **Per-channel opt-outs** (do-not-call / do-not-email / do-not-text) — enforced where an outbound path exists.

`sms_consent` remains the **legal** consent record (TCPA/A2P; STOP clears it). The new flags are customer **preferences** — a distinct layer. SMS is allowed only when `sms_consent AND NOT do_not_text`.

Non-goals (YAGNI / deferred): see §10.

## 3. Decisions (locked during brainstorming)

| Decision | Choice |
|---|---|
| Preference model | **Both** a preferred channel and per-channel opt-outs. |
| Enforcement | **Enforce where a path exists, advise elsewhere.** `do_not_text` layers on `sms_consent` for SMS send/bulk; `do_not_call`/`do_not_email` are advisory badges now, enforceable when C3 ships. Preferred-channel is informational. |
| `sms_consent` relationship | **Kept separate.** Legal consent ≠ preference. `canSendSms = sms_consent && !do_not_text`. STOP still clears `sms_consent` only. Setting `do_not_text` does not touch `sms_consent`. |
| Capture surface | **Dedicated per-customer preferences panel** (slide-over opened from a case). |
| Preferred-channel model | **Single** preferred channel: `call` / `text` / `email` / none (NULL). Channels match the contact-log methods. |
| Storage | Columns on `customers` (1:1, alongside `sms_consent`). No new table. |
| Write path | RLS-scoped user client (the `customers_all` policy already permits org-member CRUD), mirroring `api.sms-consent`. No service client, no new RLS. |

## 4. Architecture

- **`app/lib/comm-prefs.ts`** (new, **pure** — no I/O, no `node:*`, no `.server`; imported by routes + tests + components): types + `resolveCommPrefs` + `canSendSms` + `channelBlocked`. Single source of truth for SMS eligibility and badge state.
- **`supabase/migrations/0017_comm_preferences.sql`** (new): four columns on `customers` + a CHECK on `preferred_channel`. No RLS changes (`customers_all` already governs).
- **`app/lib/bulk.ts`** (modify): new skip reason `"do-not-text"`; `TextableCase` gains `doNotText`; eligibility order updated.
- **`app/lib/bulk-send.server.ts`** (modify): select + thread `do_not_text`.
- **`app/lib/twilio-messaging.server.ts`** (modify): single-send selects `do_not_text` and blocks with a distinct error.
- **`app/routes/api.text.send.tsx`** (modify): map the opt-out error to a new `reason`.
- **`app/routes/api.comm-prefs.tsx`** (new): RLS-scoped action that resolves the customer via an org-readable case/invoice and updates the four columns.
- **`app/lib/cases.ts`** (modify): `CaseItem` carries a compact prefs summary for badges.
- **`app/routes/dashboard.tsx`** (modify): select the new columns; open the panel via a URL param; render badges.
- **`app/components/`** (new panel component): the dedicated preferences slide-over.

## 5. Data model

`0017_comm_preferences.sql` adds to `customers`:

```sql
alter table customers
  add column preferred_channel text
    check (preferred_channel in ('call','text','email')),
  add column do_not_call  boolean not null default false,
  add column do_not_email boolean not null default false,
  add column do_not_text  boolean not null default false;
```

- `preferred_channel` is nullable; `NULL` = "no preference". The CHECK rejects any value outside the three channels (a NULL passes a CHECK by SQL semantics, which is the intended "no preference").
- The three opt-outs default `false` (no existing customer is opted out on import).
- RLS: the existing `customers_all` policy (`for all using is_org_member(org_id) with check is_org_member(org_id)`) already governs both reads and writes. No new policy.

## 6. Pure logic — `app/lib/comm-prefs.ts`

```ts
export const CHANNELS = ["call", "text", "email"] as const;
export type Channel = (typeof CHANNELS)[number];

export type CommPrefs = {
  preferredChannel: Channel | null;
  doNotCall: boolean;
  doNotEmail: boolean;
  doNotText: boolean;
};

export const DEFAULT_COMM_PREFS: CommPrefs = {
  preferredChannel: null, doNotCall: false, doNotEmail: false, doNotText: false,
};

// Map a (possibly partial/nullable) DB row to CommPrefs. Unknown preferred_channel → null.
export function resolveCommPrefs(row: {
  preferred_channel?: string | null;
  do_not_call?: boolean | null;
  do_not_email?: boolean | null;
  do_not_text?: boolean | null;
} | null | undefined): CommPrefs;

// Single source of truth for SMS eligibility: legal consent AND not opted out by preference.
export function canSendSms(prefs: CommPrefs, smsConsent: boolean): boolean;

// Is a given channel opted out (for badge/warning rendering)?
export function channelBlocked(prefs: CommPrefs, channel: Channel): boolean;
```

- `resolveCommPrefs(null)` → `DEFAULT_COMM_PREFS`. An unrecognized `preferred_channel` string resolves to `null` (defensive; the DB CHECK already constrains it).
- `canSendSms(prefs, consent)` = `consent && !prefs.doNotText`.
- `channelBlocked(prefs, 'call')` = `prefs.doNotCall`, etc.

## 7. Enforcement (where a path exists)

### 7.1 SMS — enforced now

- **`bulk.ts`**: `SkipReason` gains `"do-not-text"`. `TextableCase` gains `doNotText: boolean`. `partitionEligibility` order: `do-not-contact` → `no-phone` → `no-consent` → `do-not-text`. (Legal consent failure reported before preference opt-out, since `no-consent` is the harder gate.)
- **`bulk-send.server.ts`**: the customer select adds `do_not_text`; the mapped `TextableCase` sets `doNotText: Boolean(cust.do_not_text)`.
- **`twilio-messaging.server.ts`** single send: the per-customer select adds `do_not_text`; after the `!sms_consent` throw, add `if (cust.do_not_text) throw new Error("Customer has opted out of SMS")`.
- **`api.text.send.tsx`**: extend the error→reason mapping so the opt-out throw maps to a distinct `reason` (e.g. `optout`), alongside the existing `blocked`/`noconsent`/`error`.

### 7.2 Call / email — advisory now

`do_not_call` / `do_not_email` have no outbound path until C3 (click-to-call / email composer). C6 surfaces them as warning badges (§8) and does not block anything. When C3 adds those paths, they consult `channelBlocked`.

## 8. Surfaces

### 8.1 Capture — dedicated preferences panel

A "Communication preferences" slide-over opened from a case's action area, pre-filled from loader data (the dashboard already loads per-case customer fields; extend the select to include the four columns). Contents:

- A `preferred_channel` select: **None / Call / Text / Email**.
- Three checkboxes: **Do not call**, **Do not email**, **Do not text**.
- Submits a plain HTML form (POST) to `api.comm-prefs`; on success redirects back to the dashboard with the panel closed.

`api.comm-prefs.tsx` (RLS user client, mirroring `api.sms-consent` exactly):
1. `requireUser` + `resolveOrg`.
2. Read the submitted `invoiceId` (the case's representative/oldest invoice, already on the case row); resolve `customer_id` via `select customer_id from invoices where id = invoiceId` (RLS-scoped, so a foreign invoice resolves to nothing → updates nothing). This is the identical resolution `api.sms-consent` uses.
3. Parse `preferred_channel` (one of the three or empty→NULL) and the three booleans.
4. `update customers set ... where id = customer_id` (RLS-scoped).
5. Redirect back.

The panel is opened keyed by `caseId` in the URL param, but the submitted form carries the case's representative `invoiceId` as the resolution key — reusing the proven path rather than introducing a case→customer lookup.

Setting `do_not_text` here does **not** modify `sms_consent`.

### 8.2 Advise — badges

`cases.ts` `CaseItem` carries a compact summary derived via `resolveCommPrefs` (preferred channel + the three flags). The case row/drawer renders:

- a preferred-channel badge (when set),
- a **Do not text** badge styled as *enforced*,
- **Do not call** / **Do not email** badges styled as *advisory*.

## 9. Testing (TDD)

- **`tests/comm-prefs.test.ts`** (pure): `resolveCommPrefs` maps a full row, tolerates nulls/undefined (→ defaults), and coerces an unknown `preferred_channel` to `null`; `canSendSms` truth table (consent × doNotText → only `true,false`→true); `channelBlocked` per channel.
- **`tests/bulk.test.ts`** (extend): a `doNotText` case partitions to `skipped` with reason `"do-not-text"`; ordering — a case that is both `!smsConsent` and `doNotText` reports `no-consent` (the earlier gate); a clean case still `eligible`.
- **DB-integration:**
  - migration: `org_*`-style insert — `customers` accepts `preferred_channel` in the set and a NULL; rejects an out-of-set value (e.g. `'fax'`).
  - `api.comm-prefs`: an in-org case updates the customer's columns; a foreign `caseId` no-ops (RLS); `sms_consent` is unchanged by a `do_not_text` write.
  - single send: a `do_not_text` customer is blocked (distinct from `!sms_consent`).

## 10. Out of scope (deferred)

- Enforcing `do_not_call` / `do_not_email` (no outbound path until **C3**; they consult `channelBlocked` then).
- STOP auto-setting `do_not_text` (legal consent ≠ preference; STOP clears `sms_consent` only).
- Preferred-channel auto-reordering the work queue or auto-selecting the drawer's default method.
- Ranked channel preferences; bulk preference editing; mail / in-person channels.
- Owner-scoped or audit-trail history of preference changes.
