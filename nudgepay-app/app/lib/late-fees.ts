// Pure display-only late-fee calculation (C2). No I/O, no .server suffix.
// Computes an estimated late fee based on org config. Never written to QBO.

export type LateFeeConfig = {
  enabled: boolean;
  graceDays: number;
  monthlyPercent: number;
  flatAmount: number;
};

export const DEFAULT_LATE_FEE_CONFIG: LateFeeConfig = Object.freeze({
  enabled: false,
  graceDays: 0,
  monthlyPercent: 0,
  flatAmount: 0,
});

/**
 * Compute the display-only estimated late fee for a single invoice.
 *
 * Formula: full months past grace, assessed on the current balance.
 *   - ageDays <= graceDays        → 0 (within grace period)
 *   - graceDays+1 .. graceDays+30 → 1 month
 *   - graceDays+31 .. graceDays+60 → 2 months, etc.
 *   - fee = flatAmount + balance × (monthlyPercent/100) × months
 *   - rounded to cents
 *
 * Deterministic from due_date + today alone: no accrual state, no history.
 * Fee is on current balance so partial payments shrink the displayed estimate.
 */
export function computeLateFee(
  balance: number,
  ageDays: number,
  cfg: LateFeeConfig,
): number {
  if (!cfg.enabled || ageDays <= cfg.graceDays || balance <= 0) return 0;
  const months = Math.floor((ageDays - cfg.graceDays - 1) / 30) + 1;
  const fee = cfg.flatAmount + balance * (cfg.monthlyPercent / 100) * months;
  return Math.round(fee * 100) / 100;
}
