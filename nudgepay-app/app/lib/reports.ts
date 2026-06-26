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
