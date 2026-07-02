import { test, expect } from "vitest";
import { computeLateFee, DEFAULT_LATE_FEE_CONFIG, type LateFeeConfig } from "../app/lib/late-fees";

const cfg = (overrides: Partial<LateFeeConfig> = {}): LateFeeConfig => ({
  ...DEFAULT_LATE_FEE_CONFIG,
  enabled: true,
  ...overrides,
});

// ---------------------------------------------------------------------------
// Disabled / zero / negative guard
// ---------------------------------------------------------------------------

test("returns 0 when disabled", () => {
  expect(computeLateFee(1000, 60, cfg({ enabled: false }))).toBe(0);
});

test("returns 0 when balance is 0", () => {
  expect(computeLateFee(0, 60, cfg({ monthlyPercent: 1.5 }))).toBe(0);
});

test("returns 0 when balance is negative", () => {
  expect(computeLateFee(-100, 60, cfg({ monthlyPercent: 1.5 }))).toBe(0);
});

test("returns 0 when age is within grace period", () => {
  expect(computeLateFee(1000, 10, cfg({ graceDays: 10, monthlyPercent: 1.5 }))).toBe(0);
  expect(computeLateFee(1000, 5, cfg({ graceDays: 10, monthlyPercent: 1.5 }))).toBe(0);
});

// ---------------------------------------------------------------------------
// Grace boundary
// ---------------------------------------------------------------------------

test("charges start at graceDays + 1", () => {
  const c = cfg({ graceDays: 10, monthlyPercent: 1.5 });
  expect(computeLateFee(1000, 10, c)).toBe(0);   // at grace
  expect(computeLateFee(1000, 11, c)).toBe(15);   // 1 full month past grace
});

// ---------------------------------------------------------------------------
// Month rollover
// ---------------------------------------------------------------------------

test("one full month past grace", () => {
  // graceDays=0, 1 day overdue → months=1 → 1.5% of 1000 = 15
  expect(computeLateFee(1000, 1, cfg({ monthlyPercent: 1.5 }))).toBe(15);
});

test("30 days past grace → still 1 month", () => {
  // graceDays=0, 30 days → months = floor((30-0-1)/30)+1 = floor(29/30)+1 = 0+1 = 1
  expect(computeLateFee(1000, 30, cfg({ monthlyPercent: 1.5 }))).toBe(15);
});

test("31 days past grace → 2 months", () => {
  // graceDays=0, 31 days → months = floor((31-0-1)/30)+1 = 1+1 = 2
  expect(computeLateFee(1000, 31, cfg({ monthlyPercent: 1.5 }))).toBe(30);
});

test("90 days past 10 grace → 3 months", () => {
  // months = floor((90-10-1)/30)+1 = floor(79/30)+1 = 2+1 = 3
  expect(computeLateFee(1000, 90, cfg({ graceDays: 10, monthlyPercent: 2 }))).toBe(60);
});

// ---------------------------------------------------------------------------
// Flat fee
// ---------------------------------------------------------------------------

test("flat fee only", () => {
  expect(computeLateFee(1000, 5, cfg({ flatAmount: 25 }))).toBe(25);
});

test("flat + percent combined", () => {
  // 1 month, 1.5% of 1000 = 15, + $25 flat = $40
  expect(computeLateFee(1000, 1, cfg({ monthlyPercent: 1.5, flatAmount: 25 }))).toBe(40);
});

// ---------------------------------------------------------------------------
// Rounding
// ---------------------------------------------------------------------------

test("rounds to cents", () => {
  // 1.5% of 333 = 4.995 → 5.00
  expect(computeLateFee(333, 1, cfg({ monthlyPercent: 1.5 }))).toBe(5);
});

test("rounds fractional combined fee", () => {
  // 1.5% of 777 = 11.655 + $0.33 flat = 11.985 → 11.99
  expect(computeLateFee(777, 1, cfg({ monthlyPercent: 1.5, flatAmount: 0.33 }))).toBe(11.99);
});
