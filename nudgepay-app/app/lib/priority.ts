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
function balancePoints(balance: number): number {
  if (balance >= 25_000) return 25;
  if (balance >= 10_000) return 18;
  if (balance >= HIGH_VALUE_THRESHOLD) return 12; // 5000
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
function levelOf(score: number): { level: PriorityLevel; tone: HeatBand; rank: number } {
  if (score >= 80) return { level: "Critical", tone: "hot", rank: 0 };
  if (score >= 50) return { level: "High", tone: "warm", rank: 1 };
  if (score >= 25) return { level: "Medium", tone: "warm", rank: 2 };
  return { level: "Low", tone: "cool", rank: 3 };
}

export function levelToRank(level: PriorityLevel): number {
  return level === "Critical" ? 0 : level === "High" ? 1 : level === "Medium" ? 2 : 3;
}

const OVERRIDE_TO_LEVEL: Record<PriorityOverrideLevel, PriorityLevel> = {
  critical: "Critical", high: "High", medium: "Medium", low: "Low",
};
export function overrideToLevel(o: PriorityOverrideLevel | null): PriorityLevel | null {
  return o ? OVERRIDE_TO_LEVEL[o] : null;
}

export function scorePriority(input: PriorityFactorInput): ScoredPriority {
  const factors: PriorityFactor[] = [];

  const ageP = agePoints(input.ageDays);
  if (ageP > 0) factors.push({ key: "age", label: `${input.ageDays} days overdue`, points: ageP });

  const balP = balancePoints(input.balance);
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
  const { level, tone, rank } = levelOf(score);
  const reason = factors.length ? factors.slice(0, 2).map((f) => f.label).join(", ") : "Not yet due";
  return { score, level, tone, rank, reason, factors };
}
