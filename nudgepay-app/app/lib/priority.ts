// Pure multi-factor priority scoring. No I/O, no node:*, no .server suffix —
// imported by cases.ts and by tests. Weights are named constants here; full
// configurability (per-org tuning) is deferred to C7.

import { HIGH_VALUE_THRESHOLD, type HeatBand, type Priority } from "./worklist";

export type PriorityLevel = Priority["level"]; // "Critical" | "High" | "Medium" | "Low"
export type PriorityOverrideLevel = "critical" | "high" | "medium" | "low";
export type PriorityFactor = { key: string; label: string; points: number };

export type PriorityFactorInput = {
  ageDays: number;
  balance: number;
  brokenPromise: boolean;
  daysSinceContact: number | null; // null = never contacted (treated as max silence)
  followUpDue: boolean;
};

export type ScoredPriority = {
  score: number;
  level: PriorityLevel;
  tone: HeatBand;
  rank: number;
  reason: string;
  factors: PriorityFactor[]; // non-zero contributors, descending by points
};

// --- weights (named constants) ---
function agePoints(ageDays: number): number {
  if (ageDays >= 90) return 45;
  if (ageDays >= 60) return 32;
  if (ageDays >= 30) return 20;
  if (ageDays >= 1) return 8;
  return 0;
}
// The 12-point tier follows the org's high-value threshold (the org's own
// definition of "high value"); the 25k/10k/1k tiers and point weights stay
// fixed constants — only that one boundary is configurable.
function balancePoints(balance: number, highValueThreshold: number = HIGH_VALUE_THRESHOLD): number {
  if (balance >= 25_000) return 25;
  if (balance >= 10_000) return 18;
  if (balance >= highValueThreshold) return 12;
  if (balance >= 1_000) return 6;
  if (balance > 0) return 2;
  return 0;
}
const BROKEN_PROMISE_POINTS = 25;
function silencePoints(daysSinceContact: number | null): number {
  if (daysSinceContact === null) return 15; // never contacted = max silence
  if (daysSinceContact >= 30) return 15;
  if (daysSinceContact >= 14) return 10;
  if (daysSinceContact >= 7) return 5;
  return 0;
}
const FOLLOW_UP_DUE_POINTS = 12;

// --- level thresholds ---
const LEVEL_META: Record<PriorityLevel, { tone: HeatBand; rank: number }> = {
  Critical: { tone: "hot", rank: 0 },
  High: { tone: "warm", rank: 1 },
  Medium: { tone: "warm", rank: 2 },
  Low: { tone: "cool", rank: 3 },
};

export type PriorityThresholds = { criticalMin: number; highMin: number; mediumMin: number };
export const DEFAULT_PRIORITY_THRESHOLDS: PriorityThresholds = { criticalMin: 80, highMin: 50, mediumMin: 25 };

function levelOf(
  score: number,
  thresholds: PriorityThresholds = DEFAULT_PRIORITY_THRESHOLDS,
): { level: PriorityLevel; tone: HeatBand; rank: number } {
  const level: PriorityLevel =
    score >= thresholds.criticalMin ? "Critical"
    : score >= thresholds.highMin ? "High"
    : score >= thresholds.mediumMin ? "Medium"
    : "Low";
  return { level, ...LEVEL_META[level] };
}

export function levelToRank(level: PriorityLevel): number {
  return LEVEL_META[level].rank;
}

const OVERRIDE_TO_LEVEL: Record<PriorityOverrideLevel, PriorityLevel> = {
  critical: "Critical", high: "High", medium: "Medium", low: "Low",
};
export function overrideToLevel(o: PriorityOverrideLevel | null): PriorityLevel | null {
  return o ? OVERRIDE_TO_LEVEL[o] : null;
}

export type ScorePriorityOpts = {
  thresholds?: PriorityThresholds;
  highValueThreshold?: number;
};

export function scorePriority(input: PriorityFactorInput, opts: ScorePriorityOpts = {}): ScoredPriority {
  const factors: PriorityFactor[] = [];

  const ageP = agePoints(input.ageDays);
  if (ageP > 0) factors.push({ key: "age", label: `${input.ageDays} days overdue`, points: ageP });

  const balP = balancePoints(input.balance, opts.highValueThreshold);
  if (balP > 0) factors.push({ key: "balance", label: "Balance", points: balP });

  if (input.brokenPromise) factors.push({ key: "broken", label: "Broken promise", points: BROKEN_PROMISE_POINTS });

  const silP = silencePoints(input.daysSinceContact);
  if (silP > 0) factors.push({
    key: "silence",
    label: input.daysSinceContact === null ? "Never contacted" : `${input.daysSinceContact} days since contact`,
    points: silP,
  });

  if (input.followUpDue) factors.push({ key: "followup", label: "Follow-up due", points: FOLLOW_UP_DUE_POINTS });

  factors.sort((a, b) => b.points - a.points);
  const score = factors.reduce((s, f) => s + f.points, 0);
  const { level, tone, rank } = levelOf(score, opts.thresholds);
  const reason = factors.length ? factors.slice(0, 2).map((f) => f.label).join(", ") : "Not yet due";
  return { score, level, tone, rank, reason, factors };
}
