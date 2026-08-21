import { expect, test } from "vitest";
import {
  DEFAULT_CDC_BUDGET_MS,
  isCdcBudgetExhausted,
  nextCdcLoopStep,
  parseCdcBudgetMs,
  planOrderedOrgIds,
  rotateFromCheckpoint,
  sortOrgIds,
} from "../app/lib/cdc-budget";

const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const C = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const D = "dddddddd-dddd-dddd-dddd-dddddddddddd";

test("sortOrgIds is lexicographic and does not mutate input", () => {
  const raw = [C, A, B];
  expect(sortOrgIds(raw)).toEqual([A, B, C]);
  expect(raw).toEqual([C, A, B]);
});

test("planOrderedOrgIds sorts then starts at the checkpoint and wraps", () => {
  expect(planOrderedOrgIds([C, A, B], null)).toEqual([A, B, C]);
  expect(planOrderedOrgIds([C, A, B], B)).toEqual([B, C, A]);
  expect(planOrderedOrgIds([C, A, B], A)).toEqual([A, B, C]);
});

test("rotateFromCheckpoint resumes at the next surviving id when the checkpoint org is gone", () => {
  expect(rotateFromCheckpoint([A, C, D], B)).toEqual([C, D, A]);
  expect(rotateFromCheckpoint([A, B], D)).toEqual([A, B]);
  expect(rotateFromCheckpoint([], B)).toEqual([]);
});

test("parseCdcBudgetMs defaults and rejects non-positive values", () => {
  expect(parseCdcBudgetMs(undefined)).toBe(DEFAULT_CDC_BUDGET_MS);
  expect(parseCdcBudgetMs("")).toBe(DEFAULT_CDC_BUDGET_MS);
  expect(parseCdcBudgetMs("15000")).toBe(15_000);
  expect(parseCdcBudgetMs("0")).toBe(DEFAULT_CDC_BUDGET_MS);
  expect(parseCdcBudgetMs("-1")).toBe(DEFAULT_CDC_BUDGET_MS);
  expect(parseCdcBudgetMs("nope")).toBe(DEFAULT_CDC_BUDGET_MS);
});

test("isCdcBudgetExhausted is inclusive of the budget boundary", () => {
  expect(isCdcBudgetExhausted(1000, 1000, 20_000)).toBe(false);
  expect(isCdcBudgetExhausted(1000, 20_999, 20_000)).toBe(false);
  expect(isCdcBudgetExhausted(1000, 21_000, 20_000)).toBe(true);
});

test("nextCdcLoopStep always processes the first org even if the budget is already gone", () => {
  expect(nextCdcLoopStep([A, B, C], 0, 0, 20_000, 20_000)).toEqual({
    action: "process",
    orgId: A,
  });
});

test("nextCdcLoopStep checkpoints the next org_id once the budget is exhausted", () => {
  expect(nextCdcLoopStep([A, B, C], 1, 0, 20_000, 20_000)).toEqual({
    action: "checkpoint",
    nextOrgId: B,
  });
  expect(nextCdcLoopStep([A, B, C], 2, 0, 5_000, 20_000)).toEqual({
    action: "process",
    orgId: C,
  });
});

test("nextCdcLoopStep completes (clear checkpoint) after a full rotated pass", () => {
  expect(nextCdcLoopStep([B, C, A], 3, 0, 50_000, 20_000)).toEqual({
    action: "complete",
  });
  expect(nextCdcLoopStep([], 0, 0, 0, 20_000)).toEqual({ action: "complete" });
});

test("budgeted walk: process a prefix, persist next org, resume with wrap, then clear", () => {
  const ordered = planOrderedOrgIds([D, B, A, C], C);
  expect(ordered).toEqual([C, D, A, B]);

  let now = 0;
  const processed: string[] = [];
  let checkpoint: string | null = C;

  const drive = (budgetMs: number) => {
    const started = now;
    const queue = planOrderedOrgIds([D, B, A, C], checkpoint);
    processed.length = 0;
    for (let i = 0; ; i++) {
      const step = nextCdcLoopStep(queue, i, started, now, budgetMs);
      if (step.action === "complete") {
        checkpoint = null;
        break;
      }
      if (step.action === "checkpoint") {
        checkpoint = step.nextOrgId;
        break;
      }
      processed.push(step.orgId);
      now += 10;
    }
  };

  drive(20);
  expect(processed).toEqual([C, D]);
  expect(checkpoint).toBe(A);

  drive(50);
  expect(processed).toEqual([A, B, C, D]);
  expect(checkpoint).toBeNull();
});
