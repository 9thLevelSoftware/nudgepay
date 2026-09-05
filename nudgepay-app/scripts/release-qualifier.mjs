import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readAndVerifyReleaseArtifact } from "./release-artifact.mjs";
import {
  receiptDigest,
  resolveReceiptDirectory,
  validatedMigrationFilenames,
} from "./release-deployment.mjs";
import {
  assertDeployConfig,
  assertProductionConfigParity,
  productionConfigFromToml,
} from "./deploy-preflight.mjs";
import {
  fetchSupabaseMigrationInventory,
  projectRefFromSupabaseUrl,
} from "./supabase-migration-inventory.mjs";

function qualificationError(message) {
  return new Error(`Release qualification failed: ${message}`);
}

const QUALIFICATION_OPTIONS = [
  "--environment",
  "--qualification",
  "--artifact-dir",
  "--receipt",
  "--base-url",
  "--expected-sha",
  "--expected-migration",
  "--expected-manifest-sha",
  "--expected-config-sha",
];

export function parseQualificationArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index];
    const value = argv[index + 1];
    if (!QUALIFICATION_OPTIONS.includes(option) || !value || value.startsWith("--")) {
      throw qualificationError(`required options: ${QUALIFICATION_OPTIONS.join(", ")}`);
    }
    if (Object.hasOwn(values, option)) throw qualificationError(`duplicate option ${option}`);
    values[option] = value;
  }
  if (QUALIFICATION_OPTIONS.some((option) => !values[option])) {
    throw qualificationError(`required options: ${QUALIFICATION_OPTIONS.join(", ")}`);
  }
  const environment = values["--environment"];
  if (environment !== "production" && environment !== "staging") {
    throw qualificationError("environment must be production or staging");
  }
  const qualification = values["--qualification"];
  if (qualification !== "bootstrap" && qualification !== "strict") {
    throw qualificationError("qualification must be bootstrap or strict");
  }
  if (qualification === "bootstrap" && environment !== "staging") {
    throw qualificationError("bootstrap qualification is allowed only for staging");
  }
  const expectedSha = values["--expected-sha"];
  if (!/^[a-f0-9]{40}$/i.test(expectedSha)) throw qualificationError("expected SHA is invalid");
  const expectedMigration = values["--expected-migration"];
  if (!/^\d+_[a-z0-9_]+\.sql$/i.test(expectedMigration)) {
    throw qualificationError("expected migration filename is invalid");
  }
  const expectedManifestSha = values["--expected-manifest-sha"];
  const expectedConfigSha = values["--expected-config-sha"];
  if (!/^[a-f0-9]{64}$/.test(expectedManifestSha) || !/^[a-f0-9]{64}$/.test(expectedConfigSha)) {
    throw qualificationError("expected manifest and config digests must be lowercase SHA-256 values");
  }
  let url;
  try {
    url = new URL(values["--base-url"]);
  } catch {
    throw qualificationError("base URL is invalid");
  }
  if (
    url.protocol !== "https:"
    || url.username
    || url.password
    || url.pathname !== "/"
    || url.search
    || url.hash
  ) {
    throw qualificationError("base URL must be an HTTPS origin");
  }
  return {
    environment,
    qualification,
    artifactDir: values["--artifact-dir"],
    receiptPath: values["--receipt"],
    baseUrl: values["--base-url"].replace(/\/$/, ""),
    expectedSha: expectedSha.toLowerCase(),
    expectedMigration,
    expectedManifestSha,
    expectedConfigSha,
  };
}

export function parseSecretInventory(output) {
  let inventory;
  try {
    inventory = JSON.parse(output);
  } catch {
    throw qualificationError("Wrangler secret inventory returned invalid JSON");
  }
  if (
    !Array.isArray(inventory)
    || inventory.some((entry) => !entry || typeof entry !== "object" || Array.isArray(entry) || typeof entry.name !== "string")
  ) {
    throw qualificationError("Wrangler secret inventory has an invalid schema");
  }
  return inventory.map((entry) => entry.name);
}

export function parsePredeploySecretInventory({ result }) {
  if (result?.status === 0) return parseSecretInventory(result.stdout);
  throw qualificationError("could not read Worker secret inventory before upload");
}

const REQUIRED_SECRET_GROUPS = {
  application: ["SUPABASE_ANON_KEY", "SUPABASE_SERVICE_KEY"],
  qbo: [
    "QBO_CLIENT_ID",
    "QBO_CLIENT_SECRET",
    "QBO_REDIRECT_URI",
    "QBO_ENCRYPTION_KEY",
    "QBO_WEBHOOK_VERIFIER_TOKEN",
  ],
  email: [
    "RESEND_API_KEY",
    "RESEND_WEBHOOK_SECRET",
    "RESEND_ALLOWED_FROM",
    "UNSUBSCRIBE_SECRET",
    "APP_PUBLIC_BASE_URL",
  ],
  operatorAlert: ["OPERATOR_ALERT_WEBHOOK"],
  stripe: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_PRICE_ID"],
  monitoring: ["MONITOR_TOKEN"],
};

export function inspectConfiguredProviders(secretNames) {
  if (!Array.isArray(secretNames) || secretNames.some((name) => typeof name !== "string")) {
    throw qualificationError("secret inventory is invalid");
  }
  const names = new Set(secretNames);
  const missing = {};
  for (const [group, required] of Object.entries(REQUIRED_SECRET_GROUPS)) {
    const absent = required.filter((name) => !names.has(name));
    if (absent.length > 0) missing[group] = absent;
  }
  const missingTwilio = [
    "TWILIO_ACCOUNT_SID",
    "TWILIO_AUTH_TOKEN",
    "TWILIO_PUBLIC_BASE_URL",
  ].filter((name) => !names.has(name));
  if (!names.has("TWILIO_MESSAGING_SERVICE_SID") && !names.has("TWILIO_FROM_NUMBER")) {
    missingTwilio.push("TWILIO_MESSAGING_SERVICE_SID or TWILIO_FROM_NUMBER");
  }
  if (missingTwilio.length > 0) missing.twilio = missingTwilio;

  return {
    configured: Object.fromEntries(
      [...Object.keys(REQUIRED_SECRET_GROUPS), "twilio"].map((group) => [group, !missing[group]]),
    ),
    missing,
  };
}

export function assertConfiguredProviders(secretNames) {
  const inspection = inspectConfiguredProviders(secretNames);
  for (const group of Object.keys(REQUIRED_SECRET_GROUPS)) {
    const missing = inspection.missing[group];
    if (missing?.length > 0) {
      throw qualificationError(`${group} configuration is missing secret names: ${missing.join(", ")}`);
    }
  }
  const missingTwilio = inspection.missing.twilio ?? [];
  const missingTwilioBase = missingTwilio.filter((name) => !name.includes(" or "));
  if (missingTwilioBase.length > 0) {
    throw qualificationError(`twilio configuration is missing secret names: ${missingTwilioBase.join(", ")}`);
  }
  if (missingTwilio.length > 0) throw qualificationError("Twilio sender configuration is missing");
  return inspection.configured;
}

export function bootstrapProviderConfiguration(secretNames) {
  const inspection = inspectConfiguredProviders(secretNames);
  const missingApplication = inspection.missing.application;
  if (missingApplication?.length > 0) {
    throw qualificationError(
      `application configuration is missing secret names: ${missingApplication.join(", ")}`,
    );
  }
  return inspection.configured;
}

export function parseMigrationList(output) {
  if (typeof output !== "string") throw qualificationError("Supabase migration output is invalid");
  const rows = [];
  for (const line of output.split(/\r?\n/)) {
    if (!/[|│]/.test(line)) continue;
    const columns = line.split(/[|│]/);
    if (columns.length < 2) continue;
    const local = columns[0].trim();
    const remote = columns[1].trim();
    if (local.toUpperCase() === "LOCAL" || /^[\s─-]+$/.test(local + remote)) continue;
    if (!/^\d*$/.test(local) || !/^\d*$/.test(remote) || (!local && !remote)) {
      throw qualificationError("Supabase migration list contained an unrecognized data row");
    }
    rows.push({ local, remote });
  }
  if (rows.length === 0) throw qualificationError("Supabase migration list contained no migration rows");
  return rows;
}

export function assertMigrationParity(actualVersions, expectedMigrationFiles) {
  if (
    !Array.isArray(actualVersions)
    || !Array.isArray(expectedMigrationFiles)
    || actualVersions.some((version) => !/^\d+$/.test(version))
    || expectedMigrationFiles.some((filename) => !/^\d+_[a-z0-9_]+\.sql$/i.test(filename))
  ) {
    throw qualificationError("expected migration inventory is invalid");
  }
  const expectedVersions = expectedMigrationFiles.map((filename) => filename.split("_", 1)[0]);
  if (JSON.stringify(actualVersions) !== JSON.stringify(expectedVersions)) {
    throw qualificationError("remote migration history does not exactly match the sealed migration inventory");
  }
}

export function parseDeploymentStatus(output) {
  let status;
  try {
    status = JSON.parse(output);
  } catch {
    throw qualificationError("Wrangler deployment status returned invalid JSON");
  }
  const cloudflareId = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  if (
    !status
    || typeof status !== "object"
    || Array.isArray(status)
    || typeof status.id !== "string"
    || typeof status.created_on !== "string"
    || !Array.isArray(status.versions)
    || status.versions.length !== 1
    || typeof status.versions[0]?.version_id !== "string"
    || status.versions[0]?.percentage !== 100
    || !cloudflareId.test(status.id)
    || !cloudflareId.test(status.versions[0].version_id)
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(status.created_on)
    || Number.isNaN(Date.parse(status.created_on))
  ) {
    throw qualificationError("Wrangler deployment status must contain exactly one version at 100%");
  }
  return {
    deploymentId: status.id,
    versionId: status.versions[0].version_id,
    createdOn: status.created_on,
  };
}

export function parsePreviousDeploymentStatus(result) {
  if (result?.status === 0) return parseDeploymentStatus(result.stdout);
  const stderr = typeof result?.stderr === "string"
    ? result.stderr.replace(/\u001b\[[0-9;]*m/g, "")
    : "";
  if (/The Worker [^\r\n]+ has no deployments\./.test(stderr)) return undefined;
  throw qualificationError("could not read the current Worker deployment status");
}

export function parseVersionList(output, expectedReleaseAnnotation) {
  let versions;
  try {
    versions = JSON.parse(output);
  } catch {
    throw qualificationError("Wrangler versions list returned invalid JSON");
  }
  if (!Array.isArray(versions) || typeof expectedReleaseAnnotation !== "string") {
    throw qualificationError("Wrangler versions list has an invalid schema");
  }
  const matches = versions.filter((version) => (
    version?.annotations?.["workers/message"] === expectedReleaseAnnotation
  ));
  const version = matches.length === 1 ? matches[0] : undefined;
  const cloudflareId = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  if (
    !version
    || !cloudflareId.test(version.id ?? "")
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(version.metadata?.created_on ?? "")
    || Number.isNaN(Date.parse(version.metadata?.created_on))
  ) {
    throw qualificationError("Wrangler versions list did not contain exactly one valid release annotation");
  }
  return { versionId: version.id, createdOn: version.metadata.created_on };
}

export function assertDeploymentUnchanged(before, after) {
  if (
    before?.deploymentId !== after?.deploymentId
    || before?.versionId !== after?.versionId
    || before?.createdOn !== after?.createdOn
  ) {
    throw qualificationError("active Worker deployment changed during release qualification");
  }
}

export function assertLinkedSupabaseProject({ targetSupabaseUrl, linkedProjectRef }) {
  let url;
  try {
    url = new URL(targetSupabaseUrl);
  } catch {
    throw qualificationError("sealed target Supabase URL is invalid");
  }
  const expectedRef = /^([a-z0-9]+)\.supabase\.co$/i.exec(url.hostname)?.[1]?.toLowerCase();
  if (!expectedRef || linkedProjectRef?.trim().toLowerCase() !== expectedRef) {
    throw qualificationError("linked Supabase project does not match the sealed target config");
  }
}

export function assertQualificationBaseUrl({ environment, baseUrl, workerName, targetConfig }) {
  const url = new URL(baseUrl);
  if (environment === "production") {
    const route = targetConfig.routes?.length === 1 && targetConfig.routes[0]?.custom_domain === true
      ? targetConfig.routes[0].pattern
      : undefined;
    if (!route || url.origin !== `https://${route}`) {
      throw qualificationError("qualification base URL does not match the sealed production route");
    }
    return;
  }
  const expectedStagingOrigin = "https://nudgepay-app-staging.dasblueeyeddevil.workers.dev";
  if (workerName !== "nudgepay-app-staging" || url.origin !== expectedStagingOrigin) {
    throw qualificationError("qualification base URL does not match the exact approved staging Worker origin");
  }
}

export function readyzDatabaseEvidence(body) {
  if (!body || typeof body !== "object" || body.ok !== true) {
    throw qualificationError("readyz did not verify database and application configuration");
  }
  return { database: true };
}

export function readyzConfigurationEvidence(body) {
  const database = readyzDatabaseEvidence(body);
  const providerNames = ["qbo", "twilio", "email", "operatorAlert"];
  for (const name of providerNames) {
    if (body.providers?.[name] !== true) {
      throw qualificationError(`readyz did not verify ${name} configuration`);
    }
  }
  return {
    ...database,
    qbo: true,
    twilio: true,
    email: true,
    operatorAlert: true,
  };
}

const MONITOR_CHECK_NAMES = [
  "database",
  "provider_monitor",
  "cdc",
  "digest",
  "retention",
  "cdc_checkpoint",
  "qbo_sync",
  "operator_alert",
];

export function monitorzRuntimeEvidence(body) {
  if (!body || typeof body !== "object" || body.ok !== true) {
    const failed = MONITOR_CHECK_NAMES.filter((name) => body?.checks?.[name] !== "ok");
    throw qualificationError(`monitorz did not verify runtime checks${failed.length ? `: ${failed.join(", ")}` : ""}`);
  }
  for (const name of MONITOR_CHECK_NAMES) {
    if (body.checks?.[name] !== "ok") {
      throw qualificationError(`monitorz did not verify ${name}`);
    }
  }
  return Object.fromEntries(MONITOR_CHECK_NAMES.map((name) => [name, "ok"]));
}

export function assertReceiptMatchesRelease({
  receipt,
  manifest,
  environment,
  expectedWorkerName,
  activeDeployment,
}) {
  const target = manifest?.targets?.[environment];
  if (!target) throw qualificationError(`manifest has no ${environment} target`);
  const fields = [
    ["source commit", receipt?.sourceCommit, manifest.sourceCommit],
    ["artifact digest", receipt?.artifactSha256, manifest.artifactSha256],
    ["manifest digest", receipt?.manifestSha256, manifest.manifestSha256],
    ["target config digest", receipt?.configSha256, target.configSha256],
    ["environment", receipt?.environment, environment],
    ["Worker name", receipt?.workerName, expectedWorkerName],
  ];
  for (const [label, actual, expected] of fields) {
    if (actual !== expected) throw qualificationError(`deployment receipt ${label} does not match the sealed release`);
  }
  if (
    receipt?.versionId !== activeDeployment?.versionId
    || receipt?.deploymentId !== activeDeployment?.deploymentId
    || receipt?.deployedAt !== activeDeployment?.createdOn
  ) {
    throw qualificationError("deployment receipt does not match the active Worker version");
  }
  if (receipt?.queryStringRedactionVerified !== true) {
    throw qualificationError("deployment receipt does not prove query-string redaction readback");
  }
  const annotationPrefix = `nudgepay-release:${manifest.manifestSha256}:${environment}:`;
  if (
    typeof receipt?.releaseAnnotation !== "string"
    || !receipt.releaseAnnotation.startsWith(annotationPrefix)
    || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
      receipt.releaseAnnotation.slice(annotationPrefix.length),
    )
  ) {
    throw qualificationError("deployment receipt release annotation does not match the sealed release");
  }
}

export function verifyReceiptDigest(receipt) {
  if (receipt?.schemaVersion !== 1 || !/^[a-f0-9]{64}$/.test(receipt?.receiptSha256 ?? "")) {
    throw qualificationError("deployment receipt is invalid");
  }
  if (receipt.receiptSha256 !== receiptDigest(receipt)) {
    throw qualificationError("deployment receipt self-digest mismatch");
  }
}

function readJsonFile(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw qualificationError(`${label} is missing or invalid JSON`);
  }
}

function runReadOnlyCli(binary, args, cwd) {
  const result = spawnSync(process.execPath, [binary, ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0) {
    throw qualificationError(`read-only ${args.slice(0, 2).join(" ")} check failed`);
  }
  return result.stdout;
}

async function fetchReadyzEvidence(baseUrl, evidenceFn, fetchFn = fetch) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    let response;
    try {
      response = await fetchFn(`${baseUrl}/readyz`, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
    } catch {
      throw qualificationError("readyz request failed");
    }
    let body;
    try {
      body = await response.json();
    } catch {
      throw qualificationError("readyz returned invalid JSON");
    }
    if (response.headers.get("cache-control")?.toLowerCase() !== "no-store") {
      throw qualificationError("readyz response did not include Cache-Control: no-store");
    }
    if (!response.ok) throw qualificationError(`readyz returned HTTP ${response.status}`);
    return evidenceFn(body);
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchReadyz(baseUrl, fetchFn = fetch) {
  return fetchReadyzEvidence(baseUrl, readyzConfigurationEvidence, fetchFn);
}

export async function fetchReadyzDatabase(baseUrl, fetchFn = fetch) {
  return fetchReadyzEvidence(baseUrl, readyzDatabaseEvidence, fetchFn);
}

async function fetchMonitorz(baseUrl, monitorToken, fetchFn = fetch) {
  if (typeof monitorToken !== "string" || monitorToken.length < 32 || monitorToken.length > 512) {
    throw qualificationError("MONITOR_TOKEN must be supplied locally and contain 32 to 512 characters");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    let response;
    try {
      response = await fetchFn(`${baseUrl}/monitorz`, {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${monitorToken}`,
        },
        signal: controller.signal,
      });
    } catch {
      throw qualificationError("monitorz request failed");
    }
    let body;
    try {
      body = await response.json();
    } catch {
      throw qualificationError("monitorz returned invalid JSON");
    }
    if (response.headers.get("cache-control")?.toLowerCase() !== "no-store") {
      throw qualificationError("monitorz response did not include Cache-Control: no-store");
    }
    if (!response.ok) {
      const failed = MONITOR_CHECK_NAMES.filter((name) => body?.checks?.[name] === "fail");
      throw qualificationError(`monitorz returned HTTP ${response.status}${failed.length ? ` (${failed.join(", ")})` : ""}`);
    }
    return monitorzRuntimeEvidence(body);
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  const options = parseQualificationArgs(process.argv.slice(2));
  const appRoot = fileURLToPath(new URL("..", import.meta.url));
  const wranglerBin = fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url));
  const migrationFiles = validatedMigrationFilenames(
    readdirSync(new URL("../supabase/migrations", import.meta.url)),
  );
  const manifest = readAndVerifyReleaseArtifact({
    artifactDir: options.artifactDir,
    expectedSourceCommit: options.expectedSha,
    expectedLatestMigration: options.expectedMigration,
    expectedMigrationFiles: migrationFiles,
  });
  const target = manifest.targets[options.environment];
  if (manifest.manifestSha256 !== options.expectedManifestSha) {
    throw qualificationError("sealed manifest digest does not match the independently expected digest");
  }
  if (target.configSha256 !== options.expectedConfigSha) {
    throw qualificationError("sealed target config does not match the independently expected digest");
  }
  const targetConfigPath = resolve(options.artifactDir, ...target.configPath.split("/"));
  const targetConfig = readJsonFile(targetConfigPath, "sealed target config");
  const production = productionConfigFromToml(
    readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8"),
  );
  assertDeployConfig({
    environment: options.environment,
    config: targetConfig,
    productionSupabaseUrl: production.vars.SUPABASE_URL,
  });
  if (options.environment === "production") {
    assertProductionConfigParity(targetConfig, production, "sealed production Worker config");
  }
  assertQualificationBaseUrl({
    environment: options.environment,
    baseUrl: options.baseUrl,
    workerName: target.workerName,
    targetConfig,
  });
  const supabaseProjectRef = projectRefFromSupabaseUrl(targetConfig.vars?.SUPABASE_URL);

  resolveReceiptDirectory({
    artifactDir: options.artifactDir,
    receiptDir: dirname(resolve(options.receiptPath)),
  });
  const receipt = readJsonFile(options.receiptPath, "deployment receipt");
  verifyReceiptDigest(receipt);

  const activeDeployment = parseDeploymentStatus(runReadOnlyCli(wranglerBin, [
    "deployments", "status",
    "-c", targetConfigPath,
    "--name", target.workerName,
    "--json",
  ], appRoot));
  const annotatedVersion = parseVersionList(runReadOnlyCli(wranglerBin, [
    "versions", "list",
    "-c", targetConfigPath,
    "--name", target.workerName,
    "--json",
  ], appRoot), receipt.releaseAnnotation);
  if (annotatedVersion.versionId !== activeDeployment.versionId) {
    throw qualificationError("release annotation does not identify the active Worker version");
  }
  const secretNames = parseSecretInventory(runReadOnlyCli(wranglerBin, [
    "secret", "list", "-c", targetConfigPath, "--name", target.workerName,
  ], appRoot));
  const providerInspection = inspectConfiguredProviders(secretNames);
  const migrationRows = await fetchSupabaseMigrationInventory({
    projectRef: supabaseProjectRef,
    accessToken: process.env.SUPABASE_ACCESS_TOKEN,
  });
  assertMigrationParity(migrationRows, manifest.migrationFiles);
  let providerConfiguration;
  let readyz;
  let monitorz;
  let pendingQualification;
  if (options.qualification === "strict") {
    providerConfiguration = assertConfiguredProviders(secretNames);
    readyz = await fetchReadyz(options.baseUrl);
    monitorz = await fetchMonitorz(options.baseUrl, process.env.MONITOR_TOKEN);
  } else {
    providerConfiguration = providerInspection.configured;
    readyz = await fetchReadyzDatabase(options.baseUrl);
    monitorz = { status: "pending_strict_qualification" };
    pendingQualification = {
      status: "pending",
      missingProviderSecrets: providerInspection.missing,
      requiredBeforeProduction: [
        "strict_staging_requalification",
        "readyz_configuration",
        "monitorz_runtime_health",
        "provider_integration_and_operator_gates",
      ],
    };
  }
  assertReceiptMatchesRelease({
    receipt,
    manifest,
    environment: options.environment,
    expectedWorkerName: target.workerName,
    activeDeployment,
  });
  const finalActiveDeployment = parseDeploymentStatus(runReadOnlyCli(wranglerBin, [
    "deployments", "status",
    "-c", targetConfigPath,
    "--name", target.workerName,
    "--json",
  ], appRoot));
  assertDeploymentUnchanged(activeDeployment, finalActiveDeployment);

  console.log(JSON.stringify({
    status: options.qualification === "strict"
      ? "configuration_verified"
      : "deployment_verified_pending_qualification",
    evidenceScope: options.qualification === "strict"
      ? "configuration_verified_not_provider_integration"
      : "staging_bootstrap_pending_strict_qualification",
    qualification: options.qualification,
    environment: options.environment,
    workerName: target.workerName,
    sourceCommit: manifest.sourceCommit,
    latestMigration: manifest.latestMigration,
    artifactSha256: manifest.artifactSha256,
    manifestSha256: manifest.manifestSha256,
    configSha256: target.configSha256,
    deploymentId: activeDeployment.deploymentId,
    versionId: activeDeployment.versionId,
    receiptSha256: receipt.receiptSha256,
    providerConfiguration,
    readyz,
    monitorz,
    ...(pendingQualification ? { pendingQualification } : {}),
  }, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Release qualification failed");
    process.exitCode = 1;
  }
}
