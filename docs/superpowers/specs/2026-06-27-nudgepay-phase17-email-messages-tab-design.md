# NudgePay Phase 17 — Email in the Messages tab — Design

**Date:** 2026-06-27
**Status:** Approved (design)
**Subsystem:** #3c of the Phase 13 email initiative (#3a outbound → #3b inbound/status → **#3c Messages-tab wiring**)
**Depends on:** Phase 15 (#3a, `email_messages` + composer + `/api/email/send` + `do_not_email`) and Phase 16 (#3b, inbound rows + delivery status). #3c surfaces both channels in the cross-customer inbox.

## Summary

Make the `/messages` inbox **channel-aware**: render email conversations alongside SMS, with a channel filter and per-row channel badge, and a thread panel + reply composer that adapts to the selected channel. The pure deriver `message-inbox.ts` (which already reserves `channel:"sms"`) is generalized so every message carries a channel and every thread row is scoped to one `(customer, channel)` conversation — preserving SMS behavior exactly while adding email.

**Model decision: one row per `(customer, channel)`.** SMS and email are separate conversations because their reply eligibility differs fundamentally (SMS needs TCPA consent + phone; email needs not-opted-out + an address) and their threads are independent message streams. A unified per-customer row would have to collapse two different reply-gates and two message histories into one — confusing and lossy. A channel badge + an "All/SMS/Email" filter give the unified view without merging the data.

**Out of scope:**
- No new send/inbound/status logic — that all lives in #3a/#3b. #3c is read + render + route-the-reply only.
- No changes to the DetailPanel (dashboard) email tab — that shipped in #3a.

## Architecture

### A. Pure deriver changes — `message-inbox.ts`

The single source of inbox truth becomes channel-parametric:

```ts
export type Channel = "sms" | "email";

export type ThreadMessageInput = {
  customerId: string;
  channel: Channel;                 // NEW
  direction: "inbound" | "outbound";
  body: string | null;
  subject: string | null;           // NEW (null for sms)
  status: string | null;
  errorCode: string | null;
  invoiceId: string | null;
  createdAt: string;
};

export type ThreadCustomerInput = {
  customerId: string;
  name: string;
  ownerId: string | null;
  // SMS eligibility inputs:
  smsConsent: boolean;
  commPrefs: CommPrefs;             // now also carries doNotEmail (Phase 15)
  phone: string | null;
  // Email eligibility inputs (NEW):
  email: string | null;
  hasOpenCase: boolean;
  openCaseId: string | null;
  latestInvoiceId: string | null;
};

export type ThreadRow = {
  channel: Channel;                 // now "sms" | "email"
  // ...unchanged fields...
  subjectSnippet: string | null;    // NEW: last email subject (null for sms)
};
```

`buildThreadRows` groups messages by `(customerId, channel)` and emits one row per group that has at least one message. Per row:
- `unansweredInbound`, `needsReply`, `needsAttention`, `anchorInvoiceId`, `lastMessage`, `active` — computed identically to today (channel-agnostic logic).
- `isFailed` gains the email terminal statuses: `bounced`, `complained` (plus the existing `failed`/`undelivered` and any `errorCode`).
- **Reply gate is channel-specific** (a small dispatch):
  - `sms`: unchanged — `canSendSms(commPrefs, smsConsent)` && phone && anchorInvoice; reason ladder unchanged.
  - `email`: `canSendEmail(commPrefs)` && email && anchorInvoice; reason ladder: opted-out → no email on file → no invoice to attach.
- `searchText` unchanged (`name owner`).

`applyMessageTab`, `sortThreadRows`, `computeMessageMetrics` are unchanged — they operate on `ThreadRow[]` regardless of channel. A new `applyChannelFilter(rows, channel)` filters to `"all" | "sms" | "email"`.

### B. Route loader — `messages.tsx`

- Read `email_messages` (user client, org-scoped, `customer_id not null`) alongside the existing `text_messages` read; tag each set with its channel; concatenate into `messagesInput`.
- The customer set is the union of customers referenced by **either** channel. Extend the `customers` select to include `email` and `do_not_email` (the latter already maps via `resolveCommPrefs`).
- Build rows once via the generalized `buildThreadRows`; apply the new channel filter from `?channel=` (default `all`) before tab/sort.
- The selected thread is now keyed by `(customerId, channel)` — add a `?channel=` discriminator to the selection (a customer can have both an SMS and an email thread). Load the selected thread's messages for that channel; for email, include `subject`; compute `selectedVars` the same way.
- Pass `emailEnabled` (from `email_config`, via `resolveEmailSettings`) alongside the existing `smsEnabled`, plus channel counts.

### C. Components

- **MessagesInbox** — each row shows a channel badge (SMS / Email) using warm tokens; selection links carry `&channel=`. Add an "All / SMS / Email" filter control (links preserving tab/sort/q).
- **MessageThreadPanel** — renders the selected `(customer, channel)` thread. For email, show the subject line per outbound/inbound bubble. The composer adapts:
  - SMS: existing composer → `/api/text/send`, SMS templates.
  - Email: subject + body composer → `/api/email/send`, email templates (`EMAIL_TEMPLATES`/`applyEmailTemplate`), gated by `emailEnabled` + the row's `canReply`/`replyDisabledReason`.
  - Result banners: `?sms=` and `?email=` both handled.
- **MessagesMetrics** — unchanged (channel-agnostic counts); optionally note counts now span both channels.

## Data flow

1. Loader reads both `text_messages` and `email_messages`, tags channel, unions customers, builds `(customer, channel)` rows.
2. `?channel=` filters; `?tab=`/`?sort=`/`?q=` apply as today.
3. Selecting a row sets `?customerId=&channel=`; the thread panel renders that channel's history and the matching composer.
4. Replying posts to the channel's existing send route (`/api/text/send` or `/api/email/send`); on return, the channel-specific banner shows.

## Error handling

- A customer with only SMS or only email gets exactly one row; a customer with both gets two (one per channel) — no empty rows (the "has ≥1 message" guard is per group).
- Reply gates fail closed per channel; the composer is disabled with a reason, never silently no-op.
- Email-disabled workspace: email rows still render (history is visible) but the email composer is disabled with "Email disabled for this workspace" (mirrors the SMS-disabled behavior from Phase 14).

## Testing

**Pure unit (`message-inbox.test.ts`, extend heavily — this is the risk surface):**
- SMS-only fixtures produce byte-identical rows to the pre-#3c behavior (regression guard): same `canReply`, `replyDisabledReason`, metrics.
- A customer with both channels yields two rows, one per channel, each with the correct channel-specific `canReply`/reason.
- Email reply gate: opted-out (`doNotEmail`) → canReply false + "opted out" reason; no email → "no email on file"; no invoice → "no invoice to attach"; all-clear → canReply true.
- `isFailed` trips `needsAttention` on `bounced`/`complained` email statuses.
- `applyChannelFilter` returns sms-only / email-only / all correctly.
- `subjectSnippet` is the last email subject for email rows, null for sms rows.

**Route/loader:** with a fresh org holding both an SMS and an email thread for one customer, the loader returns two rows; `?channel=email` filters to one; selecting `customerId&channel=email` loads the email history with subjects.

**Build/typecheck:** components via `tsc` + production build.

## Security constraints (carried forward)

- All reads use the user client (RLS) with explicit `org_id` (defense in depth), exactly as `messages.tsx` does today.
- Reply routing reuses the #3a/#3b server-enforced gates; #3c adds no new privileged path.
- All prior constraints (platform-managed keys, server-enforced channel gates, never `git add -A`, never commit secrets) remain in force.

## File inventory

**Modified:**
- `app/lib/message-inbox.ts` — channel-parametric types, `(customer,channel)` grouping, channel-specific reply gate, email terminal statuses, `applyChannelFilter`, `subjectSnippet`.
- `app/routes/messages.tsx` — read `email_messages`, union customers, channel filter + `(customer,channel)` selection, `emailEnabled`.
- `app/components/MessagesInbox.tsx` — channel badge + filter control + `&channel=` links.
- `app/components/MessageThreadPanel.tsx` — channel-aware thread render + composer (email subject/body → `/api/email/send`).
- `test/message-inbox.test.ts` — extended (regression + email cases).
