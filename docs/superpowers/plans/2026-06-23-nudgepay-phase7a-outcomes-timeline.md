# Phase 7a — Structured Outcomes + Unified Timeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the manual contact-outcome vocabulary (B4) and merge manual logs + SMS into one read-only chronological per-case Timeline (B7), via a pure merge-at-read module — no migration, no new write path.

**Architecture:** A new pure module `app/lib/timeline.ts` owns the unified types, the SMS-outcome derivation, the merge/sort, and one shared `OUTCOME_LABELS` map. `contact-log.ts` gains 4 manual outcomes. The dashboard loader merges case-scoped `contact_logs` + case-scoped `text_messages` into `selectedTimeline`; `DetailPanel` renders it in the repurposed "Timeline" tab while "Messages" stays the live SMS console.

**Tech Stack:** React Router v7 on Cloudflare Workers, TypeScript, Vitest, Tailwind v4. Spec: `docs/superpowers/specs/2026-06-23-nudgepay-phase7a-outcomes-timeline-design.md`.

## Global Constraints

- **Pure modules** (`app/lib/timeline.ts`, `app/lib/contact-log.ts`): no I/O, no `node:*`, no `.server` suffix; imported by both client components and tests. `Date.parse` is allowed (pure).
- **No migration, no new write path.** `contact_logs.outcome` is free `text`; SMS outcomes are **derived at read time**, never persisted.
- **RLS boundary unchanged:** all reads on the `@supabase/ssr` USER client, scoped by `org_id` and `case_id`. Never the service client. Browser never touches the DB.
- **Tailwind v4:** all classes are **static literal strings** (no `text-${x}`).
- **One shared label map.** `OUTCOME_LABELS` in `timeline.ts` is the single source of outcome display copy (manual + derived). The log drawer and DetailPanel both consume it; do not reintroduce a second label map. `other → "Other"`; null/unknown outcome renders as the literal fallback `"Logged"`.
- **Derived SMS outcome rules (exact):** `inbound → customer-replied`; `outbound + status "delivered" → message-delivered`; `outbound + status "failed"|"undelivered" → contact-invalid`; otherwise `message-sent`.
- **Tests run from `nudgepay-app/`** with `npx vitest run` (NEVER `npm test`, never repo root). Component gate: `npx tsc -b` + `npx react-router build`, both clean.
- **Conventional Commits**; co-author trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Commit only the named files.

---

## File structure

- **New** `app/lib/timeline.ts` — `TimelineLogInput`, `TimelineSmsInput`, `TimelineEntry`, `OUTCOME_LABELS`, `deriveSmsOutcome`, `buildTimeline`. (Task 1)
- **New** `tests/timeline.test.ts` — pure unit tests. (Task 1)
- **Modify** `app/lib/contact-log.ts` — append 4 manual outcomes to `CONTACT_OUTCOMES`. (Task 2)
- **Modify** `app/components/LogContactDrawer.tsx` — consume shared `OUTCOME_LABELS` (drop local `OUTCOME_LABEL`). (Task 2)
- **Modify** `tests/contact-log.test.ts` — new outcomes accepted; unknown rejected. (Task 2)
- **Modify** `app/routes/dashboard.tsx` — loader: build `selectedTimeline`, drop `selectedActivity`/`ActivityEntry`, add `case_id` to the detail message select. (Task 3)
- **Modify** `app/components/DetailPanel.tsx` — Activity→Timeline tab rendering `TimelineEntry[]`; consume `OUTCOME_LABELS`; drop local `OUTCOME_TEXT`. (Task 3)

Tasks are ordered so dependencies flow forward: Task 1 (pure module) → Task 2 (outcomes, consumes `OUTCOME_LABELS`) → Task 3 (loader + panel, consumes `buildTimeline`/`TimelineEntry`/`OUTCOME_LABELS`).

---

### Task 1: `timeline.ts` pure module + tests

**Files:**
- Create: `nudgepay-app/app/lib/timeline.ts`
- Test: `nudgepay-app/tests/timeline.test.ts`

**Interfaces:**
- Produces (consumed by Tasks 2 & 3):
  - `OUTCOME_LABELS: Record<string, string>`
  - `deriveSmsOutcome(direction: string, status: string | null, errorCode: string | null): string`
  - `type TimelineLogInput = { id: string; at: string; method: string; outcome: string | null; notes: string | null; followUpAt: string | null; promisedAmount: number | null; promisedDate: string | null }`
  - `type TimelineSmsInput = { id: string; at: string; direction: string; body: string | null; status: string | null; errorCode: string | null }`
  - `type TimelineEntry` (discriminated union on `kind`, see Step 3)
  - `buildTimeline(logs: TimelineLogInput[], smsMessages: TimelineSmsInput[]): TimelineEntry[]`

- [ ] **Step 1: Write the failing tests**

Create `nudgepay-app/tests/timeline.test.ts`:

```ts
import { expect, test } from "vitest";
import { buildTimeline, deriveSmsOutcome, OUTCOME_LABELS } from "../app/lib/timeline";
import type { TimelineLogInput, TimelineSmsInput } from "../app/lib/timeline";

test("deriveSmsOutcome: inbound is customer-replied regardless of status", () => {
  expect(deriveSmsOutcome("inbound", null, null)).toBe("customer-replied");
  expect(deriveSmsOutcome("inbound", "received", null)).toBe("customer-replied");
});

test("deriveSmsOutcome: outbound delivered/failed/undelivered/other", () => {
  expect(deriveSmsOutcome("outbound", "delivered", null)).toBe("message-delivered");
  expect(deriveSmsOutcome("outbound", "failed", "30007")).toBe("contact-invalid");
  expect(deriveSmsOutcome("outbound", "undelivered", "30006")).toBe("contact-invalid");
  expect(deriveSmsOutcome("outbound", "sent", null)).toBe("message-sent");
  expect(deriveSmsOutcome("outbound", "queued", null)).toBe("message-sent");
  expect(deriveSmsOutcome("outbound", null, null)).toBe("message-sent");
});

test("OUTCOME_LABELS covers manual + derived keys", () => {
  expect(OUTCOME_LABELS["promise-to-pay"]).toBe("Promise to pay");
  expect(OUTCOME_LABELS["escalation-required"]).toBe("Escalation required");
  expect(OUTCOME_LABELS["customer-replied"]).toBe("Customer replied");
  expect(OUTCOME_LABELS["other"]).toBe("Other");
});

test("buildTimeline returns [] for empty inputs", () => {
  expect(buildTimeline([], [])).toEqual([]);
});

test("buildTimeline maps a log entry with its outcome label", () => {
  const logs: TimelineLogInput[] = [{
    id: "l1", at: "2026-06-20T10:00:00+00:00", method: "call", outcome: "promise-to-pay",
    notes: "spoke to AP", followUpAt: null, promisedAmount: 500, promisedDate: "2026-06-25",
  }];
  const [e] = buildTimeline(logs, []);
  expect(e.kind).toBe("log");
  if (e.kind === "log") {
    expect(e.outcomeLabel).toBe("Promise to pay");
    expect(e.promisedAmount).toBe(500);
  }
});

test("buildTimeline maps an sms entry with a derived label", () => {
  const sms: TimelineSmsInput[] = [{
    id: "m1", at: "2026-06-20T10:00:00+00:00", direction: "inbound",
    body: "I'll pay friday", status: null, errorCode: null,
  }];
  const [e] = buildTimeline([], sms);
  expect(e.kind).toBe("sms");
  if (e.kind === "sms") {
    expect(e.outcome).toBe("customer-replied");
    expect(e.outcomeLabel).toBe("Customer replied");
  }
});

test("buildTimeline merges logs + sms newest-first by timestamp", () => {
  const logs: TimelineLogInput[] = [
    { id: "l-old", at: "2026-06-18T09:00:00+00:00", method: "call", outcome: "no-answer", notes: null, followUpAt: null, promisedAmount: null, promisedDate: null },
    { id: "l-new", at: "2026-06-22T09:00:00+00:00", method: "note", outcome: "other", notes: null, followUpAt: null, promisedAmount: null, promisedDate: null },
  ];
  const sms: TimelineSmsInput[] = [
    { id: "m-mid", at: "2026-06-20T12:00:00+00:00", direction: "outbound", body: "reminder", status: "delivered", errorCode: null },
  ];
  const ids = buildTimeline(logs, sms).map((e) => e.id);
  expect(ids).toEqual(["l-new", "m-mid", "l-old"]);
});

test("buildTimeline is stable for equal timestamps (logs before sms)", () => {
  const at = "2026-06-20T10:00:00+00:00";
  const logs: TimelineLogInput[] = [{ id: "l1", at, method: "call", outcome: "no-answer", notes: null, followUpAt: null, promisedAmount: null, promisedDate: null }];
  const sms: TimelineSmsInput[] = [{ id: "m1", at, direction: "outbound", body: "hi", status: "sent", errorCode: null }];
  expect(buildTimeline(logs, sms).map((e) => e.id)).toEqual(["l1", "m1"]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd nudgepay-app && npx vitest run tests/timeline.test.ts`
Expected: FAIL — `Cannot find module '../app/lib/timeline'` (file does not exist yet).

- [ ] **Step 3: Implement `timeline.ts`**

Create `nudgepay-app/app/lib/timeline.ts`:

```ts
// Pure unification of the per-case interaction stream. No I/O, no node:*, no
// .server suffix — imported by the dashboard loader, the log drawer, the detail
// panel, and tests. Date.parse is pure and permitted here.

export type TimelineLogInput = {
  id: string;
  at: string; // ISO timestamp (contact_logs.created_at)
  method: string;
  outcome: string | null;
  notes: string | null;
  followUpAt: string | null;
  promisedAmount: number | null;
  promisedDate: string | null;
};

export type TimelineSmsInput = {
  id: string;
  at: string; // ISO timestamp (text_messages.created_at)
  direction: string; // "outbound" | "inbound"
  body: string | null;
  status: string | null;
  errorCode: string | null;
};

export type TimelineEntry =
  | {
      kind: "log";
      id: string;
      at: string;
      method: string;
      outcome: string | null;
      outcomeLabel: string | null;
      notes: string | null;
      followUpAt: string | null;
      promisedAmount: number | null;
      promisedDate: string | null;
    }
  | {
      kind: "sms";
      id: string;
      at: string;
      direction: string;
      body: string | null;
      status: string | null;
      errorCode: string | null;
      outcome: string;
      outcomeLabel: string;
    };

// Single source of outcome display copy (manual + SMS-derived). Static literal
// strings. `other` is "Other" (drawer-friendly); null/unknown render via the
// caller's "Logged" fallback, not this map.
export const OUTCOME_LABELS: Record<string, string> = {
  "promise-to-pay": "Promise to pay",
  dispute: "Dispute",
  "no-commitment": "No commitment",
  "left-voicemail": "Left voicemail",
  "no-answer": "No answer",
  other: "Other",
  "payment-already-sent": "Payment already sent",
  "requested-documentation": "Requested documentation",
  "escalation-required": "Escalation required",
  "follow-up-requested": "Follow-up requested",
  "message-sent": "Text sent",
  "message-delivered": "Text delivered",
  "customer-replied": "Customer replied",
  "contact-invalid": "Text failed",
};

// Derive a structured outcome from an SMS row. Pure, total: unknown status →
// "message-sent". errorCode is accepted for completeness but not needed.
export function deriveSmsOutcome(
  direction: string,
  status: string | null,
  _errorCode: string | null,
): string {
  if (direction === "inbound") return "customer-replied";
  if (status === "delivered") return "message-delivered";
  if (status === "failed" || status === "undelivered") return "contact-invalid";
  return "message-sent";
}

// Merge already-case-scoped logs + SMS into one newest-first stream. Sorts by
// parsed timestamp (descending); stable for equal timestamps (logs precede sms,
// matching concatenation order). Never throws.
export function buildTimeline(
  logs: TimelineLogInput[],
  smsMessages: TimelineSmsInput[],
): TimelineEntry[] {
  const logEntries: TimelineEntry[] = logs.map((l) => ({
    kind: "log",
    id: l.id,
    at: l.at,
    method: l.method,
    outcome: l.outcome,
    outcomeLabel: l.outcome == null ? null : OUTCOME_LABELS[l.outcome] ?? null,
    notes: l.notes,
    followUpAt: l.followUpAt,
    promisedAmount: l.promisedAmount,
    promisedDate: l.promisedDate,
  }));

  const smsEntries: TimelineEntry[] = smsMessages.map((m) => {
    const outcome = deriveSmsOutcome(m.direction, m.status, m.errorCode);
    return {
      kind: "sms",
      id: m.id,
      at: m.at,
      direction: m.direction,
      body: m.body,
      status: m.status,
      errorCode: m.errorCode,
      outcome,
      outcomeLabel: OUTCOME_LABELS[outcome] ?? outcome,
    };
  });

  // Concatenate logs-then-sms so equal timestamps keep that stable order, then
  // sort descending by epoch ms (Array.prototype.sort is stable in our runtime).
  return [...logEntries, ...smsEntries].sort(
    (a, b) => Date.parse(b.at) - Date.parse(a.at),
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd nudgepay-app && npx vitest run tests/timeline.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add nudgepay-app/app/lib/timeline.ts nudgepay-app/tests/timeline.test.ts
git commit -m "feat(timeline): pure merge-at-read module for unified case interactions"
```

---

### Task 2: B4 manual outcomes + shared drawer labels

**Files:**
- Modify: `nudgepay-app/app/lib/contact-log.ts:6-8` (the `CONTACT_OUTCOMES` tuple)
- Modify: `nudgepay-app/app/components/LogContactDrawer.tsx:4,9-16,138-140`
- Test: `nudgepay-app/tests/contact-log.test.ts`

**Interfaces:**
- Consumes: `OUTCOME_LABELS` from `../lib/timeline` (Task 1).
- Produces: `CONTACT_OUTCOMES` includes `payment-already-sent`, `requested-documentation`, `escalation-required`, `follow-up-requested` (the parser at `contact-log.ts:65` validates against this tuple).

- [ ] **Step 1: Write the failing tests**

Append to `nudgepay-app/tests/contact-log.test.ts`:

```ts
test("parse: accepts the new B4 manual outcomes", () => {
  for (const outcome of [
    "payment-already-sent", "requested-documentation", "escalation-required", "follow-up-requested",
  ]) {
    const r = parseContactLogForm(
      fd({ caseId: "c1", method: "call", outcome, nextStep: "follow_up", followUpAt: "2026-07-01" }),
    );
    expect(r.ok, `${outcome} should be accepted`).toBe(true);
    if (r.ok) expect(r.fields.outcome).toBe(outcome);
  }
});

test("parse: rejects an unknown outcome", () => {
  expect(parseContactLogForm(fd({ caseId: "c1", method: "call", outcome: "totally-made-up", nextStep: "follow_up", followUpAt: "2026-07-01" })))
    .toEqual({ ok: false, error: "bad-outcome" });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd nudgepay-app && npx vitest run tests/contact-log.test.ts`
Expected: FAIL — the 4 new outcomes currently reject with `bad-outcome` (the "accepts" test fails). The "rejects an unknown outcome" test passes already.

- [ ] **Step 3: Expand `CONTACT_OUTCOMES`**

In `nudgepay-app/app/lib/contact-log.ts`, replace lines 6-8:

```ts
export const CONTACT_OUTCOMES = [
  "promise-to-pay", "dispute", "no-commitment", "left-voicemail", "no-answer", "other",
] as const;
```

with:

```ts
export const CONTACT_OUTCOMES = [
  "promise-to-pay", "dispute", "no-commitment", "left-voicemail", "no-answer", "other",
  "payment-already-sent", "requested-documentation", "escalation-required", "follow-up-requested",
] as const;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd nudgepay-app && npx vitest run tests/contact-log.test.ts`
Expected: PASS (all, including the 2 new tests).

- [ ] **Step 5: Point the drawer at the shared label map**

In `nudgepay-app/app/components/LogContactDrawer.tsx`:

Change the import on line 4 from:

```ts
import { CONTACT_METHODS, CONTACT_OUTCOMES } from "../lib/contact-log";
```

to:

```ts
import { CONTACT_METHODS, CONTACT_OUTCOMES } from "../lib/contact-log";
import { OUTCOME_LABELS } from "../lib/timeline";
```

Delete the local `OUTCOME_LABEL` map (lines 9-16):

```ts
const OUTCOME_LABEL: Record<string, string> = {
  "promise-to-pay": "Promise to pay",
  dispute: "Dispute",
  "no-commitment": "No commitment",
  "left-voicemail": "Left voicemail",
  "no-answer": "No answer",
  other: "Other",
};
```

And in the outcome `<select>` (lines 138-140) change `OUTCOME_LABEL[o]` to `OUTCOME_LABELS[o]`:

```tsx
              {CONTACT_OUTCOMES.map((o) => (
                <option key={o} value={o}>{OUTCOME_LABELS[o]}</option>
              ))}
```

(The 4 new outcomes now render as options automatically, with labels from the shared map.)

- [ ] **Step 6: Verify the component build**

Run: `cd nudgepay-app && npx tsc -b && npx react-router build`
Expected: both clean.

- [ ] **Step 7: Commit**

```bash
git add nudgepay-app/app/lib/contact-log.ts nudgepay-app/app/components/LogContactDrawer.tsx nudgepay-app/tests/contact-log.test.ts
git commit -m "feat(outcomes): add 4 B4 manual outcomes, share one outcome label map"
```

---

### Task 3: Loader merge + DetailPanel Timeline tab

**Files:**
- Modify: `nudgepay-app/app/routes/dashboard.tsx` (type `ActivityEntry` at 106-115; `selectedActivity` at 225, 364-369, returns ~413 & ~446; detail message select at 372-381; DetailPanel props ~521-522)
- Modify: `nudgepay-app/app/components/DetailPanel.tsx` (imports line 7; `OUTCOME_TEXT` 49-56; `TABS` 241-245; tab bar 406-433; activity panel 550-592; props 254-269)

**Interfaces:**
- Consumes: `buildTimeline`, `TimelineEntry`, `TimelineLogInput`, `TimelineSmsInput`, `OUTCOME_LABELS` from `~/lib/timeline` (Task 1).
- Produces: loader returns `selectedTimeline: TimelineEntry[]`; `DetailPanel` accepts a `timeline: TimelineEntry[]` prop (replacing `activity: ActivityEntry[]`).

This task has no new unit test (it is loader + presentational wiring over the Task 1 module, which is already unit-tested). Its gate is `tsc -b` + `react-router build` + the full suite as regression + a controller screenshot.

- [ ] **Step 1: Loader — import the timeline module**

In `nudgepay-app/app/routes/dashboard.tsx`, add to the existing imports (near the other `~/lib` imports):

```ts
import { buildTimeline, type TimelineEntry, type TimelineLogInput, type TimelineSmsInput } from "~/lib/timeline";
```

- [ ] **Step 2: Loader — replace the `ActivityEntry` type + state with timeline**

Delete the `ActivityEntry` type (lines 106-115):

```ts
export type ActivityEntry = {
  id: string;
  method: string;
  outcome: string | null;
  notes: string | null;
  createdAt: string;
  followUpAt: string | null;
  promisedAmount: number | null;
  promisedDate: string | null;
};
```

Change the state declaration (line 225) from:

```ts
  let selectedActivity: ActivityEntry[] = [];
```

to:

```ts
  let selectedTimeline: TimelineEntry[] = [];
```

- [ ] **Step 3: Loader — build the timeline in the selected-case block**

In the selected-case block, replace the activity fetch + the message fetch (lines 357-381) with a case-scoped log fetch, a `case_id`-bearing message fetch (the customer thread, now carrying `case_id`), and the merge. Replace:

```ts
      // Activity: contact logs for the case.
      const { data: actRows } = await supabase
        .from("contact_logs")
        .select("id, method, outcome, notes, created_at, follow_up_at, promised_amount, promised_date")
        .eq("org_id", org.org_id)
        .eq("case_id", sel.caseId)
        .order("created_at", { ascending: false });
      selectedActivity = ((actRows as unknown as ContactLogRow[]) ?? []).map((r) => ({
        id: r.id, method: r.method, outcome: r.outcome, notes: r.notes,
        createdAt: r.created_at, followUpAt: r.follow_up_at,
        promisedAmount: r.promised_amount == null ? null : Number(r.promised_amount),
        promisedDate: r.promised_date,
      }));

      // Messages: thread by CUSTOMER (one conversation per customer).
      const { data: msgRows } = await supabase
        .from("text_messages")
        .select("id, direction, body, status, error_code, created_at")
        .eq("org_id", org.org_id)
        .eq("customer_id", customerId)
        .order("created_at", { ascending: true });
      selectedMessages = ((msgRows as unknown as SelectedMessageRow[]) ?? []).map((r) => ({
        id: r.id, direction: r.direction, body: r.body, status: r.status,
        errorCode: r.error_code, createdAt: r.created_at,
      }));
```

with:

```ts
      // Activity: contact logs for the case (timeline input).
      const { data: actRows } = await supabase
        .from("contact_logs")
        .select("id, method, outcome, notes, created_at, follow_up_at, promised_amount, promised_date")
        .eq("org_id", org.org_id)
        .eq("case_id", sel.caseId)
        .order("created_at", { ascending: false });
      const logInputs: TimelineLogInput[] = ((actRows as unknown as ContactLogRow[]) ?? []).map((r) => ({
        id: r.id, at: r.created_at, method: r.method, outcome: r.outcome, notes: r.notes,
        followUpAt: r.follow_up_at,
        promisedAmount: r.promised_amount == null ? null : Number(r.promised_amount),
        promisedDate: r.promised_date,
      }));

      // Messages: thread by CUSTOMER (one conversation per customer); also carries
      // case_id so we can derive the per-case slice for the timeline.
      const { data: msgRows } = await supabase
        .from("text_messages")
        .select("id, case_id, direction, body, status, error_code, created_at")
        .eq("org_id", org.org_id)
        .eq("customer_id", customerId)
        .order("created_at", { ascending: true });
      const msgRowsTyped = (msgRows as unknown as (SelectedMessageRow & { case_id: string | null })[]) ?? [];
      selectedMessages = msgRowsTyped.map((r) => ({
        id: r.id, direction: r.direction, body: r.body, status: r.status,
        errorCode: r.error_code, createdAt: r.created_at,
      }));

      // Timeline: case-scoped logs + case-scoped SMS, merged newest-first.
      const smsInputs: TimelineSmsInput[] = msgRowsTyped
        .filter((r) => r.case_id === sel.caseId)
        .map((r) => ({
          id: r.id, at: r.created_at, direction: r.direction,
          body: r.body, status: r.status, errorCode: r.error_code,
        }));
      selectedTimeline = buildTimeline(logInputs, smsInputs);
```

- [ ] **Step 4: Loader — return `selectedTimeline` instead of `selectedActivity`**

There are two return objects that include `selectedActivity` (the connected-branch return near line 413 and the final return near line 446). In **both**, replace the line:

```ts
      selectedActivity,
```

with:

```ts
      selectedTimeline,
```

- [ ] **Step 5: Loader — pass the timeline to `DetailPanel`**

In the JSX (around line 521), change:

```tsx
                  activity={selectedActivity}
```

to:

```tsx
                  timeline={selectedTimeline}
```

- [ ] **Step 6: DetailPanel — swap imports and labels**

In `nudgepay-app/app/components/DetailPanel.tsx`, change the type import on line 7 from:

```ts
import type { ActivityEntry, MessageEntry, RosterMember } from "~/routes/dashboard";
```

to:

```ts
import type { MessageEntry, RosterMember } from "~/routes/dashboard";
import { OUTCOME_LABELS, type TimelineEntry } from "~/lib/timeline";
```

Delete the local `OUTCOME_TEXT` map (lines 49-56):

```ts
const OUTCOME_TEXT: Record<string, string> = {
  "promise-to-pay": "Promise to pay",
  dispute: "Dispute",
  "no-commitment": "No commitment",
  "left-voicemail": "Left voicemail",
  "no-answer": "No answer",
  other: "Logged",
};
```

(Display copy now comes from the shared `OUTCOME_LABELS`; the null/unknown fallback `"Logged"` is applied inline in Step 8.)

- [ ] **Step 7: DetailPanel — rename the tab + prop**

In the `TABS` array (line 242-245), change the `activity` entry label to "Timeline":

```ts
const TABS = [
  { id: "overview" as const, label: "Overview" },
  { id: "activity" as const, label: "Timeline" },
  { id: "messages" as const, label: "Messages" },
];
```

(Keep the `id` as `"activity"` so `activeTab`/route `tab` values and the `?tab=activity` URLs are unchanged — only the visible label and the rendered content change.)

In the `DetailPanel` props type (lines 254-269), replace:

```ts
  activity: ActivityEntry[];
```

with:

```ts
  timeline: TimelineEntry[];
```

and update the destructured params (line 253-263) to replace `activity,` with `timeline,`.

- [ ] **Step 8: DetailPanel — render the unified timeline**

Replace the activity panel (lines 550-592, the `{activeTab === "activity" ? (...) : null}` block) with a unified renderer over `TimelineEntry[]`:

```tsx
      {activeTab === "activity" ? (
        <section id="activity-panel" role="tabpanel" aria-labelledby="activity-tab" className="flex-1 px-5 py-4">
          {timeline.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
              <Icon name="note" size={24} className="text-border" aria-hidden />
              <p className="text-sm font-sans font-semibold text-text">No activity yet.</p>
              <p className="text-xs text-muted max-w-xs">Logged contacts and texts will appear here.</p>
            </div>
          ) : (
            <ol className="flex flex-col gap-3">
              {(() => {
                const today = todayISO();
                return timeline.map((e) => {
                  if (e.kind === "sms") {
                    const inbound = e.direction === "inbound";
                    return (
                      <li key={e.id} className="flex gap-3 border-b border-border pb-3 last:border-0">
                        <span className="mt-0.5 text-muted shrink-0">
                          <Icon name="message" size={15} aria-hidden />
                        </span>
                        <div className="min-w-0 flex flex-col gap-0.5">
                          <span className={`text-sm font-sans font-semibold ${inbound ? "text-cool" : "text-text"}`}>
                            {e.outcomeLabel}
                          </span>
                          <span className="font-mono text-xs text-muted">{formatDate(e.at)}</span>
                          {e.body ? (
                            <span className="text-xs text-muted whitespace-pre-wrap line-clamp-3">{e.body}</span>
                          ) : null}
                          {e.errorCode ? (
                            <span className="text-xs font-sans text-hot">Error {e.errorCode}</span>
                          ) : null}
                        </div>
                      </li>
                    );
                  }
                  const broken = e.promisedDate != null && e.promisedDate < today;
                  return (
                    <li key={e.id} className="flex gap-3 border-b border-border pb-3 last:border-0">
                      <span className="mt-0.5 text-muted shrink-0">
                        <Icon name={METHOD_ICON[e.method] ?? "note"} size={15} aria-hidden />
                      </span>
                      <div className="min-w-0 flex flex-col gap-0.5">
                        <span className="text-sm font-sans font-semibold text-text">
                          {e.outcomeLabel ?? "Logged"}
                        </span>
                        <span className="font-mono text-xs text-muted">{formatDate(e.at)}</span>
                        {e.promisedAmount != null && e.promisedDate != null && (
                          <span className={`text-xs font-sans font-medium ${broken ? "text-hot" : "text-text"}`}>
                            Promised {formatUSD(e.promisedAmount)} by {formatDate(e.promisedDate)}
                            {broken ? " · broken" : ""}
                          </span>
                        )}
                        {e.followUpAt && (
                          <span className="text-xs font-sans text-muted">Follow up {formatDate(e.followUpAt)}</span>
                        )}
                        {e.notes && <span className="text-xs text-muted whitespace-pre-wrap">{e.notes}</span>}
                      </div>
                    </li>
                  );
                });
              })()}
            </ol>
          )}
        </section>
      ) : null}
```

(Reuses the existing `METHOD_ICON`, `formatDate`, `formatUSD`, `todayISO` helpers already in the file.)

- [ ] **Step 9: Verify types, build, and full regression**

Run: `cd nudgepay-app && npx tsc -b && npx react-router build`
Expected: both clean (no remaining references to `ActivityEntry`, `selectedActivity`, `OUTCOME_TEXT`).

Run: `cd nudgepay-app && npx vitest run`
Expected: full suite green (existing + Task 1's 8 + Task 2's 2).

Controller: re-seed if needed (`node scripts/demo-seed.mjs`), then screenshot a case with both a manual log and SMS (Riverside) on the **Timeline** tab — confirm one interleaved newest-first stream; confirm the **Messages** tab still composes.

- [ ] **Step 10: Commit**

```bash
git add nudgepay-app/app/routes/dashboard.tsx nudgepay-app/app/components/DetailPanel.tsx
git commit -m "feat(timeline): unified per-case Timeline tab over manual logs + SMS"
```

---

## Final verification (after Task 3)

- [ ] `cd nudgepay-app && npx tsc -b && npx react-router build` — clean.
- [ ] `cd nudgepay-app && npx vitest run` — full suite green (190 prior + 10 new).
- [ ] Controller screenshot: Timeline tab shows interleaved logs + SMS newest-first with correct outcome labels (e.g. "Customer replied", "Text delivered", "Promise to pay"); Messages console unchanged; the log drawer's outcome dropdown lists all 10 manual outcomes.

## Notes for the implementer

- **Presentational + pure only.** No migration, no new DB writes, no service-client use. If you find yourself editing a migration or an action's write path, stop — out of scope for 7a.
- **One label map.** `OUTCOME_LABELS` in `timeline.ts` is the only outcome label source. Do not re-add a local map in the drawer or panel.
- **Keep `tab` id `"activity"`.** Only the visible label ("Timeline") and rendered content change; the route param and `?tab=activity` URLs stay, so existing links/tests are unaffected.
- **`ContactLogRow` / `SelectedMessageRow`** types already exist in `dashboard.tsx`; the message select adds `case_id`, typed inline as `SelectedMessageRow & { case_id: string | null }`.
