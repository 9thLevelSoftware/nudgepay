import { sha256, canonicalJson } from "./release-artifact.mjs";
import { writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

function deploymentError(message) {
  return new Error(`Release deployment failed: ${message}`);
}

function parseValueOptions(argv, { allowStaging }) {
  let environment = "production";
  const values = {};
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--staging" && allowStaging) {
      if (seen.has(arg)) throw deploymentError("duplicate --staging argument");
      seen.add(arg);
      environment = "staging";
      continue;
    }
    if (
      arg !== "--artifact-dir"
      && arg !== "--receipt-dir"
      && arg !== "--expected-manifest-sha"
      && arg !== "--expected-config-sha"
    ) {
      throw deploymentError("usage requires --artifact-dir, --expected-manifest-sha, and --expected-config-sha");
    }
    if (seen.has(arg)) throw deploymentError(`duplicate ${arg} argument`);
    seen.add(arg);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw deploymentError(`${arg} requires a path`);
    values[arg] = value;
    index += 1;
  }
  return { environment, values };
}

export function parseReleaseDeploymentArgs(argv) {
  const { environment, values } = parseValueOptions(argv, { allowStaging: true });
  if (
    !values["--artifact-dir"]
    || !/^[a-f0-9]{64}$/.test(values["--expected-manifest-sha"] ?? "")
    || !/^[a-f0-9]{64}$/.test(values["--expected-config-sha"] ?? "")
  ) {
    throw deploymentError("production and staging deploys require an explicit sealed artifact and independently recorded lowercase SHA-256 manifest/config digests");
  }
  return {
    environment,
    artifactDir: values["--artifact-dir"],
    receiptDir: values["--receipt-dir"],
    expectedManifestSha: values["--expected-manifest-sha"],
    expectedConfigSha: values["--expected-config-sha"],
  };
}

export function parseReleasePreparationArgs(argv) {
  const { values } = parseValueOptions(argv, { allowStaging: false });
  if (
    values["--receipt-dir"]
    || values["--expected-manifest-sha"]
    || values["--expected-config-sha"]
    || !values["--artifact-dir"]
  ) {
    throw deploymentError("usage: prepare-release-artifact.mjs --artifact-dir <path>");
  }
  return { artifactDir: values["--artifact-dir"] };
}

export function resolveReceiptDirectory({ artifactDir, receiptDir }) {
  const artifact = resolve(artifactDir);
  const receipt = resolve(receiptDir ?? `${artifact}-receipts`);
  const fromArtifact = relative(artifact, receipt);
  const outsideArtifact = fromArtifact === ".."
    || fromArtifact.startsWith(`..${sep}`)
    || isAbsolute(fromArtifact);
  if (!outsideArtifact) {
    throw deploymentError("deployment receipts must be stored outside the sealed artifact");
  }
  return receipt;
}

export function latestMigrationFilename(fileNames) {
  const migrations = fileNames
    .filter((name) => /^\d+_[a-z0-9_]+\.sql$/i.test(name))
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  const latest = migrations.at(-1);
  if (!latest) throw deploymentError("migration directory contains no numbered migrations");
  return latest;
}

export function validatedMigrationFilenames(fileNames) {
  const migrations = fileNames
    .filter((name) => /^\d+_[a-z0-9_]+\.sql$/i.test(name))
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  if (migrations.length === 0) throw deploymentError("migration directory contains no numbered migrations");
  for (let index = 0; index < migrations.length; index += 1) {
    const versionText = migrations[index].split("_", 1)[0];
    const version = Number(versionText);
    const expected = index + 1;
    if (!Number.isSafeInteger(version) || version !== expected) {
      const padded = String(expected).padStart(versionText.length, "0");
      throw deploymentError(`migration sequence is missing or duplicates version ${padded}`);
    }
  }
  return migrations;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const SECRET_LIKE_BINDINGS = [
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_KEY",
  "QBO_CLIENT_ID",
  "QBO_CLIENT_SECRET",
  "QBO_REDIRECT_URI",
  "QBO_ENCRYPTION_KEY",
  "QBO_WEBHOOK_VERIFIER_TOKEN",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_MESSAGING_SERVICE_SID",
  "TWILIO_FROM_NUMBER",
  "TWILIO_PUBLIC_BASE_URL",
  "RESEND_API_KEY",
  "RESEND_WEBHOOK_SECRET",
  "RESEND_ALLOWED_FROM",
  "UNSUBSCRIBE_SECRET",
  "APP_PUBLIC_BASE_URL",
  "OPERATOR_ALERT_WEBHOOK",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_PRICE_ID",
  "MONITOR_TOKEN",
];

function assertNoSecretLikeVars(config) {
  const collision = SECRET_LIKE_BINDINGS.find((name) => Object.hasOwn(config.vars ?? {}, name));
  if (collision) throw deploymentError(`built config contains secret-like binding ${collision} as plaintext`);
}

export function deriveReleaseTargetConfigs({ built, production, staging }) {
  if (!built || typeof built !== "object" || Array.isArray(built)) {
    throw deploymentError("built Worker config is invalid");
  }
  if (built.main !== "index.js" || built.no_bundle !== true || built.assets?.directory !== "../client") {
    throw deploymentError("built Worker config is not a sealed no-bundle React Router artifact");
  }
  assertNoSecretLikeVars(built);
  assertNoSecretLikeVars(staging);
  const productionTarget = clone(built);
  for (const key of ["name", "workers_dev", "vars", "routes", "ratelimits"]) {
    if (JSON.stringify(productionTarget[key]) !== JSON.stringify(production?.[key])) {
      throw deploymentError(`built Worker ${key} does not match canonical production config`);
    }
  }
  const stagingTarget = clone(built);
  for (const key of ["name", "workers_dev", "vars", "routes", "ratelimits"]) {
    stagingTarget[key] = clone(staging[key]);
  }
  return { production: productionTarget, staging: stagingTarget };
}

function withoutReceiptDigest(receipt) {
  const { receiptSha256: _receiptSha256, ...unsigned } = receipt;
  return unsigned;
}

export function receiptDigest(receipt) {
  return sha256(canonicalJson(withoutReceiptDigest(receipt)));
}

export function writeDeploymentReceipt({ receiptPath, receipt }) {
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx" });
}

export function createDeploymentAttempt({
  environment,
  sourceCommit,
  manifestSha256,
  configSha256,
  workerName,
  previousDeployment,
  attemptId,
  recordedAt = new Date().toISOString(),
}) {
  const attemptIdPattern = /^(?:[0-9]+-[0-9]+|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i;
  if ((environment !== "production" && environment !== "staging") || !attemptIdPattern.test(attemptId ?? "")) {
    throw deploymentError("deployment attempt identity is invalid");
  }
  for (const [label, value, pattern] of [
    ["source commit", sourceCommit, /^[a-f0-9]{40}$/],
    ["manifest digest", manifestSha256, /^[a-f0-9]{64}$/],
    ["config digest", configSha256, /^[a-f0-9]{64}$/],
  ]) if (!pattern.test(value ?? "")) throw deploymentError(`${label} is invalid`);
  if (typeof workerName !== "string" || !/^[a-z0-9][a-z0-9_-]*$/i.test(workerName)) {
    throw deploymentError("Worker name is invalid");
  }
  if (
    typeof recordedAt !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(recordedAt)
    || Number.isNaN(Date.parse(recordedAt))
  ) throw deploymentError("deployment attempt timestamp is invalid");
  if (previousDeployment !== undefined && previousDeployment !== null) {
    const cloudflareId = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
    if (
      !cloudflareId.test(previousDeployment.deploymentId ?? "")
      || !cloudflareId.test(previousDeployment.versionId ?? "")
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(previousDeployment.createdOn ?? "")
      || Number.isNaN(Date.parse(previousDeployment.createdOn))
    ) throw deploymentError("previous Worker deployment is incomplete");
  }
  const attempt = {
    schemaVersion: 1,
    recordedAt,
    attemptId,
    environment,
    sourceCommit,
    manifestSha256,
    configSha256,
    workerName,
    previousDeployment: previousDeployment ?? null,
    automaticRollback: false,
  };
  attempt.attemptSha256 = sha256(canonicalJson(attempt));
  return attempt;
}

export function createDeploymentReceipt({
  environment,
  sourceCommit,
  artifactSha256,
  manifestSha256,
  configSha256,
  workerName,
  previousVersionId,
  previousDeployment,
  deployment,
  queryStringRedactionVerified,
  providerConfiguration,
  releaseAnnotation,
  recordedAt = new Date().toISOString(),
}) {
  if (environment !== "production" && environment !== "staging") {
    throw deploymentError("receipt environment is invalid");
  }
  const predecessorVersionId = previousDeployment?.versionId ?? previousVersionId;
  if (!deployment?.versionId || deployment.versionId === predecessorVersionId) {
    throw deploymentError("upload did not produce a new Worker version");
  }
  const cloudflareId = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  if (
    !cloudflareId.test(deployment.deploymentId ?? "")
    || !cloudflareId.test(deployment.versionId ?? "")
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(deployment.createdOn ?? "")
    || Number.isNaN(Date.parse(deployment.createdOn))
  ) {
    throw deploymentError("Wrangler deployment status is incomplete");
  }
  if (queryStringRedactionVerified !== true) {
    throw deploymentError("query-string redaction must pass before recording deployment evidence");
  }
  const requiredProviderGroups = ["application", "qbo", "twilio", "email", "operatorAlert", "stripe", "monitoring"];
  if (requiredProviderGroups.some((name) => providerConfiguration?.[name] !== true)) {
    throw deploymentError("provider configuration evidence is incomplete");
  }
  if (
    typeof releaseAnnotation !== "string"
    || releaseAnnotation !== `nudgepay-release:${manifestSha256}:${environment}:${releaseAnnotation.split(":").at(-1)}`
    || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
      releaseAnnotation.split(":").at(-1) ?? "",
    )
  ) {
    throw deploymentError("release annotation is invalid");
  }
  for (const [label, value, pattern] of [
    ["source commit", sourceCommit, /^[a-f0-9]{40}$/i],
    ["artifact digest", artifactSha256, /^[a-f0-9]{64}$/],
    ["manifest digest", manifestSha256, /^[a-f0-9]{64}$/],
    ["config digest", configSha256, /^[a-f0-9]{64}$/],
  ]) {
    if (typeof value !== "string" || !pattern.test(value)) throw deploymentError(`${label} is invalid`);
  }
  if (typeof workerName !== "string" || !/^[a-z0-9][a-z0-9_-]*$/i.test(workerName)) {
    throw deploymentError("Worker name is invalid");
  }
  const receipt = {
    schemaVersion: 1,
    recordedAt,
    environment,
    sourceCommit: sourceCommit.toLowerCase(),
    artifactSha256,
    manifestSha256,
    configSha256,
    workerName,
    previousVersionId: predecessorVersionId ?? null,
    deploymentId: deployment.deploymentId,
    versionId: deployment.versionId,
    deployedAt: deployment.createdOn,
    queryStringRedactionVerified: true,
    providerConfiguration,
    releaseAnnotation,
    evidenceScope: "configuration_verified_not_provider_integration",
  };
  receipt.receiptSha256 = receiptDigest(receipt);
  return receipt;
}
