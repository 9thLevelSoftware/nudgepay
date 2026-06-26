import { expect, test } from "vitest";
import { buildTeamReport, activeBrokenCaseIds } from "../app/lib/reports";

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
