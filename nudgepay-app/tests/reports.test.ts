import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import {
  buildTeamReport, activeBrokenCaseIds, parseReportRange, parseReportSheet, teamReportToCsv,
  arKpisToCsv,
  type TeamReport,
} from "../app/lib/reports";
import { loadReportArKpis } from "../app/lib/reports.server";

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
    timeZone: undefined as string | undefined,
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

test("team report includes a complete daily trend series", () => {
  const input = base();
  input.contactLogs = [
    { userId: "u1", caseId: "c1", createdAt: "2026-06-20T10:00:00Z" },
  ];
  input.promises = [
    { createdBy: "u1", status: "kept", resolvedAt: "2026-06-21T10:00:00Z" },
  ];
  const report = buildTeamReport(input);
  expect(report.trends?.points).toHaveLength(30);
  expect(report.trends?.points.find((point) => point.date === "2026-06-20")).toMatchObject({ contacts: 1 });
  expect(report.trends?.points.find((point) => point.date === "2026-06-21")).toMatchObject({ resolved: 1, kept: 1 });
});

test("daily trends use the organization timezone instead of UTC dates", () => {
  const input = base();
  input.today = "2026-06-22";
  input.timeZone = "America/Los_Angeles";
  input.contactLogs = [{ userId: "u1", caseId: "c1", createdAt: "2026-06-21T06:30:00Z" }];
  input.promises = [{ createdBy: "u1", status: "kept", resolvedAt: "2026-06-22T06:30:00Z" }];
  const points = buildTeamReport(input).trends!.points;
  expect(points.find((point) => point.date === "2026-06-20")).toMatchObject({ contacts: 1 });
  expect(points.find((point) => point.date === "2026-06-21")).toMatchObject({ resolved: 1, kept: 1 });
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

// ── activeBrokenCaseIds ──────────────────────────────────────────────────────

test("activeBrokenCaseIds: old broken + newer pending → active is pending → NOT broken", () => {
  const rows = [
    { caseId: "c1", status: "broken" as const, createdAt: "2026-06-10T00:00:00Z" },
    { caseId: "c1", status: "pending" as const, createdAt: "2026-06-20T00:00:00Z" },
  ];
  const result = activeBrokenCaseIds(rows);
  expect(result.has("c1")).toBe(false);
  expect(result.size).toBe(0);
});

test("activeBrokenCaseIds: pending (older) + newer broken → pending preferred → NOT broken", () => {
  const rows = [
    { caseId: "c2", status: "pending" as const, createdAt: "2026-06-05T00:00:00Z" },
    { caseId: "c2", status: "broken" as const, createdAt: "2026-06-25T00:00:00Z" },
  ];
  const result = activeBrokenCaseIds(rows);
  expect(result.has("c2")).toBe(false);
  expect(result.size).toBe(0);
});

test("activeBrokenCaseIds: only broken promise → case IS in the set", () => {
  const rows = [
    { caseId: "c3", status: "broken" as const, createdAt: "2026-06-15T00:00:00Z" },
  ];
  const result = activeBrokenCaseIds(rows);
  expect(result.has("c3")).toBe(true);
  expect(result.size).toBe(1);
});

test("activeBrokenCaseIds: broken then newer renegotiated → active is renegotiated → NOT broken", () => {
  const rows = [
    { caseId: "c4", status: "broken" as const, createdAt: "2026-06-10T00:00:00Z" },
    { caseId: "c4", status: "renegotiated" as const, createdAt: "2026-06-18T00:00:00Z" },
  ];
  const result = activeBrokenCaseIds(rows);
  expect(result.has("c4")).toBe(false);
  expect(result.size).toBe(0);
});

test("activeBrokenCaseIds: cancelled row is ignored when determining active promise", () => {
  // Only a cancelled row exists → treated as if no promises → not broken
  const rows = [
    { caseId: "c5", status: "cancelled" as const, createdAt: "2026-06-20T00:00:00Z" },
  ];
  const result = activeBrokenCaseIds(rows);
  expect(result.has("c5")).toBe(false);
  expect(result.size).toBe(0);
});

test("activeBrokenCaseIds: cancelled row beside a broken row → broken is active → IS broken", () => {
  const rows = [
    { caseId: "c6", status: "cancelled" as const, createdAt: "2026-06-25T00:00:00Z" },
    { caseId: "c6", status: "broken" as const, createdAt: "2026-06-15T00:00:00Z" },
  ];
  const result = activeBrokenCaseIds(rows);
  expect(result.has("c6")).toBe(true);
  expect(result.size).toBe(1);
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

// ── CSV export ───────────────────────────────────────────────────────────────

test("parseReportRange: accepts 7/30/90 and defaults everything else to 30", () => {
  expect(parseReportRange("7")).toBe(7);
  expect(parseReportRange("30")).toBe(30);
  expect(parseReportRange("90")).toBe(90);
  expect(parseReportRange(null)).toBe(30);
  expect(parseReportRange("14")).toBe(30);
  expect(parseReportRange("abc")).toBe(30);
});

test("parseReportSheet: ar is explicit; everything else defaults to team", () => {
  expect(parseReportSheet("ar")).toBe("ar");
  expect(parseReportSheet("team")).toBe("team");
  expect(parseReportSheet(null)).toBe("team");
  expect(parseReportSheet(undefined)).toBe("team");
  expect(parseReportSheet("")).toBe("team");
  expect(parseReportSheet("AR")).toBe("team");
  expect(parseReportSheet("receivables")).toBe("team");
});

test("teamReportToCsv: header + per-rep rows; null keptRate is blank", () => {
  const input = base();
  input.contactLogs = [
    { userId: "u1", caseId: "c1", createdAt: "2026-06-20T10:00:00Z" },
  ];
  input.promises = [
    { createdBy: "u1", status: "kept", resolvedAt: "2026-06-20T00:00:00Z" },
    { createdBy: "u1", status: "kept", resolvedAt: "2026-06-21T00:00:00Z" },
  ];
  const csv = teamReportToCsv(buildTeamReport(input));
  expect(csv).toBe(
    "label,contactsLogged,casesTouched,kept,partiallyKept,broken,resolved,keptRate\n" +
    "alice,1,1,2,0,0,2,1\n" +
    "bob,0,0,0,0,0,0,\n",
  );
});

test("teamReportToCsv: quotes fields that contain commas, quotes, or newlines", () => {
  const report: TeamReport = {
    range: 30,
    perRep: [
      {
        userId: "u1", label: 'Smith, "Ace"',
        contactsLogged: 1, casesTouched: 1,
        kept: 0, partiallyKept: 0, broken: 0, resolved: 0, keptRate: null,
      },
      {
        userId: "u2", label: "line\nbreak",
        contactsLogged: 0, casesTouched: 0,
        kept: 1, partiallyKept: 0, broken: 0, resolved: 1, keptRate: 0.5,
      },
    ],
    firstContact: { medianHours: null, avgHours: null, within24hPct: null, contacted: 0, uncontacted: 0 },
    workload: [],
  };
  expect(teamReportToCsv(report)).toBe(
    "label,contactsLogged,casesTouched,kept,partiallyKept,broken,resolved,keptRate\n" +
    "\"Smith, \"\"Ace\"\"\",1,1,0,0,0,0,\n" +
    "\"line\nbreak\",0,0,1,0,0,1,0.5\n",
  );
});

test("arKpisToCsv is reused from ar-kpis (blank nulls, coverage column)", () => {
  const csv = arKpisToCsv({
    rangeDays: 7,
    asOf: "2026-08-21",
    dso: null,
    bestPossibleDso: null,
    cei: null,
    contactRate: null,
    promiseRate: null,
    collected: 0,
    coverage: "empty",
    truncated: false,
    inputs: {
      endingTotalAr: 0, endingCurrentAr: 0, creditSales: 0, collections: 0,
      openCases: 0, contactedOpenCases: 0, promisesCreated: 0,
    },
  });
  expect(csv).toBe(
    "asOf,rangeDays,endingTotalAr,endingCurrentAr,creditSales,collections,openCases,contactedOpenCases,promisesCreated,dso,bestPossibleDso,cei,contactRate,promiseRate,collected,coverage\n" +
    "2026-08-21,7,0,0,0,0,0,0,0,,,,,,0,empty\n",
  );
});

// ── Reports page / CSV wiring ────────────────────────────────────────────────

test("reports page renders ArKpiBand for the selected range and stays admin-only", () => {
  const page = readFileSync(new URL("../app/routes/reports.tsx", import.meta.url), "utf8");
  expect(page).toContain("requireAdmin: true");
  expect(page).toContain("loadReportArKpis");
  expect(page).toContain("loadTeamReport");
  expect(page).toContain("<ArKpiBand");
  expect(page).toMatch(/<ArKpiBand[\s\S]*connected=\{connected\}/);
  expect(page).toContain("sheet=ar");
  expect(page).toContain("hideTeam");
  expect(page).toContain("Could not load report");
  expect(page).toContain("!report.truncated");
  expect(page).toContain("!arKpis.truncated");
  expect(page).not.toContain("lastContactsInput");
  expect(page).not.toContain("CasePromiseInput");
  expect(page).not.toContain("DASHBOARD_AR_RANGE_DAYS");
});

test("reports.server loads AR KPIs with the selected range, not Stage-2 last-contact", () => {
  const server = readFileSync(new URL("../app/lib/reports.server.ts", import.meta.url), "utf8");
  expect(server).toContain("loadArKpiSource");
  expect(server).toContain("loadContactPromiseRates");
  expect(server).toContain("rangeDays: range");
  expect(server).toContain("pageAll");
  expect(server).toContain("orderPage");
  expect(server).toContain('count: "exact"');
  expect(server).toContain("rates.truncated || openCases.truncated");
  expect(server).toContain("localMidnightUtcIso");
  expect(server).not.toContain("lastContactsInput");
  expect(server).not.toContain("CasePromiseInput");
  expect(server).not.toContain("DASHBOARD_AR_RANGE_DAYS");
});

test("reports.csv sheet=ar uses arKpisToCsv; default team skips AR queries", () => {
  const csvRoute = readFileSync(new URL("../app/routes/reports.csv.tsx", import.meta.url), "utf8");
  expect(csvRoute).toContain("requireAdmin: true");
  expect(csvRoute).toContain("parseReportSheet");
  expect(csvRoute).toContain('sheet === "ar"');
  expect(csvRoute).toContain("arKpisToCsv");
  expect(csvRoute).toContain("teamReportToCsv");
  expect(csvRoute).toContain("loadReportArKpis");
  expect(csvRoute).toContain("nudgepay-ar-");
  // Team branch must not pull AR source (unused queries still run).
  const arBranch = csvRoute.slice(csvRoute.indexOf('sheet === "ar"'), csvRoute.indexOf("} else {"));
  const teamBranch = csvRoute.slice(csvRoute.indexOf("} else {"));
  expect(arBranch).toContain("loadReportArKpis");
  expect(arBranch).not.toContain("loadTeamReport");
  expect(teamBranch).toContain("loadTeamReport");
  expect(teamBranch).not.toContain("loadReportArKpis");
  expect(csvRoute).toContain("status: 409");
  expect(csvRoute).toContain("status: 503");
  expect(csvRoute).toContain("report.truncated");
  expect(csvRoute).toContain("arKpis.truncated");
  expect(csvRoute).toContain("arKpis.loadError");
  expect(csvRoute).toContain("report.loadError");
});

// ── loadReportArKpis open-case paging ────────────────────────────────────────

type TableRows = { rows: Record<string, unknown>[]; count?: number; error?: { message: string } | null };
type FilterCall = { method: string; args: unknown[] };
type OrderCall = { column: string; ascending: boolean };
type QueryCall = { table: string; select: string; count?: string; filters: FilterCall[]; orders: OrderCall[] };

const STABLE_PAGE_ORDER: OrderCall[] = [
  { column: "created_at", ascending: false },
  { column: "id", ascending: false },
];

function makeClient(tables: Record<string, TableRows>) {
  const calls: QueryCall[] = [];
  const client = {
    from(table: string) {
      const src = tables[table] ?? { rows: [] };
      const state = {
        select: "",
        count: undefined as string | undefined,
        filters: [] as FilterCall[],
        orders: [] as OrderCall[],
        from: 0,
        to: Number.POSITIVE_INFINITY,
      };
      const applyFilters = () => {
        let rows = src.rows;
        for (const f of state.filters) {
          if (f.method === "eq") {
            const [col, val] = f.args as [string, unknown];
            rows = rows.filter((r) => r[col] === val);
          } else if (f.method === "gt") {
            const [col, val] = f.args as [string, number];
            rows = rows.filter((r) => Number(r[col]) > val);
          } else if (f.method === "gte") {
            const [col, val] = f.args as [string, string | number];
            rows = rows.filter((r) => r[col] != null && (r[col] as string | number) >= val);
          } else if (f.method === "lte") {
            const [col, val] = f.args as [string, string | number];
            rows = rows.filter((r) => r[col] != null && (r[col] as string | number) <= val);
          } else if (f.method === "neq") {
            const [col, val] = f.args as [string, unknown];
            rows = rows.filter((r) => r[col] !== val);
          } else if (f.method === "not") {
            const [col, op] = f.args as [string, string];
            if (op === "is") rows = rows.filter((r) => r[col] != null);
          } else if (f.method === "in") {
            const [col, ids] = f.args as [string, string[]];
            const idSet = new Set(ids);
            rows = rows.filter((r) => typeof r[col] === "string" && idSet.has(r[col] as string));
          } else if (f.method === "is") {
            const [col, val] = f.args as [string, unknown];
            rows = rows.filter((r) => r[col] == val);
          }
        }
        return rows;
      };
      const q: Record<string, unknown> = {
        select(cols: string, opts?: { count?: string }) {
          state.select = cols;
          state.count = opts?.count;
          return q;
        },
        eq(...args: unknown[]) { state.filters.push({ method: "eq", args }); return q; },
        gt(...args: unknown[]) { state.filters.push({ method: "gt", args }); return q; },
        gte(...args: unknown[]) { state.filters.push({ method: "gte", args }); return q; },
        lte(...args: unknown[]) { state.filters.push({ method: "lte", args }); return q; },
        neq(...args: unknown[]) { state.filters.push({ method: "neq", args }); return q; },
        not(...args: unknown[]) { state.filters.push({ method: "not", args }); return q; },
        in(col: string, ids: string[]) { state.filters.push({ method: "in", args: [col, ids] }); return q; },
        is(...args: unknown[]) { state.filters.push({ method: "is", args }); return q; },
        order(column: string, opts?: { ascending?: boolean }) {
          state.orders.push({ column, ascending: opts?.ascending ?? true });
          return q;
        },
        range(from: number, to: number) { state.from = from; state.to = to; return q; },
        maybeSingle() {
          const rows = applyFilters();
          return Promise.resolve({ data: rows[0] ?? null, error: src.error ?? null });
        },
        then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
          const rows = applyFilters();
          calls.push({
            table,
            select: state.select,
            count: state.count,
            filters: [...state.filters],
            orders: [...state.orders],
          });
          return Promise.resolve({
            data: rows.slice(state.from, state.to + 1),
            count: src.count ?? rows.length,
            error: src.error ?? null,
          }).then(resolve, reject);
        },
      };
      return q;
    },
  };
  return { client: client as any, calls };
}

const AR_FIXTURE = {
  invoices: {
    rows: [
      { org_id: "org-1", amount: 100, balance: 100, invoice_date: "2026-08-11", due_date: "2026-08-21", customer_id: "cust-1", created_at: "t1", id: "i1" },
    ],
  },
  payments: { rows: [] as Record<string, unknown>[] },
  org_settings: { rows: [] as Record<string, unknown>[] },
  org_holidays: { rows: [] as Record<string, unknown>[] },
  contact_logs: {
    rows: [{ org_id: "org-1", case_id: "c1", method: "call", created_at: new Date(Date.now() - 86_400_000).toISOString() }],
  },
  text_messages: { rows: [] as Record<string, unknown>[] },
  email_messages: { rows: [] as Record<string, unknown>[] },
  promises: { rows: [] as Record<string, unknown>[] },
};

test("loadReportArKpis pages open cases with stable ORDER BY and count", async () => {
  const { client, calls } = makeClient({
    ...AR_FIXTURE,
    collection_cases: {
      rows: [{ org_id: "org-1", id: "c1", status: "working", exception_reason: null, next_action_at: null, created_at: "t1", closed_at: null }],
    },
  });
  const kpis = await loadReportArKpis({ supabase: client, orgId: "org-1", range: 30 });
  expect(kpis.contactRate).toBe(1);
  expect(kpis.coverage).not.toBe("empty");

  const caseCalls = calls.filter((c) => c.table === "collection_cases");
  expect(caseCalls.length).toBeGreaterThan(0);
  expect(caseCalls[0].count).toBe("exact");
  expect(caseCalls[0].filters.some((f) => f.method === "is" && f.args[0] === "closed_at")).toBe(true);
  expect(caseCalls.every((c) => JSON.stringify(c.orders) === JSON.stringify(STABLE_PAGE_ORDER))).toBe(true);
});

test("loadReportArKpis truncated open-case page nulls rates instead of looking complete", async () => {
  const { client } = makeClient({
    ...AR_FIXTURE,
    collection_cases: {
      rows: [{ org_id: "org-1", id: "c1", status: "working", exception_reason: null, next_action_at: null, created_at: "t1", closed_at: null }],
      count: 6000,
    },
  });
  const kpis = await loadReportArKpis({ supabase: client, orgId: "org-1", range: 7 });
  expect(kpis.rangeDays).toBe(7);
  expect(kpis.contactRate).toBeNull();
  expect(kpis.promiseRate).toBeNull();
  expect(kpis.coverage).toBe("partial");
  expect(kpis.truncated).toBe(true);
});

test("loadReportArKpis query error does not throw and does not paint 0% rates", async () => {
  const { client } = makeClient({
    ...AR_FIXTURE,
    collection_cases: { rows: [], error: { message: "boom" } },
  });
  const kpis = await loadReportArKpis({ supabase: client, orgId: "org-1", range: 30 });
  expect(kpis.contactRate).toBeNull();
  expect(kpis.promiseRate).toBeNull();
  expect(kpis.loadError).toBe("Could not load report");
  expect(kpis.truncated).toBe(false);
});
