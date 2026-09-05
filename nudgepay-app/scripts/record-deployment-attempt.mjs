import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readAndVerifyReleaseArtifact } from "./release-artifact.mjs";
import { createDeploymentAttempt } from "./release-deployment.mjs";
import { parsePreviousDeploymentStatus } from "./release-qualifier.mjs";

function attemptError(message) {
  return new Error(`Deployment attempt evidence failed: ${message}`);
}

function args(argv) {
  const names = [
    "--environment", "--artifact-dir", "--evidence-dir", "--expected-sha",
    "--expected-migration", "--expected-manifest-sha", "--expected-config-sha", "--attempt-id",
  ];
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!names.includes(name) || !value || value.startsWith("--") || Object.hasOwn(values, name)) {
      throw attemptError("all attempt evidence options are required exactly once");
    }
    values[name] = value;
  }
  if (names.some((name) => !values[name])) throw attemptError("all attempt evidence options are required exactly once");
  return values;
}

function main() {
  const options = args(process.argv.slice(2));
  const appRoot = fileURLToPath(new URL("..", import.meta.url));
  const manifest = readAndVerifyReleaseArtifact({
    artifactDir: options["--artifact-dir"],
    expectedSourceCommit: options["--expected-sha"],
    expectedLatestMigration: options["--expected-migration"],
  });
  const environment = options["--environment"];
  const target = manifest.targets?.[environment];
  if (
    !target
    || manifest.manifestSha256 !== options["--expected-manifest-sha"]
    || target.configSha256 !== options["--expected-config-sha"]
  ) throw attemptError("sealed artifact does not match expected deployment identity");
  const configPath = resolve(options["--artifact-dir"], ...target.configPath.split("/"));
  JSON.parse(readFileSync(configPath, "utf8"));
  const wranglerBin = resolve(appRoot, "node_modules/wrangler/bin/wrangler.js");
  const result = spawnSync(process.execPath, [
    wranglerBin, "deployments", "status", "-c", configPath, "--name", target.workerName, "--json",
  ], { cwd: appRoot, encoding: "utf8", windowsHide: true, maxBuffer: 1024 * 1024 });
  const previousDeployment = parsePreviousDeploymentStatus(result);
  const attempt = createDeploymentAttempt({
    environment,
    sourceCommit: manifest.sourceCommit,
    manifestSha256: manifest.manifestSha256,
    configSha256: target.configSha256,
    workerName: target.workerName,
    previousDeployment,
    attemptId: options["--attempt-id"],
  });
  const evidenceDir = resolve(options["--evidence-dir"]);
  mkdirSync(evidenceDir, { recursive: true });
  const path = resolve(evidenceDir, `${environment}-attempt-${attempt.attemptId}.json`);
  writeFileSync(path, `${JSON.stringify(attempt, null, 2)}\n`, { flag: "wx" });
  console.log(JSON.stringify({
    status: "deployment_attempt_recorded",
    environment,
    attemptSha256: attempt.attemptSha256,
    previousDeployment: attempt.previousDeployment,
  }));
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : "Deployment attempt evidence failed");
  process.exitCode = 1;
}
