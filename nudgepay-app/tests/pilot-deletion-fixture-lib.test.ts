import { expect, test } from "vitest";
import {
  DELETION_FIXTURE_TABLES,
  FIXTURE_ROWS_PER_TABLE,
  assertLocalDeletionUrl,
  buildDeletionFixturePlan,
  evaluateDeletionMeasurement,
  parseDeletionFixtureArgs,
  sanitizeDeletionEvidence,
} from "../scripts/pilot-deletion-fixture-lib.mjs";

test("builds deterministic target and control plans with 5,000 rows in every deletion table", () => {
  const first = buildDeletionFixturePlan();
  const second = buildDeletionFixturePlan();

  expect(first).toEqual(second);
  expect(first.target.id).not.toBe(first.control.id);
  expect(first.target.owner.email).not.toContain("password");
  expect(Object.values(first.target.counts)).toEqual(Array(DELETION_FIXTURE_TABLES.length).fill(FIXTURE_ROWS_PER_TABLE));
  expect(Object.keys(first.target.counts)).toEqual(DELETION_FIXTURE_TABLES);
  expect(first.target.rows.promises[1].replacement_promise_id).toBe(first.target.rows.promises[0].id);
  expect(first.target.rows.promises[0].replacement_promise_id).toBeNull();
  expect(first.target.rows.promises[13].contact_log_id).toBe(first.target.rows.contact_logs[13].id);
});

test("accepts only the exact local Supabase API origin", () => {
  expect(assertLocalDeletionUrl("http://127.0.0.1:54321")).toBe("http://127.0.0.1:54321/");
  for (const value of [
    "https://127.0.0.1:54321",
    "http://localhost:54321",
    "http://127.0.0.1:54322",
    "http://token@127.0.0.1:54321",
    "http://127.0.0.1:54321/rest/v1",
  ]) expect(() => assertLocalDeletionUrl(value)).toThrow(/127\.0\.0\.1:54321/);
});

test("defaults to a no-I/O dry run and requires explicit seed or measure modes", () => {
  expect(parseDeletionFixtureArgs([])).toEqual({ dryRun: true, seed: false, measure: false, seedAndMeasure: false, help: false });
  expect(() => parseDeletionFixtureArgs(["--seed"])).toThrow(/--output is required/i);
  expect(() => parseDeletionFixtureArgs(["--measure"])).toThrow(/--output is required/i);
  expect(() => parseDeletionFixtureArgs(["--seed", "--measure"])).toThrow(/one mutation mode/i);
  expect(() => parseDeletionFixtureArgs(["--unknown"])).toThrow(/Unknown argument/);
});

test("accepts an explicit evidence destination without changing mutation selection", () => {
  expect(parseDeletionFixtureArgs(["--measure", "--output", "C:\\evidence\\deletion.json"])).toEqual({
    dryRun: false, seed: false, measure: true, seedAndMeasure: false, help: false, output: "C:\\evidence\\deletion.json",
  });
  expect(() => parseDeletionFixtureArgs(["--output"])).toThrow(/requires a value/);
});

test("requires two destinations for an atomic seed-and-measure fixture run", () => {
  expect(parseDeletionFixtureArgs([
    "--seed-and-measure",
    "--seed-output", "C:\\evidence\\seed.json",
    "--measure-output", "C:\\evidence\\measure.json",
  ])).toMatchObject({ dryRun: false, seedAndMeasure: true });
  expect(() => parseDeletionFixtureArgs(["--seed-and-measure"])).toThrow(/seed-output.*measure-output/i);
});

test("emits evidence containing only aggregate results and fixture identifiers", () => {
  const plan = buildDeletionFixturePlan();
  const evidence = sanitizeDeletionEvidence({
    plan,
    durationMs: 891,
    requestResult: { ok: true, status: 204 },
    tombstone: { org_id: plan.target.id, org_name: plan.target.name, member_count: 1, deleted_by: plan.target.owner.id },
    controlExists: true,
    observedCounts: { target: { ...plan.target.counts, customers: 4_999 }, control: plan.control.counts },
    scriptHash: "a".repeat(64),
    secret: "must-not-leak",
  });

  expect(evidence).toMatchObject({ durationMs: 891, requestResult: { ok: true, status: 204 }, controlExists: true, scriptHash: "a".repeat(64) });
  expect(JSON.stringify(evidence)).not.toContain("must-not-leak");
  expect(JSON.stringify(evidence)).not.toContain("password");
  expect(evidence.target.counts).toEqual({ ...plan.target.counts, customers: 4_999 });
  expect(evidence.control.counts).toEqual(plan.control.counts);

  const unknownControlEvidence = sanitizeDeletionEvidence({
    plan,
    observedCounts: { target: plan.target.counts, control: plan.control.counts },
    durationMs: null,
    requestResult: { ok: false, status: null },
    tombstone: null,
    controlExists: null,
    scriptHash: "b".repeat(64),
  });
  expect(unknownControlEvidence.controlExists).toBeNull();
});

test("rejects a stale tombstone even when all target rows are gone", () => {
  const plan = buildDeletionFixturePlan();
  const result = evaluateDeletionMeasurement({
    plan,
    ownerId: "actual-owner-id",
    startedAt: "2026-09-05T12:00:00.000Z",
    rpcStatus: 204,
    rpcError: null,
    targetExists: false,
    targetCounts: Object.fromEntries(DELETION_FIXTURE_TABLES.map((table) => [table, 0])),
    controlCounts: plan.control.counts,
    tombstone: { org_id: plan.target.id, org_name: plan.target.name, member_count: 1, deleted_by: "actual-owner-id", deleted_at: "2026-09-05T11:59:59.999Z" },
  });

  expect(result.passed).toBe(false);
  expect(result.verification.tombstoneNew).toBe(false);
});

test("rejects a deletion report with lingering target rows or a changed control", () => {
  const plan = buildDeletionFixturePlan();
  const result = evaluateDeletionMeasurement({
    plan,
    ownerId: "actual-owner-id",
    startedAt: "2026-09-05T12:00:00.000Z",
    rpcStatus: 204,
    rpcError: null,
    targetExists: false,
    targetCounts: { ...Object.fromEntries(DELETION_FIXTURE_TABLES.map((table) => [table, 0])), payments: 1 },
    controlCounts: { ...plan.control.counts, emails: 4_999 },
    tombstone: { org_id: plan.target.id, org_name: plan.target.name, member_count: 1, deleted_by: "actual-owner-id", deleted_at: "2026-09-05T12:00:00.001Z" },
  });

  expect(result.passed).toBe(false);
  expect(result.verification.targetTablesGone).toBe(false);
  expect(result.verification.controlUnchanged).toBe(false);
});

test("retains a failed RPC's actual status in a failed evidence result", () => {
  const plan = buildDeletionFixturePlan();
  const result = evaluateDeletionMeasurement({
    plan,
    ownerId: "actual-owner-id",
    startedAt: "2026-09-05T12:00:00.000Z",
    rpcStatus: 409,
    rpcError: { code: "PT409" },
    targetExists: true,
    targetCounts: plan.target.counts,
    controlCounts: plan.control.counts,
    tombstone: null,
  });

  expect(result.passed).toBe(false);
  expect(result.requestResult).toEqual({ ok: false, status: 409, errorCode: "PT409" });
});
