# C8 — Team Performance & Workload Reporting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an owner-only `/reports` page showing per-rep throughput, promise-kept rate, team time-to-first-contact, and per-owner workload, over a selectable 7/30/90-day window, computed live from existing tables.

**Architecture:** A new pure `reports.ts` aggregator (`buildTeamReport`) turns primitive row arrays into a `TeamReport`; a new owner-gated `reports.tsx` route does the RLS reads, shapes them, calls the aggregator, and renders. The existing inert "Reports" nav item in `AppShell` becomes an owner-only link.

**Tech Stack:** TypeScript, React Router (framework mode), Supabase/Postgres + RLS, Vitest, Tailwind v4.

## Global Constraints

- Pure libs (`reports.ts`) have **no I/O, no `node:*`, no `.server` suffix**; cross-imports of pure modules (`exceptions.ts`, type-only `promises.ts`/`contact-log.ts`) are fine.
- Date-only `today`/`windowStart` are `YYYY-MM-DD` strings (the app's UTC `today` convention). **Timestamps** (`created_at`, `opened_at`, `resolved_at`) are real `timestamptz` ISO strings — parse those with `new Date(iso).getTime()` (this is NOT the date-only timezone pitfall; they are instants).
- Promise outcome statuses are `kept | partially_kept | broken`; `pending | renegotiated | cancelled` are NOT outcomes and are excluded from the kept-rate.
- `keptRate = resolved === 0 ? null : kept / resolved` — **strict** (`partially_kept` excluded from the numerator), `null` (never `NaN`) when no resolved promises.
- Time-to-first-contact is **team-level**, not per-rep.
- Owner gating is a **surface gate, not a security boundary** (rows are RLS-readable by any member); no new RLS in C8.
- Window presets: `7 | 30 | 90`, default `30`, via `?range=`.
- Tests: `npx vitest run` (NOT `npm test`). Run from `nudgepay-app/`.
- Conventional Commits; commit message body ends with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

### Task 1: Pure `reports.ts` aggregator

**Files:**
- Create: `nudgepay-app/app/lib/reports.ts`
- Test: `nudgepay-app/tests/reports.test.ts`

**Interfaces:**
- Consumes: `isCaseSuppressed` from `./exceptions` (value); `PromiseStatus` from `./promises` (type); `ExceptionReason` from `./contact-log` (type).
- Produces: the types and `buildTeamReport(input): TeamReport` exactly as written below. Later tasks (the route) construct the `input` arrays and consume `TeamReport`.

- [ ] **Step 1: Write the failing test** — create `tests/reports.test.ts`:

```ts
import { expect, test } from "vitest";
import { buildTeamReport } from "../app/lib/reports";

const ROSTER = [
  { userId: "u1", label: "alice" },
  { userId: "u2", label: "bob" },
];

function base() {
  return {
    range: 30 as const,
    roster: ROSTER,
    contactLogs: [] as { userId: string; caseId: string | null; createdAt: string }[],
    promises: [] as { createdBy: string | null; status: any; resolvedAt: string | null }[],
    openedCases: [] as { caseId: string; openedAt: string }[],
    workloadCases: [] as any[],
    today: "2026-06-26",
  };
}

test("throughput: counts contacts and distinct cases per rep; zero-activity rep present", () => {
  const input = base();
  input.contactLogs = [
    { userId: "u1", caseId: "c1", createdAt: "2026-06-20T10:00:00Z" },
    { userId: "u1", caseId: "c1", createdAt: "2026-06-21T10:00:00Z" }, // same case
    { userId: "u1", caseId: "c2", createdAt: "2026-06-22T10:00:00Z" },
    { userId: "u1", caseId: null, createdAt: "2026-06-22T11:00:00Z" }, // null case ignored for casesTouched
  ];
  const r = buildTeamReport(input);
  const alice = r.perRep.find((x) => x.userId === "u1")!;
  const bob = r.perRep.find((x) => x.userId === "u2")!;
  expect(alice.contactsLogged).toBe(4);
  expect(alice.casesTouched).toBe(2);
  expect(bob.contactsLogged).toBe(0);
  expect(bob.casesTouched).toBe(0);
});

test("kept-rate: strict (partial excluded), excludes non-outcome statuses, null when none resolved", () => {
  const input = base();
  input.promises = [
    { createdBy: "u1", status: "kept", resolvedAt: "2026-06-20T00:00:00Z" },
    { createdBy: "u1", status: "kept", resolvedAt: "2026-06-21T00:00:00Z" },
    { createdBy: "u1", status: "partially_kept", resolvedAt: "2026-06-21T00:00:00Z" },
    { createdBy: "u1", status: "broken", resolvedAt: "2026-06-22T00:00:00Z" },
    { createdBy: "u1", status: "pending", resolvedAt: null },          // excluded
    { createdBy: "u1", status: "renegotiated", resolvedAt: "2026-06-22T00:00:00Z" }, // excluded
    { createdBy: null, status: "kept", resolvedAt: "2026-06-22T00:00:00Z" },         // null rep ignored
  ];
  const r = buildTeamReport(input);
  const alice = r.perRep.find((x) => x.userId === "u1")!;
  expect(alice.kept).toBe(2);
  expect(alice.partiallyKept).toBe(1);
  expect(alice.broken).toBe(1);
  expect(alice.resolved).toBe(4);
  expect(alice.keptRate).toBeCloseTo(2 / 4, 10); // strict: partial NOT in numerator
  const bob = r.perRep.find((x) => x.userId === "u2")!;
  expect(bob.resolved).toBe(0);
  expect(bob.keptRate).toBeNull(); // no NaN
});

test("first-contact: median/avg/within24h over contacted cases; uncontacted counted", () => {
  const input = base();
  input.openedCases = [
    { caseId: "c1", openedAt: "2026-06-20T00:00:00Z" }, // first contact +2h
    { caseId: "c2", openedAt: "2026-06-20T00:00:00Z" }, // first contact +48h
    { caseId: "c3", openedAt: "2026-06-20T00:00:00Z" }, // first contact +10h
    { caseId: "c4", openedAt: "2026-06-20T00:00:00Z" }, // no contact -> uncontacted
  ];
  input.contactLogs = [
    { userId: "u1", caseId: "c1", createdAt: "2026-06-20T02:00:00Z" },
    { userId: "u1", caseId: "c1", createdAt: "2026-06-20T05:00:00Z" }, // later, ignored (min wins)
    { userId: "u2", caseId: "c2", createdAt: "2026-06-22T00:00:00Z" },
    { userId: "u1", caseId: "c3", createdAt: "2026-06-20T10:00:00Z" },
  ];
  const r = buildTeamReport(input);
  expect(r.firstContact.contacted).toBe(3);
  expect(r.firstContact.uncontacted).toBe(1);
  // hours: [2, 48, 10] -> sorted [2,10,48], median 10, avg 20
  expect(r.firstContact.medianHours).toBeCloseTo(10, 10);
  expect(r.firstContact.avgHours).toBeCloseTo((2 + 48 + 10) / 3, 10);
  // within 24h: 2 and 10 -> 2/3
  expect(r.firstContact.within24hPct).toBeCloseTo(2 / 3, 10);
});

test("first-contact: even-count median averages the two middle values; all-null when none contacted", () => {
  const input = base();
  input.openedCases = [
    { caseId: "c1", openedAt: "2026-06-20T00:00:00Z" },
    { caseId: "c2", openedAt: "2026-06-20T00:00:00Z" },
  ];
  input.contactLogs = [
    { userId: "u1", caseId: "c1", createdAt: "2026-06-20T04:00:00Z" }, // 4h
    { userId: "u1", caseId: "c2", createdAt: "2026-06-20T08:00:00Z" }, // 8h
  ];
  const r = buildTeamReport(input);
  expect(r.firstContact.medianHours).toBeCloseTo(6, 10); // (4+8)/2

  const empty = base();
  empty.openedCases = [{ caseId: "z1", openedAt: "2026-06-20T00:00:00Z" }];
  const r2 = buildTeamReport(empty);
  expect(r2.firstContact.contacted).toBe(0);
  expect(r2.firstContact.uncontacted).toBe(1);
  expect(r2.firstContact.medianHours).toBeNull();
  expect(r2.firstContact.avgHours).toBeNull();
  expect(r2.firstContact.within24hPct).toBeNull();
});

test("workload: groups by owner, excludes suppressed, surfaces unassigned + unknown owners, roster zeros", () => {
  const input = base();
  input.workloadCases = [
    { caseId: "c1", ownerId: "u1", status: "working", exceptionReason: null, nextActionAt: null, overdueTotal: 100, hasBrokenPromise: false },
    { caseId: "c2", ownerId: "u1", status: "working", exceptionReason: null, nextActionAt: null, overdueTotal: 50, hasBrokenPromise: true },
    // suppressed: on_hold + terminal reason -> excluded
    { caseId: "c3", ownerId: "u1", status: "on_hold", exceptionReason: "legal_agency", nextActionAt: null, overdueTotal: 999, hasBrokenPromise: false },
    { caseId: "c4", ownerId: null, status: "new", exceptionReason: null, nextActionAt: null, overdueTotal: 25, hasBrokenPromise: false },
    { caseId: "c5", ownerId: "ghost", status: "new", exceptionReason: null, nextActionAt: null, overdueTotal: 10, hasBrokenPromise: false },
  ];
  const r = buildTeamReport(input);
  const alice = r.workload.find((w) => w.ownerId === "u1")!;
  expect(alice.openCases).toBe(2); // c3 suppressed
  expect(alice.overdueTotal).toBe(150);
  expect(alice.brokenPromises).toBe(1);
  const bob = r.workload.find((w) => w.ownerId === "u2")!;
  expect(bob.openCases).toBe(0); // roster member, no cases
  const unassigned = r.workload.find((w) => w.ownerId === null)!;
  expect(unassigned.label).toBe("Unassigned");
  expect(unassigned.overdueTotal).toBe(25);
  const ghost = r.workload.find((w) => w.ownerId === "ghost")!;
  expect(ghost.label).toBe("Unknown");
  expect(ghost.overdueTotal).toBe(10);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd C:/Users/dasbl/WebstormProjects/nudgepay/nudgepay-app && npx vitest run tests/reports.test.ts`
Expected: FAIL — module `../app/lib/reports` not found.

- [ ] **Step 3: Create `app/lib/reports.ts`**

```ts
// Pure team-reporting aggregation (C8). No I/O, no node:*, no .server. Turns
// already-shaped, already-windowed primitive rows into a TeamReport. The route
// loader owns the reads + window filtering; this module owns the math.

import { isCaseSuppressed } from "./exceptions";
import type { PromiseStatus } from "./promises";
import type { ExceptionReason } from "./contact-log";

export const REPORT_RANGES = [7, 30, 90] as const;
export type ReportRange = (typeof REPORT_RANGES)[number];

export type ReportRosterMember = { userId: string; label: string };
export type ReportContactLog = { userId: string; caseId: string | null; createdAt: string };
export type ReportPromise = { createdBy: string | null; status: PromiseStatus; resolvedAt: string | null };
export type ReportOpenedCase = { caseId: string; openedAt: string };
export type ReportWorkloadCase = {
  caseId: string;
  ownerId: string | null;
  status: string;
  exceptionReason: ExceptionReason | null;
  nextActionAt: string | null;
  overdueTotal: number;
  hasBrokenPromise: boolean;
};

export type RepRow = {
  userId: string; label: string;
  contactsLogged: number; casesTouched: number;
  kept: number; partiallyKept: number; broken: number; resolved: number;
  keptRate: number | null;
};
export type FirstContactSummary = {
  medianHours: number | null; avgHours: number | null;
  within24hPct: number | null; contacted: number; uncontacted: number;
};
export type WorkloadRow = {
  ownerId: string | null; label: string;
  openCases: number; overdueTotal: number; brokenPromises: number;
};
export type TeamReport = {
  range: ReportRange;
  perRep: RepRow[];
  firstContact: FirstContactSummary;
  workload: WorkloadRow[];
};

const RESOLVED_STATUSES: ReadonlyArray<PromiseStatus> = ["kept", "partially_kept", "broken"];

export function buildTeamReport(input: {
  range: ReportRange;
  roster: ReportRosterMember[];
  contactLogs: ReportContactLog[];
  promises: ReportPromise[];
  openedCases: ReportOpenedCase[];
  workloadCases: ReportWorkloadCase[];
  today: string;
}): TeamReport {
  const { range, roster, contactLogs, promises, openedCases, workloadCases, today } = input;

  // --- Per-rep: throughput ---
  const contactsByRep = new Map<string, number>();
  const casesByRep = new Map<string, Set<string>>();
  for (const log of contactLogs) {
    contactsByRep.set(log.userId, (contactsByRep.get(log.userId) ?? 0) + 1);
    if (log.caseId) {
      const set = casesByRep.get(log.userId) ?? new Set<string>();
      set.add(log.caseId);
      casesByRep.set(log.userId, set);
    }
  }

  // --- Per-rep: promise outcomes ---
  const keptByRep = new Map<string, { kept: number; partiallyKept: number; broken: number }>();
  for (const p of promises) {
    if (p.createdBy == null) continue;
    if (!RESOLVED_STATUSES.includes(p.status)) continue;
    const agg = keptByRep.get(p.createdBy) ?? { kept: 0, partiallyKept: 0, broken: 0 };
    if (p.status === "kept") agg.kept += 1;
    else if (p.status === "partially_kept") agg.partiallyKept += 1;
    else if (p.status === "broken") agg.broken += 1;
    keptByRep.set(p.createdBy, agg);
  }

  const perRep: RepRow[] = roster.map((m) => {
    const k = keptByRep.get(m.userId) ?? { kept: 0, partiallyKept: 0, broken: 0 };
    const resolved = k.kept + k.partiallyKept + k.broken;
    return {
      userId: m.userId, label: m.label,
      contactsLogged: contactsByRep.get(m.userId) ?? 0,
      casesTouched: casesByRep.get(m.userId)?.size ?? 0,
      kept: k.kept, partiallyKept: k.partiallyKept, broken: k.broken, resolved,
      keptRate: resolved === 0 ? null : k.kept / resolved,
    };
  });

  // --- Time-to-first-contact (team-level) ---
  const firstContactByCase = new Map<string, number>(); // caseId -> earliest epoch ms
  for (const log of contactLogs) {
    if (!log.caseId) continue;
    const t = new Date(log.createdAt).getTime();
    const prev = firstContactByCase.get(log.caseId);
    if (prev === undefined || t < prev) firstContactByCase.set(log.caseId, t);
  }
  const hoursList: number[] = [];
  let uncontacted = 0;
  for (const c of openedCases) {
    const fc = firstContactByCase.get(c.caseId);
    if (fc === undefined) { uncontacted += 1; continue; }
    const opened = new Date(c.openedAt).getTime();
    const hours = (fc - opened) / 3_600_000;
    hoursList.push(hours < 0 ? 0 : hours); // clamp negligible clock skew
  }
  const contacted = hoursList.length;
  const sorted = [...hoursList].sort((a, b) => a - b);
  const medianHours = contacted === 0
    ? null
    : contacted % 2 === 1
      ? sorted[(contacted - 1) / 2]
      : (sorted[contacted / 2 - 1] + sorted[contacted / 2]) / 2;
  const avgHours = contacted === 0 ? null : hoursList.reduce((s, h) => s + h, 0) / contacted;
  const within24hPct = contacted === 0 ? null : hoursList.filter((h) => h <= 24).length / contacted;
  const firstContact: FirstContactSummary = { medianHours, avgHours, within24hPct, contacted, uncontacted };

  // --- Workload snapshot (per owner, current open non-suppressed) ---
  const workloadByOwner = new Map<string | null, { openCases: number; overdueTotal: number; brokenPromises: number }>();
  for (const c of workloadCases) {
    if (isCaseSuppressed({ status: c.status, exceptionReason: c.exceptionReason, nextActionAt: c.nextActionAt, today })) continue;
    const agg = workloadByOwner.get(c.ownerId) ?? { openCases: 0, overdueTotal: 0, brokenPromises: 0 };
    agg.openCases += 1;
    agg.overdueTotal += c.overdueTotal;
    if (c.hasBrokenPromise) agg.brokenPromises += 1;
    workloadByOwner.set(c.ownerId, agg);
  }
  const rosterIds = new Set(roster.map((m) => m.userId));
  const workload: WorkloadRow[] = roster.map((m) => {
    const agg = workloadByOwner.get(m.userId) ?? { openCases: 0, overdueTotal: 0, brokenPromises: 0 };
    return { ownerId: m.userId, label: m.label, ...agg };
  });
  for (const [ownerId, agg] of workloadByOwner) {
    if (ownerId === null) { workload.push({ ownerId: null, label: "Unassigned", ...agg }); continue; }
    if (!rosterIds.has(ownerId)) workload.push({ ownerId, label: "Unknown", ...agg });
  }

  return { range, perRep, firstContact, workload };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd C:/Users/dasbl/WebstormProjects/nudgepay/nudgepay-app && npx vitest run tests/reports.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Typecheck**

Run: `cd C:/Users/dasbl/WebstormProjects/nudgepay/nudgepay-app && npx tsc --noEmit`
Expected: exit 0. (If `isCaseSuppressed`'s `exceptionReason` param type complains about `ExceptionReason`, mirror exactly how `cases.ts` calls it — `cases.ts` passes a `CaseRow.exceptionReason: ExceptionReason | null` into `isCaseSuppressed` and compiles, so the same usage here is sound.)

- [ ] **Step 6: Commit**

```bash
git add nudgepay-app/app/lib/reports.ts nudgepay-app/tests/reports.test.ts
git commit -m "feat(reports): pure team-report aggregator (C8)"
```

---

### Task 2: Owner-gated `/reports` route (loader + UI)

**Files:**
- Create: `nudgepay-app/app/routes/reports.tsx`
- Modify: `nudgepay-app/app/routes.ts` (register the route)

**Interfaces:**
- Consumes: `buildTeamReport` + all `Report*` types and `REPORT_RANGES`/`ReportRange` from `../lib/reports` (Task 1); auth/env/org/service/roster helpers (mirror the imports in `app/routes/dashboard.tsx`); `addCalendarDays` from `../lib/business-days`; `AppShell` from `../components/AppShell`.
- Produces: a route at path `/reports`.

- [ ] **Step 1: Register the route**

First inspect how routes are registered:

Run: `cd C:/Users/dasbl/WebstormProjects/nudgepay/nudgepay-app && cat app/routes.ts`
Expected: a list of `route(...)`/`index(...)` entries. Add a `reports` route mirroring the existing `dashboard` entry, e.g. add `route("reports", "routes/reports.tsx"),` alongside the dashboard route (match the exact helper style already in the file).

- [ ] **Step 2: Create `app/routes/reports.tsx` with the loader**

Copy the auth/env/org/service/connection imports and helper usage verbatim from the TOP of `app/routes/dashboard.tsx` (e.g. `getEnv`, `requireUser`, `resolveOrg`, `createSupabaseServiceClient`, `getConnectionStatus`, `listOrgMembers`) so paths match exactly. Then:

```tsx
import type { LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, Link } from "react-router";
// ...copy the auth/env/org/service/roster/connection imports from dashboard.tsx...
import { addCalendarDays } from "../lib/business-days";
import { AppShell } from "../components/AppShell";
import {
  buildTeamReport, REPORT_RANGES, type ReportRange, type TeamReport,
  type ReportContactLog, type ReportPromise, type ReportOpenedCase, type ReportWorkloadCase,
} from "../lib/reports";

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = getEnv(context as any);
  const { supabase, headers, user } = await requireUser(request, env);
  const org = await resolveOrg(supabase, user.id);
  if (!org) throw redirect("/onboarding", { headers });
  // Owner-only surface gate (not a security boundary — rows are RLS-readable).
  if (org.role !== "owner") throw redirect("/dashboard", { headers });

  const service = createSupabaseServiceClient(env);

  // Org chrome (mirror dashboard)
  const { data: orgRow } = await supabase.from("organizations").select("name").eq("id", org.org_id).single();
  const emailParts = (user.email ?? "").split("@")[0].split(/[.\-_]/);
  const initials = emailParts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
  const conn = await getConnectionStatus(service, org.org_id);
  const connected = conn?.status === "connected";

  // Window
  const url = new URL(request.url);
  const rawRange = Number(url.searchParams.get("range"));
  const range: ReportRange = (REPORT_RANGES as readonly number[]).includes(rawRange) ? (rawRange as ReportRange) : 30;
  const today = new Date().toISOString().slice(0, 10);
  const windowStart = addCalendarDays(today, -range);

  // Roster
  const roster = (await listOrgMembers(service, org.org_id)).map((m) => ({ userId: m.userId, label: m.label }));

  // Windowed contact logs (serve BOTH throughput and first-contact)
  const { data: logRows } = await supabase
    .from("contact_logs")
    .select("user_id, case_id, created_at")
    .eq("org_id", org.org_id)
    .gte("created_at", windowStart);
  const contactLogs: ReportContactLog[] = ((logRows as any[]) ?? []).map((r) => ({
    userId: r.user_id, caseId: r.case_id ?? null, createdAt: r.created_at,
  }));

  // Windowed resolved promises
  const { data: promRows } = await supabase
    .from("promises")
    .select("created_by, status, resolved_at")
    .eq("org_id", org.org_id)
    .in("status", ["kept", "partially_kept", "broken"])
    .gte("resolved_at", windowStart);
  const promises: ReportPromise[] = ((promRows as any[]) ?? []).map((r) => ({
    createdBy: r.created_by ?? null, status: r.status, resolvedAt: r.resolved_at ?? null,
  }));

  // Cases opened in window (for first-contact)
  const { data: openedRows } = await supabase
    .from("collection_cases")
    .select("id, opened_at")
    .eq("org_id", org.org_id)
    .gte("opened_at", windowStart);
  const openedCases: ReportOpenedCase[] = ((openedRows as any[]) ?? []).map((r) => ({
    caseId: r.id, openedAt: r.opened_at,
  }));

  // --- Workload snapshot (current open cases; lighter than the dashboard pipeline) ---
  const { data: openCaseRows } = await supabase
    .from("collection_cases")
    .select("id, customer_id, status, exception_reason, next_action_at")
    .eq("org_id", org.org_id)
    .is("closed_at", null);
  const openCases = ((openCaseRows as any[]) ?? []);
  const customerIds = [...new Set(openCases.map((c) => c.customer_id).filter(Boolean))];

  // Owner per customer
  const ownerByCustomer = new Map<string, string | null>();
  if (customerIds.length > 0) {
    const { data: custRows } = await supabase
      .from("customers").select("id, owner").eq("org_id", org.org_id).in("id", customerIds);
    for (const r of (custRows as any[]) ?? []) ownerByCustomer.set(r.id, r.owner ?? null);
  }

  // Overdue total per customer
  const overdueByCustomer = new Map<string, number>();
  const { data: invRows } = await supabase
    .from("invoices").select("customer_id, balance").eq("org_id", org.org_id)
    .gt("balance", 0).lt("due_date", today);
  for (const r of (invRows as any[]) ?? []) {
    if (!r.customer_id) continue;
    overdueByCustomer.set(r.customer_id, (overdueByCustomer.get(r.customer_id) ?? 0) + (Number(r.balance) || 0));
  }

  // Cases with a current broken promise
  const brokenCaseIds = new Set<string>();
  const { data: brokenRows } = await supabase
    .from("promises").select("case_id").eq("org_id", org.org_id).eq("status", "broken");
  for (const r of (brokenRows as any[]) ?? []) if (r.case_id) brokenCaseIds.add(r.case_id);

  const workloadCases: ReportWorkloadCase[] = openCases.map((c) => ({
    caseId: c.id,
    ownerId: c.customer_id ? (ownerByCustomer.get(c.customer_id) ?? null) : null,
    status: c.status,
    exceptionReason: c.exception_reason ?? null,
    nextActionAt: c.next_action_at ?? null,
    overdueTotal: c.customer_id ? (overdueByCustomer.get(c.customer_id) ?? 0) : 0,
    hasBrokenPromise: brokenCaseIds.has(c.id),
  }));

  const report = buildTeamReport({ range, roster, contactLogs, promises, openedCases, workloadCases, today });

  let syncLabel = connected ? "Connected" : "Not connected";

  return Response.json(
    { report, orgName: (orgRow?.name as string) ?? "Workspace", initials, connected, syncLabel },
    { headers },
  );
}
```

- [ ] **Step 3: Add the component (same file)**

Append the default-export component. Use literal Tailwind classes consistent with the codebase (panel/border/text tokens as in `MetricsStrip.tsx`/dashboard tables).

```tsx
function fmtUSD(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}
function fmtPct(x: number | null): string {
  return x == null ? "—" : `${Math.round(x * 100)}%`;
}
function fmtHours(x: number | null): string {
  return x == null ? "—" : x < 24 ? `${x.toFixed(1)}h` : `${(x / 24).toFixed(1)}d`;
}

export default function Reports() {
  const { report, orgName, initials, connected, syncLabel } = useLoaderData() as {
    report: TeamReport; orgName: string; initials: string; connected: boolean; syncLabel: string;
  };
  const teamContacts = report.perRep.reduce((s, r) => s + r.contactsLogged, 0);
  const teamKept = report.perRep.reduce((s, r) => s + r.kept, 0);
  const teamResolved = report.perRep.reduce((s, r) => s + r.resolved, 0);
  const teamKeptRate = teamResolved === 0 ? null : teamKept / teamResolved;

  return (
    <AppShell orgName={orgName} userInitials={initials} syncLabel={syncLabel} connected={connected} isOwner={true} syncIssues={null}>
      <div className="px-6 py-5 flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <h1 className="font-display text-xl font-semibold text-text">Team performance</h1>
          {/* Range toggle */}
          <div className="flex items-center gap-1" role="group" aria-label="Time range">
            {REPORT_RANGES.map((r) => (
              <Link
                key={r}
                to={`/reports?range=${r}`}
                aria-current={report.range === r ? "true" : undefined}
                className={`rounded-md border px-3 py-1.5 text-sm font-sans focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper ${
                  report.range === r ? "border-copper bg-copper/10 text-copper" : "border-border bg-panel text-muted hover:text-text"
                }`}
              >
                {r}d
              </Link>
            ))}
          </div>
        </div>

        {/* Summary strip */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-lg border border-border bg-panel p-4">
            <p className="text-xs font-sans uppercase tracking-wider text-muted">Median time to first contact</p>
            <p className="mt-1 font-display text-2xl text-text">{fmtHours(report.firstContact.medianHours)}</p>
            <p className="text-xs text-muted">{fmtPct(report.firstContact.within24hPct)} within 24h · {report.firstContact.uncontacted} uncontacted</p>
          </div>
          <div className="rounded-lg border border-border bg-panel p-4">
            <p className="text-xs font-sans uppercase tracking-wider text-muted">Contacts logged ({report.range}d)</p>
            <p className="mt-1 font-display text-2xl text-text">{teamContacts}</p>
          </div>
          <div className="rounded-lg border border-border bg-panel p-4">
            <p className="text-xs font-sans uppercase tracking-wider text-muted">Team promise-kept rate</p>
            <p className="mt-1 font-display text-2xl text-text">{fmtPct(teamKeptRate)}</p>
            <p className="text-xs text-muted">{teamKept} kept / {teamResolved} resolved</p>
          </div>
        </div>

        {/* Per-rep table */}
        <section className="flex flex-col gap-2">
          <h2 className="font-sans text-sm font-semibold uppercase tracking-wider text-muted">By rep</h2>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm font-sans">
              <thead className="bg-panel text-muted">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Rep</th>
                  <th className="px-3 py-2 text-right font-medium">Contacts</th>
                  <th className="px-3 py-2 text-right font-medium">Cases touched</th>
                  <th className="px-3 py-2 text-right font-medium">Kept</th>
                  <th className="px-3 py-2 text-right font-medium">Partial</th>
                  <th className="px-3 py-2 text-right font-medium">Broken</th>
                  <th className="px-3 py-2 text-right font-medium">Kept rate</th>
                </tr>
              </thead>
              <tbody>
                {report.perRep.map((r) => (
                  <tr key={r.userId} className="border-t border-border text-text">
                    <td className="px-3 py-2">{r.label}</td>
                    <td className="px-3 py-2 text-right">{r.contactsLogged}</td>
                    <td className="px-3 py-2 text-right">{r.casesTouched}</td>
                    <td className="px-3 py-2 text-right">{r.kept}</td>
                    <td className="px-3 py-2 text-right">{r.partiallyKept}</td>
                    <td className="px-3 py-2 text-right">{r.broken}</td>
                    <td className="px-3 py-2 text-right">{fmtPct(r.keptRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Workload table */}
        <section className="flex flex-col gap-2">
          <h2 className="font-sans text-sm font-semibold uppercase tracking-wider text-muted">Current workload</h2>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm font-sans">
              <thead className="bg-panel text-muted">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Owner</th>
                  <th className="px-3 py-2 text-right font-medium">Open cases</th>
                  <th className="px-3 py-2 text-right font-medium">Overdue</th>
                  <th className="px-3 py-2 text-right font-medium">Broken promises</th>
                </tr>
              </thead>
              <tbody>
                {report.workload.map((w) => (
                  <tr key={w.ownerId ?? "unassigned"} className="border-t border-border text-text">
                    <td className="px-3 py-2">{w.label}</td>
                    <td className="px-3 py-2 text-right">{w.openCases}</td>
                    <td className="px-3 py-2 text-right">{fmtUSD(w.overdueTotal)}</td>
                    <td className="px-3 py-2 text-right">{w.brokenPromises}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
```

- [ ] **Step 4: Typecheck + build**

Run: `cd C:/Users/dasbl/WebstormProjects/nudgepay/nudgepay-app && npx tsc --noEmit && npx react-router build`
Expected: tsc exit 0; build clean. Fix any type mismatch against the actual helper signatures (e.g. `getConnectionStatus` field names, `AppShell` prop types — `syncIssues` accepts `React.ReactNode`, so `null` is valid).

- [ ] **Step 5: Manual smoke (optional, if Supabase + a seeded owner are available)**

Run the dev server and visit `/reports` as an owner; confirm the page renders and the range toggle changes `?range=`. If no seeded data, the tables show roster rows with zeros (acceptable).

- [ ] **Step 6: Commit**

```bash
git add nudgepay-app/app/routes/reports.tsx nudgepay-app/app/routes.ts
git commit -m "feat(reports): owner-gated /reports route with team metrics (C8)"
```

---

### Task 3: Activate the Reports nav link for owners

**Files:**
- Modify: `nudgepay-app/app/components/AppShell.tsx`

**Interfaces:**
- Consumes: the existing `isOwner` prop (already passed by `dashboard.tsx` and now `reports.tsx`).
- Produces: a navigable "Reports" link for owners.

- [ ] **Step 1: Inspect the current nav rendering**

Run: `cd C:/Users/dasbl/WebstormProjects/nudgepay/nudgepay-app && sed -n '160,215p' app/components/AppShell.tsx`
Expected: the `NAV_ITEMS.map(...)` block rendering `item.active ? <Link.../> : <a href="#" aria-disabled.../>`. Note the component already destructures `isOwner` (currently as `isOwner: _isOwner`).

- [ ] **Step 2: Make `isOwner` usable and render Reports as an owner link**

In the component signature, rename `isOwner: _isOwner` back to `isOwner` so it is in scope.

Replace the `NAV_ITEMS.map((item) => item.active ? (...) : (...))` so the `reports` item, when `isOwner`, renders a real `Link` to `/reports` (same visual treatment as the inert items but navigable and not aria-disabled); all other inert items and the non-owner `reports` case keep the existing inert `<a href="#">` rendering. Concretely, change the map body to:

```tsx
{NAV_ITEMS.map((item) => {
  const isReportsForOwner = item.name === "reports" && isOwner;
  if (item.active) {
    // ...keep the EXISTING active <li>…<Link to="/dashboard">… block unchanged...
  }
  if (isReportsForOwner) {
    return (
      <li key={item.name} className="relative w-full">
        <Link
          to="/reports"
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
  // ...keep the EXISTING inert <li>…<a href="#" aria-disabled>… block unchanged...
})}
```

(Keep the existing active-item `<li>` and inert-item `<a>` markup exactly as they are; only add the `isReportsForOwner` branch between them and convert the map to a block body with explicit `return`s.)

- [ ] **Step 3: Typecheck + build**

Run: `cd C:/Users/dasbl/WebstormProjects/nudgepay/nudgepay-app && npx tsc --noEmit && npx react-router build`
Expected: tsc exit 0 (no unused `_isOwner` lint issue since it's now used); build clean.

- [ ] **Step 4: Verify existing AppShell tests still pass (if any)**

Run: `cd C:/Users/dasbl/WebstormProjects/nudgepay/nudgepay-app && npx vitest run` (filter to an AppShell test if one exists)
Expected: no regression. If a snapshot test exists and intentionally changes, update it.

- [ ] **Step 5: Commit**

```bash
git add nudgepay-app/app/components/AppShell.tsx
git commit -m "feat(reports): owner-only Reports nav link (C8)"
```

---

### Task 4: Verification sweep + gap-checklist + PR

**Files:**
- Modify: `docs/superpowers/2026-06-23-nudgepay-requirements-gap-checklist.md`

- [ ] **Step 1: Full sweep**

Run: `cd C:/Users/dasbl/WebstormProjects/nudgepay/nudgepay-app && npx vitest run && npx tsc --noEmit && npx react-router build`
Expected: all tests pass (baseline 311 + 5 new from Task 1); tsc exit 0; build clean. (Requires local Supabase for the DB-integration tests; the new `reports.test.ts` is pure and needs no DB.)

- [ ] **Step 2: Mark C8 complete in the gap checklist**

Edit `docs/superpowers/2026-06-23-nudgepay-requirements-gap-checklist.md` line for `C8`: change `[ ]` to `[x]` and append a completion note describing the four shipped metrics, the owner-gated `/reports` route, the pure `reports.ts` aggregator, and that collection-rate-by-aging-bucket stays deferred (no payment→invoice attribution).

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/2026-06-23-nudgepay-requirements-gap-checklist.md
git commit -m "docs: mark C8 complete in gap checklist (Phase 8)"
```

- [ ] **Step 4: Push and open the PR**

```bash
git push -u origin phase8-c8-team-reporting
gh pr create --base main --title "feat(8/C8): team performance & workload reporting" --body "Owner-gated /reports page: per-rep throughput, promise-kept rate, team time-to-first-contact, per-owner workload, over a 7/30/90-day window. Pure reports.ts aggregator + reports.tsx route + owner-only nav link. Collection-rate-by-aging-bucket deferred (no payment->invoice attribution)."
```

---

## Self-Review Notes

- **Spec coverage:** §4 architecture → Tasks 1 (reports.ts), 2 (reports.tsx), 3 (AppShell); §5 owner gate → Task 2 loader redirect + Task 3 nav; §6 metric definitions → Task 1 `buildTeamReport` + tests; §7 data flow → Task 2 loader; §8 UI → Task 2 component; §9 testing → Task 1 tests + Task 4 sweep. Collection-rate-by-bucket explicitly out (Task 4 note).
- **Deviation from spec §7 (documented):** workload uses a lighter self-contained read in the loader (open cases + per-customer owner/overdue + broken-promise set) feeding `buildTeamReport`, reusing the pure `isCaseSuppressed`, instead of reusing the dashboard's `buildCaseItems`. Rationale: reusing `buildCaseItems` would require duplicating ~110 lines of the dashboard loader or refactoring the app's core screen (entangled with collision/presence) — higher risk for identical output. The metric values (per-owner open cases / overdue $ / broken promises) are unchanged.
- **Type consistency:** `TeamReport`/`RepRow`/`FirstContactSummary`/`WorkloadRow`/`Report*` input types defined in Task 1 are consumed unchanged in Task 2. `ReportRange`/`REPORT_RANGES` used in both. `isCaseSuppressed` call matches `cases.ts` usage.
- **Placeholder scan:** none — all steps carry concrete code/commands. The "copy imports from dashboard.tsx" instruction is a path-accuracy safeguard, not a placeholder (the helper names are enumerated).
- **Timezone:** date-only `today`/`windowStart` via string slice + `addCalendarDays`; timestamp diffs via `new Date(iso).getTime()` (instants, correct).
