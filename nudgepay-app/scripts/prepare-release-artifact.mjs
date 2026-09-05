import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createReleaseArtifact, readAndVerifyReleaseArtifact } from "./release-artifact.mjs";
import {
  deriveReleaseTargetConfigs,
  latestMigrationFilename,
  parseReleasePreparationArgs,
  validatedMigrationFilenames,
} from "./release-deployment.mjs";
import {
  assertDeployConfig,
  assertProductionConfigParity,
  assertProductionReleaseGuard,
  productionConfigFromToml,
  productionDeployShaForEnvironment,
  stagingConfigFromToml,
} from "./deploy-preflight.mjs";

const appRoot = fileURLToPath(new URL("..", import.meta.url));

function resolveNpmCli() {
  const candidates = [
    process.env.npm_execpath,
    join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
  ];
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  throw new Error("Could not resolve npm-cli.js; run release preparation through npm");
}

function run(command, args, extraEnv = {}) {
  const executable = command === "node" || command === "npm" ? process.execPath : command;
  const executableArgs = command === "npm" ? [resolveNpmCli(), ...args] : args;
  const result = spawnSync(executable, executableArgs, {
    cwd: appRoot,
    stdio: "inherit",
    windowsHide: true,
    env: { ...process.env, ...extraEnv },
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function main() {
  const { artifactDir } = parseReleasePreparationArgs(process.argv.slice(2));
  const sourceCommit = productionDeployShaForEnvironment(process.env);
  assertProductionReleaseGuard({ expectedSha: sourceCommit, cwd: appRoot });

  const stagingSupabaseUrl = process.env.STAGING_SUPABASE_URL;
  const toml = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
  const production = productionConfigFromToml(toml);
  const stagingSource = stagingConfigFromToml(toml);
  const staging = {
    ...stagingSource,
    vars: { ...stagingSource.vars, SUPABASE_URL: stagingSupabaseUrl },
  };
  assertDeployConfig({
    environment: "production",
    config: production,
    productionSupabaseUrl: production.vars.SUPABASE_URL,
  });
  assertDeployConfig({
    environment: "staging",
    config: staging,
    productionSupabaseUrl: production.vars.SUPABASE_URL,
  });

  run("npm", ["run", "build"], { NODE_ENV: "production" });
  run("node", ["scripts/strip-build-dev-vars.mjs"]);
  assertProductionReleaseGuard({ expectedSha: sourceCommit, cwd: appRoot });

  const built = JSON.parse(readFileSync(new URL("../build/server/wrangler.json", import.meta.url), "utf8"));
  assertProductionConfigParity(built, production, "built Worker config");
  const targetConfigs = deriveReleaseTargetConfigs({ built, production, staging });
  const migrationFiles = validatedMigrationFilenames(
    readdirSync(new URL("../supabase/migrations", import.meta.url)),
  );
  const latestMigration = latestMigrationFilename(migrationFiles);
  const manifest = createReleaseArtifact({
    buildRoot: fileURLToPath(new URL("../build", import.meta.url)),
    artifactDir,
    sourceCommit,
    latestMigration,
    migrationFiles,
    targetConfigs,
  });
  readAndVerifyReleaseArtifact({
    artifactDir,
    expectedSourceCommit: sourceCommit,
    expectedLatestMigration: latestMigration,
    expectedMigrationFiles: migrationFiles,
  });
  console.log(JSON.stringify({
    artifactDir,
    sourceCommit: manifest.sourceCommit,
    latestMigration: manifest.latestMigration,
    artifactSha256: manifest.artifactSha256,
    manifestSha256: manifest.manifestSha256,
    targets: manifest.targets,
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : "Release artifact preparation failed");
  process.exitCode = 1;
}
