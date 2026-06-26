# NudgePay C3 — Channel Rationalization (Design Spec)

**Created:** 2026-06-26
**Phase:** 8 (P1 throughput & consistency) — final Phase-8 gap item
**Gap item:** C3 — "Email & click-to-call channels. Add click-to-call; add an email composer (or clearly mark email as log-only so the UI doesn't imply capture we lack). SMS two-way is done."
**Builds on:** C6 communication preferences (`comm-prefs.ts`, `channelBlocked`, `do_not_call`); the contact-log pipeline (`contact-log.ts`, `api.contact-logs`, `LogContactDrawer`); the dashboard DetailPanel action row; the case pipeline (`cases.ts`, `worklist.ts`).

---

## 1. Problem

The checklist frames C3 as "add" work, but the channels already exist as **bare, dishonest, unenforced** affordances:

- The DetailPanel action row already renders a `tel:` **Call** link and a `mailto:` **Email** link. Neither consults the customer's C6 opt-outs (`do_not_call` / `do_not_email`) — C6 shipped `channelBlocked()` and deliberately left these advisory "until C3."
- **There is no email-sending backend** — confirmed: no transactional-email provider (SendGrid/SES/Postmark/Resend/SMTP), no `email_messages` thread model. The `mailto:` link opens the rep's *own* mail client; NudgePay neither sends nor captures the message. The "Email" button therefore *implies a capability the product does not have* — exactly the dishonesty the checklist warns against.
- **Call and email leave no record.** SMS auto-logs to the per-customer thread; clicking Call or Email captures nothing, so the timeline cannot show those touches.

## 2. Goal

Make NudgePay's outbound channels honest and consistent: **call + text only.**

- **Purge email entirely** as a channel — no `mailto:` button, not a loggable contact method, not a communication preference. Email is not a capability NudgePay offers.
- **Make click-to-call first-class:** enforce `do_not_call` on the Call action (parallel to SMS send-gating), and capture the call by opening the existing Log-contact flow pre-filled with `method=call`.

`sms_consent` and the SMS two-way path are untouched. The customer's email *address* remains visible as passive reference contact data (it is QBO-synced, like the customer name) — only its channel *affordances* are removed.

Non-goals (YAGNI / deferred): see §9.

## 3. Decisions (locked during brainstorming)

| Decision | Choice |
|---|---|
| Email handling | **Remove email entirely** as a channel (button, loggable method, comm-prefs). No backend is built. |
| Email-removal strategy | **Amend C6 (unmerged PR #11)** so email never ships, keeping the purge atomic (no half-removed intermediate state). C3 is then purely additive (click-to-call). |
| Email address display | **Keep** the email address as passive reference (Overview InfoRow). It is contact data, not a channel affordance. |
| Historical email logs | **Preserve rendering.** Old `contact_logs` with `method='email'` keep their timeline icon/label. Only the *input* method list loses email. |
| Click-to-call enforcement | **Enforce `do_not_call`:** when opted out, render Call disabled-with-reason instead of a live `tel:` link (parallels SMS send-gating). Still hidden when the customer has no phone. |
| Click-to-call capture | **Auto-open the Log drawer** pre-filled `method=call` after the `tel:` handoff, via a URL param the existing `LogContactDrawer` reads as its method default. Reuses all existing log infrastructure. |

## 4. Architecture & work split

The change spans two surfaces that live in different PRs. Email removal is done **atomically inside the C6 amend** so no PR ever ships a half-removed email channel.

### Part A — Amend C6 (PR #11): email never existed

Executed on `phase8-c6-comm-preferences`; force-pushed to update PR #11. Reworks C6 to ship **call + text only**.

- **`supabase/migrations/0017_comm_preferences.sql`** (edit in place — 0017 has not shipped to any remote): narrow `preferred_channel` CHECK to `in ('call','text')`; **drop** the `do_not_email` column entirely (add only `do_not_call` + `do_not_text`). Local dev requires `supabase db reset` to re-apply an edited, already-applied migration.
- **`app/lib/comm-prefs.ts`**: `CHANNELS = ['call','text']`; remove `doNotEmail` from `CommPrefs`, `DEFAULT_COMM_PREFS`, `CommPrefsRow`; remove the `email` arm from `isChannel` and `channelBlocked`; remove `do_not_email` from `resolveCommPrefs`.
- **`app/routes/api.comm-prefs.tsx`** (`parseCommPrefsUpdate`): drop `do_not_email`; `preferred_channel` parses only `call`/`text`.
- **`app/components/CommPrefsDrawer.tsx`**: remove the "Do not email" checkbox and the Email option from the preferred-channel select.
- **`app/routes/dashboard.tsx`**: drop `do_not_email` from the customer select and any `InvoiceRow`/embed type.
- **`app/components/WorkQueue.tsx`**: drop the "No email" badge; the preferred-channel badge no longer renders `email`.
- **`app/lib/cases.ts` / `app/lib/worklist.ts`**: types follow `CommPrefs` automatically (no `doNotEmail` field).
- **Tests:** `tests/comm-prefs.test.ts` (no email cases; `channelBlocked` covers call/text), `tests/comm-prefs-schema.test.ts` (`'email'` is now **rejected** alongside `'fax'`; accept `'call'`/`'text'`/NULL), `tests/api-comm-prefs.test.ts` (no `do_not_email`).

### Part B — C3 (new stacked PR): email-action purge + click-to-call

Executed on `phase8-c3-email-click-to-call`, rebased onto the amended C6.

- **`app/lib/contact-log.ts`**: remove `'email'` from `CONTACT_METHODS` (no longer a loggable method). `ContactMethod` narrows to `call`/`text`/`note`.
- **`app/components/DetailPanel.tsx`**:
  - Remove the `mailto:` **Email** action button from the action row.
  - **Click-to-call enforcement:** when `channelBlocked(prefs,'call')` is true and the customer has a phone, render Call as a disabled control with the reason "Customer asked not to be called" instead of the live `tel:` link. (No phone → still omitted, as today.)
  - **Click-to-call capture:** the Call control is an `<a href="tel:…">` with an `onClick` that *also* performs a client-side (React Router) navigation to `?…&log=1&method=call`. The `tel:` handoff opens the OS dialer (it does not unload the SPA), while the in-app navigation opens `LogContactDrawer` pre-filled to `method=call`. (Disabled state renders a non-link span with the reason, no handlers.)
  - **Backwards-compat:** keep the `email → "mail"` entry in `METHOD_ICON` so historical email `contact_logs` still render with an icon in the timeline (activity tab).
- **`app/components/LogContactDrawer.tsx`**: read an optional `method` prop/param to set the method `<select>` default (default remains `call` when absent). The `<select>` options come from the narrowed `CONTACT_METHODS` (no email). The drawer's `METHOD_LABEL` email entry becomes dead and is removed; historical-log rendering lives in the timeline, not the input drawer.
- **`app/routes/dashboard.tsx`**: thread the `method` param from the URL into `LogContactDrawer` when opening the log drawer.

## 5. Data flow

1. Loader (`dashboard.tsx`) selects customer comm-pref columns (`preferred_channel`, `do_not_call`, `do_not_text`) and maps them once via `resolveCommPrefs` at the loader boundary into `CommPrefs` on the selected case.
2. DetailPanel's action row reads `channelBlocked(prefs,'call')` to decide live vs. disabled Call.
3. Clicking Call: browser follows `tel:`; the same control carries the rep to `?…&log=1&method=call`, so the dashboard mounts `LogContactDrawer` with `method=call` preselected.
4. The drawer posts to the unchanged `api.contact-logs` action, which writes the `contact_logs` row (method `call`) and applies the next-step.

## 6. Error / edge handling

- **No phone:** Call action omitted (unchanged behavior).
- **`do_not_call` set:** Call rendered disabled-with-reason; no `tel:` navigation, no log pre-open.
- **Historical `method='email'` logs:** render with the mail icon and "Email" label; never offered as a new input.
- **Migration re-apply:** editing an already-applied `0017` requires `supabase db reset` locally; documented in the plan. No remote data exists (0017 unshipped), so no data backfill for dropped `do_not_email` / narrowed CHECK.
- **`preferred_channel='email'` rows:** none can exist (0017 never shipped email); the narrowed CHECK is safe.

## 7. Testing (TDD)

**Part A (C6 amend):**
- `comm-prefs.test.ts`: `resolveCommPrefs` maps call/text rows and nullish → defaults; unknown / `email` `preferred_channel` → `null`; `channelBlocked` covers `call` and `text`; `canSendSms` truth table unchanged.
- `comm-prefs-schema.test.ts`: `customers` accepts `preferred_channel` `'call'`/`'text'`/NULL; **rejects** `'email'` and `'fax'`.
- `api-comm-prefs.test.ts`: `parseCommPrefsUpdate` produces no `do_not_email` key; RLS write persists call/text prefs and leaves `sms_consent` untouched.

**Part B (C3):**
- `contact-log.test.ts`: `parseContactLogForm` rejects `method=email` (`bad-method`); accepts `call`/`text`/`note`.
- A component/render test that the Call action is suppressed-with-reason when `do_not_call` is true (phone present), and live otherwise; and that `LogContactDrawer` preselects `method=call` when given the param.

**Gates (unchanged):** `npx vitest run` green · `npx tsc --noEmit` exit 0 · `npx react-router build` clean.

## 8. Execution & branch mechanics

1. Switch to `phase8-c6-comm-preferences`; apply Part A; `supabase db reset`; verify gates; commit; **force-push** (updates PR #11).
2. Rebase `phase8-c3-email-click-to-call` onto amended C6.
3. Apply Part B on the C3 branch; verify gates; commit.
4. Finish via the finishing-a-development-branch menu → new C3 PR.

## 9. Out of scope (deferred)

- Any real email sending (transactional provider, domain auth, bounce handling, an `email_messages` thread model, a composer). Not built; email is removed, not stubbed.
- Auto-logging a call without rep confirmation (the drawer still requires outcome + next-step — no thin outcome-less records).
- Telephony integration (Twilio Voice, call recording, click-to-dial via a softphone). The `tel:` handoff to the OS dialer is the mechanism.
- Re-introducing email later — would be its own spec/phase with a real backend.
