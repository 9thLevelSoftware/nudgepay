// Pure CDC cron ordering + time-budget decisions. No I/O — the scheduled
// handler persists `cron_checkpoints` and runs per-org work around these
// helpers so unit tests can cover wrap/resume without sleeping.

export const CDC_CHECKPOINT_JOB = "cdc";
export const DEFAULT_CDC_BUDGET_MS = 20_000;

export function parseCdcBudgetMs(
  raw: string | undefined | null,
  fallback: number = DEFAULT_CDC_BUDGET_MS,
): number {
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

export function sortOrgIds(ids: readonly string[]): string[] {
  return [...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** Start at `checkpointOrgId` (or the next surviving id) and wrap. */
export function rotateFromCheckpoint(
  sortedIds: readonly string[],
  checkpointOrgId: string | null | undefined,
): string[] {
  if (!checkpointOrgId || sortedIds.length === 0) return [...sortedIds];
  let idx = sortedIds.indexOf(checkpointOrgId);
  if (idx < 0) {
    idx = sortedIds.findIndex((id) => id > checkpointOrgId);
    if (idx < 0) idx = 0;
  }
  if (idx === 0) return [...sortedIds];
  return [...sortedIds.slice(idx), ...sortedIds.slice(0, idx)];
}

export function planOrderedOrgIds(
  orgIds: readonly string[],
  checkpointOrgId: string | null | undefined,
): string[] {
  return rotateFromCheckpoint(sortOrgIds(orgIds), checkpointOrgId);
}

export function isCdcBudgetExhausted(
  startedAtMs: number,
  nowMs: number,
  budgetMs: number,
): boolean {
  return nowMs - startedAtMs >= budgetMs;
}

export type CdcLoopStep =
  | { action: "process"; orgId: string }
  | { action: "checkpoint"; nextOrgId: string }
  | { action: "complete" };

/**
 * Decide the next loop action. Index 0 always processes so a tight remaining
 * budget still makes progress; later orgs yield a checkpoint of the *next*
 * org_id when the budget is exhausted. Completing the rotated list clears.
 */
export function nextCdcLoopStep(
  orderedIds: readonly string[],
  index: number,
  startedAtMs: number,
  nowMs: number,
  budgetMs: number,
): CdcLoopStep {
  if (index >= orderedIds.length) return { action: "complete" };
  const orgId = orderedIds[index]!;
  if (index > 0 && isCdcBudgetExhausted(startedAtMs, nowMs, budgetMs)) {
    return { action: "checkpoint", nextOrgId: orgId };
  }
  return { action: "process", orgId };
}
