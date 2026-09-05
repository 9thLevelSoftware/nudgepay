import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readAndVerifyReleaseArtifact } from "./release-artifact.mjs";
import { validatedMigrationFilenames } from "./release-deployment.mjs";
import {
  assertLinkedSupabaseProject,
  assertMigrationParity,
  parseMigrationList,
} from "./release-qualifier.mjs";

function predeployError(message) {
  return new Error(`Release predeployment verification failed: ${message}`);
}

function parseArgs(argv) {
  const allowed = new Set([
    "--environment", "--artifact-dir", "--expected-sha", "--expected-migration",
    "--expected-manifest-sha", "--expected-config-sha",
  ]);
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!allowed.has(key) || !value || value.startsWith("--") || Object.hasOwn(values, key)) {
      throw predeployError("all release identity options are required exactly once");
    }
    values[key] = value;
  }
  if ([...allowed].some((key) => !values[key])) throw predeployError("all release identity options are required exactly once");
  if (values["--environment"] !== "staging" && values["--environment"] !== "production") {
    throw predeployError("environment must be staging or production");
  }
  return values;
}

function readLinkedRef(appRoot) {
  try {
    return readFileSync(resolve(appRoot, "supabase/.temp/project-ref"), "utf8");
  } catch {
    throw predeployError("linked Supabase project ref is unavailable");
  }
}

function runMigrationList(appRoot) {
  const supabaseBin = resolve(appRoot, "node_modules/supabase/dist/supabase.js");
  const result = spawnSync(process.execPath, [
    supabaseBin, "--workdir", appRoot, "migration", "list", "--linked",
  ], {
    cwd: appRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0) throw predeployError("read-only linked migration check failed");
  return result.stdout;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const appRoot = fileURLToPath(new URL("..", import.meta.url));
  const migrations = validatedMigrationFilenames(readdirSync(resolve(appRoot, "supabase/migrations")));
  const manifest = readAndVerifyReleaseArtifact({
    artifactDir: options["--artifact-dir"],
    expectedSourceCommit: options["--expected-sha"],
    expectedLatestMigration: options["--expected-migration"],
    expectedMigrationFiles: migrations,
  });
  const target = manifest.targets[options["--environment"]];
  if (
    manifest.manifestSha256 !== options["--expected-manifest-sha"]
    || target.configSha256 !== options["--expected-config-sha"]
  ) throw predeployError("sealed artifact does not match independently expected digests");
  const config = JSON.parse(readFileSync(resolve(
    options["--artifact-dir"],
    ...target.configPath.split("/"),
  ), "utf8"));
  const beforeRef = readLinkedRef(appRoot);
  assertLinkedSupabaseProject({ targetSupabaseUrl: config.vars?.SUPABASE_URL, linkedProjectRef: beforeRef });
  const rows = parseMigrationList(runMigrationList(appRoot));
  const afterRef = readLinkedRef(appRoot);
  assertLinkedSupabaseProject({ targetSupabaseUrl: config.vars?.SUPABASE_URL, linkedProjectRef: afterRef });
  if (beforeRef.trim() !== afterRef.trim()) throw predeployError("linked Supabase project changed during verification");
  assertMigrationParity(rows, manifest.migrationFiles);
  console.log(JSON.stringify({
    status: "predeployment_database_verified",
    environment: options["--environment"],
    sourceSha: manifest.sourceCommit,
    latestMigration: manifest.latestMigration,
    manifestSha256: manifest.manifestSha256,
    configSha256: target.configSha256,
  }));
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : "Release predeployment verification failed");
  process.exitCode = 1;
}
