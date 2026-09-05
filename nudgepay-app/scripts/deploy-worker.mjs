import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertCloudflareWorkerNameOverride,
  assertDeployConfig,
  assertNoInvariantSecrets,
  assertProductionReleaseGuard,
  assertProductionConfigParity,
  productionDeployShaForEnvironment,
  productionConfigFromToml,
} from "./deploy-preflight.mjs";
import { readAndVerifyReleaseArtifact } from "./release-artifact.mjs";
import {
  createDeploymentAttempt,
  createDeploymentReceipt,
  latestMigrationFilename,
  parseReleaseDeploymentArgs,
  resolveReceiptDirectory,
  validatedMigrationFilenames,
  writeDeploymentReceipt,
} from "./release-deployment.mjs";
import {
  assertConfiguredProviders,
  inspectConfiguredProviders,
  parseDeploymentStatus,
  parsePreviousDeploymentStatus,
  parsePredeploySecretInventory,
  parseVersionList,
} from "./release-qualifier.mjs";

const cwd = fileURLToPath(new URL("..", import.meta.url));
const wranglerToml = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
const productionConfig = productionConfigFromToml(wranglerToml);
const wranglerBin = fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url));

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit", windowsHide: true });
  if (r.status !== 0) throw new Error(`${cmd} ${args[0] ?? ""} failed`);
}

function runCapture(cmd, args) {
  const result = spawnSync(cmd, args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args[0] ?? ""} failed`);
  }
  return result.stdout;
}

function runCaptureResult(cmd, args) {
  return spawnSync(cmd, args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
}

function runWrangler(args, capture = false) {
  return capture
    ? runCapture(process.execPath, [wranglerBin, ...args])
    : run(process.execPath, [wranglerBin, ...args]);
}

function readProviderConfiguration({ targetConfigPath, workerName, environment, qualification }) {
  const secretNames = parsePredeploySecretInventory({
    result: runCaptureResult(process.execPath, [
      wranglerBin,
      "secret", "list", "-c", targetConfigPath, "--name", workerName,
    ]),
    environment,
    qualification,
    workerName,
  });
  assertNoInvariantSecrets(secretNames, environment);
  return qualification === "strict"
    ? assertConfiguredProviders(secretNames)
    : inspectConfiguredProviders(secretNames).configured;
}

try {
  const {
    environment,
    qualification,
    artifactDir,
    receiptDir,
    expectedManifestSha,
    expectedConfigSha,
  } = parseReleaseDeploymentArgs(process.argv.slice(2));
  const staging = environment === "staging";
  const expectedProductionSha = productionDeployShaForEnvironment(process.env);
  if (!/^[a-f0-9]{40}$/i.test(expectedProductionSha ?? "")) {
    throw new Error("Release deployment requires EXPECTED_DEPLOY_SHA as a 40-character commit SHA");
  }
  const migrationFiles = validatedMigrationFilenames(
    readdirSync(new URL("../supabase/migrations", import.meta.url)),
  );
  const latestMigration = latestMigrationFilename(migrationFiles);
  const manifest = readAndVerifyReleaseArtifact({
    artifactDir,
    expectedSourceCommit: expectedProductionSha,
    expectedLatestMigration: latestMigration,
    expectedMigrationFiles: migrationFiles,
  });
  const target = manifest.targets[environment];
  if (manifest.manifestSha256 !== expectedManifestSha || target.configSha256 !== expectedConfigSha) {
    throw new Error("Sealed release does not match the independently recorded manifest/config digests");
  }
  const targetConfigPath = resolve(artifactDir, ...target.configPath.split("/"));
  const targetConfig = JSON.parse(readFileSync(targetConfigPath, "utf8"));
  assertCloudflareWorkerNameOverride({ environment, expectedName: target.workerName });
  assertDeployConfig({
    environment,
    config: targetConfig,
    productionSupabaseUrl: productionConfig.vars.SUPABASE_URL,
  });
  if (!staging) {
    assertProductionConfigParity(targetConfig, productionConfig, "sealed production Worker config");
    assertProductionReleaseGuard({ expectedSha: expectedProductionSha, cwd });
  }

  const providerConfiguration = readProviderConfiguration({
    targetConfigPath,
    workerName: target.workerName,
    environment,
    qualification,
  });
  const statusArgs = [
    "deployments", "status",
    "-c", targetConfigPath,
    "--name", target.workerName,
    "--json",
  ];
  const before = parsePreviousDeploymentStatus(runCaptureResult(
    process.execPath,
    [wranglerBin, ...statusArgs],
  ));
  const releaseAnnotation = `nudgepay-release:${manifest.manifestSha256}:${environment}:${randomUUID()}`;
  const immediatelyVerified = readAndVerifyReleaseArtifact({
    artifactDir,
    expectedSourceCommit: expectedProductionSha,
    expectedLatestMigration: latestMigration,
    expectedMigrationFiles: migrationFiles,
  });
  if (
    immediatelyVerified.manifestSha256 !== expectedManifestSha
    || immediatelyVerified.targets[environment].configSha256 !== expectedConfigSha
  ) {
    throw new Error("Sealed release changed before Worker upload");
  }
  if (!staging) assertProductionReleaseGuard({ expectedSha: expectedProductionSha, cwd });
  const outputDirectory = resolveReceiptDirectory({ artifactDir, receiptDir });
  const attemptDirectory = join(outputDirectory, "attempts");
  mkdirSync(attemptDirectory, { recursive: true });
  const uploadAttempt = createDeploymentAttempt({
    environment,
    sourceCommit: manifest.sourceCommit,
    manifestSha256: manifest.manifestSha256,
    configSha256: target.configSha256,
    workerName: target.workerName,
    previousDeployment: before,
    attemptId: releaseAnnotation.split(":").at(-1),
  });
  writeDeploymentReceipt({
    receiptPath: join(attemptDirectory, `${environment}-upload-attempt-${uploadAttempt.attemptId}.json`),
    receipt: uploadAttempt,
  });
  runWrangler([
    "deploy",
    "-c", targetConfigPath,
    "--no-bundle",
    "--message", releaseAnnotation,
  ]);
  const after = parseDeploymentStatus(runWrangler(statusArgs, true));
  const annotatedVersion = parseVersionList(runWrangler([
    "versions", "list",
    "-c", targetConfigPath,
    "--name", target.workerName,
    "--json",
  ], true), releaseAnnotation);
  if (annotatedVersion.versionId !== after.versionId) {
    throw new Error("The annotated release version is not the active 100% Worker version");
  }
  run(process.execPath, ["scripts/enforce-observability-redaction.mjs", "--worker", target.workerName]);
  const verifiedAfterRedaction = parseDeploymentStatus(runWrangler(statusArgs, true));
  if (
    verifiedAfterRedaction.deploymentId !== after.deploymentId
    || verifiedAfterRedaction.versionId !== annotatedVersion.versionId
    || verifiedAfterRedaction.createdOn !== after.createdOn
  ) {
    throw new Error("The active Worker deployment changed before redaction evidence was recorded");
  }
  const receipt = createDeploymentReceipt({
    environment,
    qualification,
    sourceCommit: manifest.sourceCommit,
    artifactSha256: manifest.artifactSha256,
    manifestSha256: manifest.manifestSha256,
    configSha256: target.configSha256,
    workerName: target.workerName,
    previousDeployment: before,
    deployment: verifiedAfterRedaction,
    queryStringRedactionVerified: true,
    providerConfiguration,
    releaseAnnotation,
  });
  const receiptPath = join(outputDirectory, `${environment}-${verifiedAfterRedaction.versionId}.json`);
  const finallyVerified = readAndVerifyReleaseArtifact({
    artifactDir,
    expectedSourceCommit: expectedProductionSha,
    expectedLatestMigration: latestMigration,
    expectedMigrationFiles: migrationFiles,
  });
  if (
    finallyVerified.manifestSha256 !== expectedManifestSha
    || finallyVerified.targets[environment].configSha256 !== expectedConfigSha
  ) {
    throw new Error("Sealed release changed during Worker upload or verification");
  }
  writeDeploymentReceipt({ receiptPath, receipt });
  console.log(JSON.stringify({
    status: "deployment_recorded",
    receiptPath,
    workerName: receipt.workerName,
    versionId: receipt.versionId,
    artifactSha256: receipt.artifactSha256,
    manifestSha256: receipt.manifestSha256,
  }, null, 2));
} catch (error) {
  const message = error instanceof Error ? error.message : "unknown release deployment failure";
  console.error(message);
  process.exitCode = 1;
}
