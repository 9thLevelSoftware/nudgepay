import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readAndVerifyReleaseArtifact, canonicalJson, sha256 } from "./release-artifact.mjs";
import {
  isValidReleaseTimestamp,
  receiptDigest,
  validatedMigrationFilenames,
} from "./release-deployment.mjs";
import { REQUIRED_PR_CHECKS } from "./verify-required-checks.mjs";

function workflowError(message) {
  return new Error(`Release workflow verification failed: ${message}`);
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw workflowError(`${label} is missing or invalid JSON`);
  }
}

function assertSha(value, label, length = 40) {
  if (typeof value !== "string" || !new RegExp(`^[a-f0-9]{${length}}$`).test(value)) {
    throw workflowError(`${label} is not a lowercase SHA-${length === 40 ? "1" : "256"}`);
  }
}

export function assertTrustedCiTrigger(event) {
  const run = event?.workflow_run;
  const repository = event?.repository?.full_name;
  if (
    !run
    || run.name !== "CI"
    || run.event !== "push"
    || run.conclusion !== "success"
    || run.head_branch !== "main"
    || run.head_repository?.full_name !== repository
    || !Number.isSafeInteger(run.id)
  ) {
    throw workflowError("trigger must be a successful CI push run from this repository's main branch");
  }
  assertSha(run.head_sha, "triggering CI head SHA");
  return { ciRunId: run.id, sourceSha: run.head_sha, repository };
}

export function assertRequiredCiJobs(payload, expectedSha) {
  assertSha(expectedSha, "expected CI head SHA");
  if (
    !payload
    || !Array.isArray(payload.jobs)
    || !Number.isSafeInteger(payload.total_count)
    || payload.total_count !== payload.jobs.length
  ) {
    throw workflowError("CI job response must contain one complete, unpaginated job list");
  }
  for (const expectedName of REQUIRED_PR_CHECKS) {
    const matches = payload.jobs.filter((job) => job?.name === expectedName);
    if (
      matches.length !== 1
      || matches[0].status !== "completed"
      || matches[0].conclusion !== "success"
      || matches[0].head_sha !== expectedSha
    ) {
      throw workflowError(`required CI job did not succeed for the exact release SHA: ${expectedName}`);
    }
  }
  return [...REQUIRED_PR_CHECKS];
}

export function assertCurrentMainSha(expectedSha, currentSha) {
  assertSha(expectedSha, "release source SHA");
  assertSha(currentSha, "current main SHA");
  if (expectedSha !== currentSha) {
    throw workflowError("release candidate is stale because main advanced before deployment");
  }
}

function projectRefFromSupabaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw workflowError("sealed Supabase URL is invalid");
  }
  const projectRef = /^([a-z0-9]+)\.supabase\.co$/i.exec(url.hostname)?.[1]?.toLowerCase();
  if (!projectRef) throw workflowError("sealed Supabase URL does not contain a hosted project ref");
  return projectRef;
}

export function buildReleaseWorkflowMetadata({ artifactDir, expectedSourceSha, migrationFiles }) {
  const manifest = readAndVerifyReleaseArtifact({
    artifactDir,
    expectedSourceCommit: expectedSourceSha,
    expectedMigrationFiles: migrationFiles,
  });
  const targets = {};
  for (const environment of ["staging", "production"]) {
    const target = manifest.targets[environment];
    const config = readJson(resolve(artifactDir, ...target.configPath.split("/")), `${environment} config`);
    targets[environment] = {
      workerName: target.workerName,
      configSha256: target.configSha256,
      supabaseProjectRef: projectRefFromSupabaseUrl(config.vars?.SUPABASE_URL),
    };
  }
  const metadata = {
    schemaVersion: 1,
    sourceSha: manifest.sourceCommit,
    latestMigration: manifest.latestMigration,
    artifactSha256: manifest.artifactSha256,
    manifestSha256: manifest.manifestSha256,
    targets,
  };
  metadata.metadataSha256 = sha256(canonicalJson(metadata));
  return metadata;
}

export function assertReleaseWorkflowMetadata(metadata, expected = {}) {
  if (metadata?.schemaVersion !== 1) throw workflowError("release workflow metadata schema is invalid");
  const { metadataSha256, ...unsigned } = metadata;
  assertSha(metadataSha256, "metadata digest", 64);
  if (metadataSha256 !== sha256(canonicalJson(unsigned))) {
    throw workflowError("release workflow metadata self-digest does not match");
  }
  for (const [key, value, length] of [
    ["source SHA", metadata.sourceSha, 40],
    ["artifact digest", metadata.artifactSha256, 64],
    ["manifest digest", metadata.manifestSha256, 64],
    ["staging config digest", metadata.targets?.staging?.configSha256, 64],
    ["production config digest", metadata.targets?.production?.configSha256, 64],
  ]) assertSha(value, key, length);
  if (!/^\d+_[a-z0-9_]+\.sql$/i.test(metadata.latestMigration ?? "")) {
    throw workflowError("metadata latest migration is invalid");
  }
  const comparisons = [
    ["source SHA", metadata.sourceSha, expected.sourceSha],
    ["manifest digest", metadata.manifestSha256, expected.manifestSha256],
    ["staging config digest", metadata.targets.staging.configSha256, expected.stagingConfigSha256],
    ["production config digest", metadata.targets.production.configSha256, expected.productionConfigSha256],
  ];
  for (const [label, actual, wanted] of comparisons) {
    if (wanted !== undefined && actual !== wanted) throw workflowError(`${label} does not match the independently expected value`);
  }
  return metadata;
}

export function assertQualifiedStagingRun(run, { repository }) {
  if (
    run?.name !== "Deploy staging"
    || run?.path !== ".github/workflows/deploy-staging.yml"
    || run?.event !== "workflow_run"
    || run?.conclusion !== "success"
    || run?.head_branch !== "main"
    || run?.head_repository?.full_name !== repository
  ) {
    throw workflowError("source run is not a successful trusted staging release workflow");
  }
  assertSha(run.head_sha, "staging workflow head SHA");
}

export function assertQualifiedStagingJobs(payload) {
  if (
    !payload
    || !Array.isArray(payload.jobs)
    || payload.jobs.length !== payload.total_count
  ) throw workflowError("staging job response must contain one complete, unpaginated job list");
  for (const name of ["seal successful main candidate", "deploy and verify staging bootstrap"]) {
    const matches = payload.jobs.filter((job) => job?.name === name);
    if (matches.length !== 1 || matches[0].status !== "completed" || matches[0].conclusion !== "success") {
      throw workflowError(`staging release job did not complete successfully: ${name}`);
    }
  }
}

export function assertEnvironmentProtection(environment, policies, {
  expectedName,
  requireReviewer = false,
  releaseOwner,
}) {
  if (
    environment?.name !== expectedName
    || environment?.can_admins_bypass !== false
    || environment?.deployment_branch_policy?.protected_branches !== false
    || environment?.deployment_branch_policy?.custom_branch_policies !== true
  ) {
    throw workflowError(`${expectedName} environment protections are not fail-closed`);
  }
  if (
    !policies
    || policies.total_count !== 1
    || !Array.isArray(policies.branch_policies)
    || policies.branch_policies.length !== 1
    || policies.branch_policies[0]?.name !== "main"
    || policies.branch_policies[0]?.type !== "branch"
  ) {
    throw workflowError(`${expectedName} environment must allow only the main branch`);
  }
  if (requireReviewer) {
    if (!releaseOwner) throw workflowError("RELEASE_OWNER is not configured");
    const reviewerRule = environment.protection_rules?.find((rule) => rule?.type === "required_reviewers");
    const reviewers = reviewerRule?.reviewers ?? [];
    if (!reviewers.some((entry) => entry?.type === "User" && entry?.reviewer?.login === releaseOwner)) {
      throw workflowError(`production required reviewers do not include RELEASE_OWNER ${releaseOwner}`);
    }
  }
}

export function locateReceipt({
  directory,
  environment,
  expectedReceiptSha256,
  expectedSourceSha,
  expectedManifestSha256,
  expectedConfigSha256,
}) {
  if (environment !== "staging" && environment !== "production") {
    throw workflowError("deployment receipt environment is invalid");
  }
  const candidates = readdirSync(directory)
    .filter((name) => name.startsWith(`${environment}-`) && name.endsWith(".json"));
  if (candidates.length !== 1) throw workflowError(`expected exactly one ${environment} deployment receipt`);
  const path = resolve(directory, candidates[0]);
  const receipt = readJson(path, `${environment} deployment receipt`);
  const cloudflareId = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  const evidencePairIsValid = (
    receipt.qualification === "strict"
    && receipt.evidenceScope === "configuration_verified_not_provider_integration"
  ) || (
    environment === "staging"
    && receipt.qualification === "bootstrap"
    && receipt.evidenceScope === "deployment_verified_pending_qualification"
  );
  if (
    receipt.schemaVersion !== 1
    || receipt.environment !== environment
    || !evidencePairIsValid
    || receipt.queryStringRedactionVerified !== true
    || !/^[a-f0-9]{40}$/.test(receipt.sourceCommit ?? "")
    || !/^[a-f0-9]{64}$/.test(receipt.artifactSha256 ?? "")
    || !/^[a-f0-9]{64}$/.test(receipt.manifestSha256 ?? "")
    || !/^[a-f0-9]{64}$/.test(receipt.configSha256 ?? "")
    || !cloudflareId.test(receipt.deploymentId ?? "")
    || !cloudflareId.test(receipt.versionId ?? "")
    || !isValidReleaseTimestamp(receipt.deployedAt)
  ) throw workflowError("deployment receipt schema or environment is invalid");
  if (receipt.receiptSha256 !== receiptDigest(receipt)) throw workflowError("deployment receipt self-digest does not match");
  if (expectedReceiptSha256 && receipt.receiptSha256 !== expectedReceiptSha256) {
    throw workflowError("deployment receipt does not match the independently expected digest");
  }
  for (const [label, actual, expected] of [
    ["source SHA", receipt.sourceCommit, expectedSourceSha],
    ["manifest digest", receipt.manifestSha256, expectedManifestSha256],
    ["config digest", receipt.configSha256, expectedConfigSha256],
  ]) {
    if (expected !== undefined && actual !== expected) {
      throw workflowError(`deployment receipt ${label} does not match the sealed candidate`);
    }
  }
  return { path, receipt };
}

function parseOptions(argv) {
  const command = argv[0];
  const values = {};
  for (let index = 1; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value || value.startsWith("--") || Object.hasOwn(values, key)) {
      throw workflowError("invalid or duplicate command option");
    }
    values[key] = value;
  }
  return { command, values };
}

function writeGithubOutput(path, values) {
  if (!path) return;
  const lines = Object.entries(values).map(([key, value]) => `${key}=${value}`).join("\n");
  writeFileSync(path, `${lines}\n`, { flag: "a" });
}

function main() {
  const { command, values } = parseOptions(process.argv.slice(2));
  if (command === "verify-ci-trigger") {
    const event = readJson(values["--event"], "workflow event");
    const trusted = assertTrustedCiTrigger(event);
    assertRequiredCiJobs(readJson(values["--jobs"], "CI jobs"), trusted.sourceSha);
    writeGithubOutput(values["--github-output"], {
      ci_run_id: trusted.ciRunId,
      source_sha: trusted.sourceSha,
    });
    console.log(JSON.stringify({ status: "ci_release_source_verified", ...trusted }));
    return;
  }
  if (command === "metadata") {
    const appRoot = fileURLToPath(new URL("..", import.meta.url));
    const migrations = validatedMigrationFilenames(readdirSync(resolve(appRoot, "supabase/migrations")));
    const metadata = buildReleaseWorkflowMetadata({
      artifactDir: values["--artifact-dir"],
      expectedSourceSha: values["--expected-sha"],
      migrationFiles: migrations,
    });
    assertReleaseWorkflowMetadata(metadata, {
      sourceSha: values["--expected-sha"],
      manifestSha256: values["--expected-manifest-sha"],
      stagingConfigSha256: values["--expected-staging-config-sha"],
      productionConfigSha256: values["--expected-production-config-sha"],
    });
    if (values["--output"]) writeFileSync(values["--output"], `${JSON.stringify(metadata, null, 2)}\n`, { flag: "wx" });
    writeGithubOutput(values["--github-output"], {
      source_sha: metadata.sourceSha,
      latest_migration: metadata.latestMigration,
      artifact_sha256: metadata.artifactSha256,
      manifest_sha256: metadata.manifestSha256,
      staging_config_sha256: metadata.targets.staging.configSha256,
      production_config_sha256: metadata.targets.production.configSha256,
      staging_project_ref: metadata.targets.staging.supabaseProjectRef,
      production_project_ref: metadata.targets.production.supabaseProjectRef,
      metadata_sha256: metadata.metadataSha256,
    });
    console.log(JSON.stringify(metadata));
    return;
  }
  if (command === "verify-current-main") {
    assertCurrentMainSha(values["--expected-sha"], values["--current-sha"]);
    console.log(JSON.stringify({ status: "current_main_verified", sourceSha: values["--expected-sha"] }));
    return;
  }
  if (command === "verify-staging-run") {
    assertQualifiedStagingRun(readJson(values["--run"], "staging workflow run"), {
      repository: values["--repository"],
    });
    assertQualifiedStagingJobs(readJson(values["--jobs"], "staging workflow jobs"));
    console.log(JSON.stringify({ status: "staging_workflow_run_verified" }));
    return;
  }
  if (command === "verify-environment") {
    assertEnvironmentProtection(
      readJson(values["--environment"], "GitHub environment"),
      readJson(values["--policies"], "GitHub environment branch policies"),
      {
        expectedName: values["--expected-name"],
        requireReviewer: values["--require-reviewer"] === "true",
        releaseOwner: values["--release-owner"],
      },
    );
    console.log(JSON.stringify({ status: "github_environment_verified", environment: values["--expected-name"] }));
    return;
  }
  if (command === "locate-receipt") {
    const located = locateReceipt({
      directory: values["--directory"],
      environment: values["--environment"],
      expectedReceiptSha256: values["--expected-receipt-sha"],
      expectedSourceSha: values["--expected-sha"],
      expectedManifestSha256: values["--expected-manifest-sha"],
      expectedConfigSha256: values["--expected-config-sha"],
    });
    writeGithubOutput(values["--github-output"], {
      receipt_path: located.path,
      receipt_sha256: located.receipt.receiptSha256,
    });
    console.log(JSON.stringify({ status: "deployment_receipt_verified", receipt: basename(located.path) }));
    return;
  }
  throw workflowError("unknown release workflow verification command");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Release workflow verification failed");
    process.exitCode = 1;
  }
}
