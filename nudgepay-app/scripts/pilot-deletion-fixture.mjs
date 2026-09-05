#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { acquireLocalDbHarnessLock } from "./local-db-harness-lock.mjs";
import {
  DELETION_FIXTURE_TABLES,
  assertLocalDeletionUrl,
  buildDeletionFixturePlan,
  evaluateDeletionMeasurement,
  parseDeletionFixtureArgs,
  sanitizeDeletionEvidence,
} from "./pilot-deletion-fixture-lib.mjs";

const BATCH_SIZE = 500;
const scriptPath = fileURLToPath(import.meta.url);
const libPath = fileURLToPath(new URL("./pilot-deletion-fixture-lib.mjs", import.meta.url));
const indexedMigrationName = "0064_workspace_deletion_fk_indexes.sql";
const indexedMigrationPath = resolve("supabase", "migrations", indexedMigrationName);

function scriptHash() {
  return createHash("sha256").update(readFileSync(scriptPath)).update(readFileSync(libPath)).digest("hex");
}

function indexedSourceLedger() {
  const source = readFileSync(indexedMigrationPath);
  return {
    indexedMigration: indexedMigrationName,
    sourceSha256: createHash("sha256").update(source).digest("hex"),
    fkIndexDefinitions: (source.toString("utf8").match(/create index if not exists/g) ?? []).length,
  };
}

function actualMigrationLedger() {
  try {
    const raw = execFileSync(process.execPath, [
      resolve("node_modules/supabase/dist/supabase.js"), "db", "query", "--local", "--output", "json",
      "select version, name from supabase_migrations.schema_migrations order by version;",
    ], { cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const rows = JSON.parse(raw).rows;
    if (!Array.isArray(rows) || !rows.every((row) => typeof row?.version === "string" && typeof row?.name === "string")) {
      throw new Error("unexpected migration ledger response");
    }
    return rows.map(({ version, name }) => ({ version, name }));
  } catch {
    throw new Error("Could not read the actual local migration ledger while the fixture lock is held.");
  }
}

function writeEvidenceFile(output, evidence) {
  const evidencePath = resolve(output);
  mkdirSync(dirname(evidencePath), { recursive: true });
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  return evidencePath;
}

function usage() {
  return "Usage: node scripts/pilot-deletion-fixture.mjs --seed --output C:\\evidence\\seed.json | --measure --output C:\\evidence\\measure.json | --seed-and-measure --seed-output C:\\evidence\\seed.json --measure-output C:\\evidence\\measure.json. No flag performs a zero-I/O dry run.";
}

function fail(error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

function batches(rows) {
  return Array.from({ length: Math.ceil(rows.length / BATCH_SIZE) }, (_, index) => rows.slice(index * BATCH_SIZE, (index + 1) * BATCH_SIZE));
}

async function expect(result, label) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}

function deleteOwnedOrganizationsLocally(plan, ownerIds) {
  const statements = [plan.target, plan.control]
    .filter((workspace) => ownerIds.has(workspace.id))
    .map((workspace) => `select public.delete_workspace('${workspace.id}', '${ownerIds.get(workspace.id)}', '${workspace.name}', 1);`);
  if (!statements.length) return;
  const sqlPath = join(tmpdir(), `nudgepay-pilot-deletion-fixture-${process.pid}-${Date.now()}.sql`);
  try {
    writeFileSync(sqlPath, `${statements.join("\n")}\n`, { mode: 0o600 });
    execFileSync(process.execPath, [
      resolve("node_modules/supabase/dist/supabase.js"), "db", "query", "--local", "--file", sqlPath, "--output", "json",
    ], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"], timeout: 10 * 60_000, windowsHide: true });
  } catch {
    throw new Error("Local deletion fixture cleanup failed. Confirm local Supabase is running and no other database harness owns it.");
  } finally {
    rmSync(sqlPath, { force: true });
  }
}

async function verifyOwnedFixtureCleanup(admin, plan) {
  const ownerIds = new Map();
  for (const workspace of [plan.target, plan.control]) {
    const { data: organizations, error: organizationError } = await admin.from("organizations")
      .select("id, name").eq("id", workspace.id);
    if (organizationError) throw new Error("fixture cleanup identity lookup failed");
    if (!(organizations ?? []).length) continue;
    if (organizations.length !== 1 || organizations[0].name !== workspace.name) {
      throw new Error("fixture cleanup identity mismatch");
    }
    const owner = await findUserByEmail(admin, workspace.owner.email);
    if (!owner) throw new Error("fixture cleanup owner identity mismatch");
    const { data: memberships, error: membershipError } = await admin.from("memberships")
      .select("user_id, role").eq("org_id", workspace.id).eq("user_id", owner.id).eq("role", "owner");
    if (membershipError || (memberships ?? []).length !== 1) throw new Error("fixture cleanup owner membership mismatch");
    ownerIds.set(workspace.id, owner.id);
  }
  return ownerIds;
}

async function findUserByEmail(admin, email) {
  for (let page = 1; page <= 10; page++) {
    const users = await expect(await admin.auth.admin.listUsers({ page, perPage: 200 }), "list fixture users");
    const found = users.users.find((user) => user.email === email);
    if (found || users.users.length === 0) return found ?? null;
  }
  throw new Error("Fixture user lookup exceeded its bounded page limit.");
}

async function removeOwnedUsers(admin, plan) {
  for (const workspace of [plan.target, plan.control]) {
    const user = await findUserByEmail(admin, workspace.owner.email);
    if (user) await expect(await admin.auth.admin.deleteUser(user.id), "delete owned fixture user");
  }
}

function ownerPassword(ownerId) {
  return `LocalDeletionFixture-${ownerId}`;
}

async function createOwners(admin, plan) {
  const owners = new Map();
  for (const workspace of [plan.target, plan.control]) {
    const created = await expect(await admin.auth.admin.createUser({
      email: workspace.owner.email,
      password: ownerPassword(workspace.owner.id),
      email_confirm: true,
      user_metadata: { display_name: `Deletion fixture ${workspace.name}` },
    }), "create local fixture user");
    owners.set(workspace.id, created.user.id);
  }
  return owners;
}

function rowsForOwner(workspace, ownerId) {
  const replaceOwner = (row) => ({ ...row, ...(row.user_id ? { user_id: ownerId } : {}), ...(row.created_by ? { created_by: ownerId } : {}) });
  return {
    ...workspace.rows,
    contact_logs: workspace.rows.contact_logs.map(replaceOwner),
    promises: workspace.rows.promises.map(replaceOwner),
  };
}

async function insertRows(admin, table, rows) {
  for (const batch of batches(rows)) await expect(await admin.from(table).insert(batch), `insert ${table}`);
}

async function seedWorkspace(admin, workspace, ownerId) {
  const rows = rowsForOwner(workspace, ownerId);
  await expect(await admin.from("organizations").insert({ id: workspace.id, name: workspace.name }), "insert fixture organization");
  await expect(await admin.from("memberships").insert({ org_id: workspace.id, user_id: ownerId, role: "owner" }), "insert fixture membership");
  for (const table of DELETION_FIXTURE_TABLES) await insertRows(admin, table, rows[table]);
}

async function assertWorkspaceCounts(admin, workspace) {
  const counts = {};
  for (const table of DELETION_FIXTURE_TABLES) {
    const result = await admin.from(table).select("*", { count: "exact", head: true }).eq("org_id", workspace.id);
    if (result.error) throw new Error(`count ${table}: ${result.error.message}`);
    counts[table] = result.count ?? 0;
  }
  for (const [table, expected] of Object.entries(workspace.counts)) {
    if (counts[table] !== expected) throw new Error(`Fixture ${workspace.name} has ${counts[table]} ${table} rows; expected ${expected}.`);
  }
  return counts;
}

async function observeWorkspaceCounts(admin, workspace) {
  const counts = {};
  const errors = [];
  for (const table of DELETION_FIXTURE_TABLES) {
    const result = await admin.from(table).select("*", { count: "exact", head: true }).eq("org_id", workspace.id);
    if (result.error) {
      counts[table] = null;
      errors.push(`count:${table}`);
    } else {
      counts[table] = result.count ?? 0;
    }
  }
  return { counts, errors };
}

async function seed(admin, plan) {
  const existingOwnerIds = await verifyOwnedFixtureCleanup(admin, plan);
  deleteOwnedOrganizationsLocally(plan, existingOwnerIds);
  await removeOwnedUsers(admin, plan);
  const owners = await createOwners(admin, plan);
  for (const workspace of [plan.target, plan.control]) await seedWorkspace(admin, workspace, owners.get(workspace.id));
  await Promise.all([assertWorkspaceCounts(admin, plan.target), assertWorkspaceCounts(admin, plan.control)]);
}

function unknownCounts() {
  return Object.fromEntries(DELETION_FIXTURE_TABLES.map((table) => [table, null]));
}

function safeFailureEvidence(plan, stage, actualLedger = null) {
  let hash = null;
  let indexedSource = null;
  try { hash = scriptHash(); } catch { /* evidence must remain sanitized on local I/O failure */ }
  try { indexedSource = indexedSourceLedger(); } catch { /* evidence must remain sanitized on local I/O failure */ }
  return {
    format: "nudgepay-pilot-deletion-evidence/v1",
    fixtureVersion: plan.version,
    prefix: plan.prefix,
    measuredAt: new Date().toISOString(),
    target: { id: plan.target.id, name: plan.target.name, counts: unknownCounts() },
    control: { id: plan.control.id, name: plan.control.name, counts: unknownCounts() },
    durationMs: null,
    requestResult: { ok: false, status: null, errorCode: "execution_failure" },
    tombstone: null,
    controlExists: null,
    verification: { observationsRead: null },
    passed: false,
    failureStage: stage,
    scriptHash: hash,
    migrationLedger: { actual: actualLedger, indexedSource },
  };
}

function writeFailureArtifacts(paths, plan, stage, actualLedger) {
  const evidence = safeFailureEvidence(plan, stage, actualLedger);
  for (const path of paths.filter(Boolean)) {
    try { writeEvidenceFile(path, evidence); } catch { /* preserve the original execution failure exit code */ }
  }
  return evidence;
}

async function measure(admin, plan, actualLedger) {
  const measuredAt = new Date().toISOString();
  const [targetBefore, controlBefore] = await Promise.all([observeWorkspaceCounts(admin, plan.target), observeWorkspaceCounts(admin, plan.control)]);
  const matchesExpectedCounts = (counts, expected) => Object.entries(expected).every(([table, count]) => counts[table] === count);
  if (targetBefore.errors.length || controlBefore.errors.length || !matchesExpectedCounts(targetBefore.counts, plan.target.counts) || !matchesExpectedCounts(controlBefore.counts, plan.control.counts)) {
    return sanitizeDeletionEvidence({
      plan,
      observedCounts: { target: targetBefore.counts, control: controlBefore.counts },
      durationMs: null,
      measuredAt,
      requestResult: { ok: false, status: null, errorCode: "precondition" },
      tombstone: null,
      controlExists: null,
      verification: { fixtureReady: false },
      passed: false,
      scriptHash: scriptHash(),
      migrationLedger: { actual: actualLedger, indexedSource: indexedSourceLedger() },
    });
  }
  const owner = await findUserByEmail(admin, plan.target.owner.email);
  if (!owner) throw new Error("Target fixture owner is missing. Run --seed before --measure.");
  let rpcStatus = null;
  const rpcAdmin = createClient(assertLocalDeletionUrl(process.env.SUPABASE_URL), process.env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (input, init) => {
        const response = await fetch(input, init);
        const url = typeof input === "string" ? input : input instanceof Request ? input.url : input.toString();
        if (url.includes("/rest/v1/rpc/delete_workspace")) rpcStatus = response.status;
        return response;
      },
    },
  });
  const startedAt = measuredAt;
  const startedAtPerformance = performance.now();
  let result;
  try {
    result = await rpcAdmin.rpc("delete_workspace", {
      p_org_id: plan.target.id,
      p_deleted_by: owner.id,
      p_org_name: plan.target.name,
      p_member_count: 1,
    });
  } catch {
    result = { error: { code: "network" } };
  }
  const durationMs = Math.round((performance.now() - startedAtPerformance) * 100) / 100;
  const { data: tombstones, error: tombstoneError } = await admin.from("workspace_deletions")
    .select("org_id, org_name, member_count, deleted_by, deleted_at").eq("org_id", plan.target.id).order("deleted_at", { ascending: false }).limit(1);
  const { data: target, error: targetError } = await admin.from("organizations").select("id").eq("id", plan.target.id);
  const { data: control, error: controlError } = await admin.from("organizations").select("id").eq("id", plan.control.id);
  const [targetAfter, controlAfter] = await Promise.all([observeWorkspaceCounts(admin, plan.target), observeWorkspaceCounts(admin, plan.control)]);
  const evaluation = evaluateDeletionMeasurement({
    plan,
    ownerId: owner.id,
    startedAt,
    rpcStatus,
    rpcError: result.error,
    targetExists: targetError ? true : (target ?? []).length > 0,
    targetCounts: targetAfter.counts,
    controlCounts: controlAfter.counts,
    tombstone: tombstoneError ? null : tombstones?.[0] ?? null,
  });
  return sanitizeDeletionEvidence({
    plan,
    observedCounts: { target: targetAfter.counts, control: controlAfter.counts },
    durationMs,
    measuredAt: startedAt,
    requestResult: evaluation.requestResult,
    tombstone: tombstones?.[0] ?? null,
    controlExists: !controlError && (control ?? []).length === 1,
    verification: { ...evaluation.verification, observationsRead: !targetError && !controlError && !tombstoneError && targetAfter.errors.length === 0 && controlAfter.errors.length === 0 },
    passed: evaluation.passed && !targetError && !controlError && !tombstoneError && targetAfter.errors.length === 0 && controlAfter.errors.length === 0,
    scriptHash: scriptHash(),
    migrationLedger: { actual: actualLedger, indexedSource: indexedSourceLedger() },
  });
}

async function main() {
  const args = parseDeletionFixtureArgs(process.argv.slice(2));
  if (args.help) { console.log(usage()); return; }
  const plan = buildDeletionFixturePlan();
  if (args.dryRun) {
    console.log(JSON.stringify({ mode: "dry-run", localOnly: true, fixtureVersion: plan.version, prefix: plan.prefix, target: { id: plan.target.id, name: plan.target.name, counts: plan.target.counts }, control: { id: plan.control.id, name: plan.control.name, counts: plan.control.counts }, scriptHash: scriptHash() }, null, 2));
    return;
  }
  const url = assertLocalDeletionUrl(process.env.SUPABASE_URL);
  if (!process.env.SUPABASE_SERVICE_KEY) throw new Error("SUPABASE_SERVICE_KEY is required for local fixture mutation.");
  const lock = acquireLocalDbHarnessLock({ owner: "pilot-deletion-fixture" });
  const outputPaths = args.seedAndMeasure ? [args.seedOutput, args.measureOutput] : [args.output];
  let stage = "migration_ledger";
  let actualLedger = null;
  try {
    const admin = createClient(url, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    actualLedger = actualMigrationLedger();
    if (args.seed || args.seedAndMeasure) {
      stage = "seed";
      await seed(admin, plan);
      const evidence = { mode: "seed", localOnly: true, seededAt: new Date().toISOString(), fixtureVersion: plan.version, target: { id: plan.target.id, counts: plan.target.counts }, control: { id: plan.control.id, counts: plan.control.counts }, scriptHash: scriptHash(), migrationLedger: { actual: actualLedger, indexedSource: indexedSourceLedger() } };
      const evidenceFile = writeEvidenceFile(args.seedAndMeasure ? args.seedOutput : args.output, evidence);
      console.log(JSON.stringify({ ...evidence, evidenceFile }, null, 2));
      if (args.seed) return;
    }
    stage = "measure";
    const evidence = await measure(admin, plan, actualLedger);
    const evidenceFile = writeEvidenceFile(args.seedAndMeasure ? args.measureOutput : args.output, evidence);
    console.log(JSON.stringify({ ...evidence, evidenceFile }, null, 2));
    if (!evidence.passed) process.exitCode = 1;
  } catch {
    const evidence = writeFailureArtifacts(outputPaths, plan, stage, actualLedger);
    console.log(JSON.stringify(evidence, null, 2));
    process.exitCode = 1;
  } finally {
    lock.release();
  }
}

main().catch(fail);
