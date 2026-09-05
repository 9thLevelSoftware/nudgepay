// Production/staging Worker deploy. The Vite Cloudflare plugin copies
// `.dev.vars` into build/server/; wrangler then overrides toml vars with
// local Supabase. Strip that file before upload.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import {
  assertCloudflareWorkerNameOverride,
  assertDeployConfig,
  assertNoInvariantSecrets,
  assertProductionReleaseGuard,
  assertProductionConfigParity,
  parseDeploymentArgs,
  productionDeployShaForEnvironment,
  productionConfigFromToml,
  stagingConfigFromToml,
} from "./deploy-preflight.mjs";

const environment = parseDeploymentArgs(process.argv.slice(2));
const staging = environment === "staging";
const cwd = new URL("..", import.meta.url);
const wranglerToml = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
const productionConfig = productionConfigFromToml(wranglerToml);
const stagingConfig = stagingConfigFromToml(wranglerToml);
const stagingSupabaseUrl = process.env.STAGING_SUPABASE_URL;

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

function targetSecretNames() {
  const result = spawnSync("npx", ["wrangler", "secret", "list", "--env", environment], {
    cwd,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    throw new Error(`Deployment preflight failed: could not read the ${environment} secret inventory`);
  }
  try {
    return JSON.parse(result.stdout).map((secret) => secret.name).filter((name) => typeof name === "string");
  } catch {
    throw new Error(`Deployment preflight failed: could not read the ${environment} secret inventory`);
  }
}

// Validate before building or calling Wrangler. Staging values come from an
// explicit environment variable so the production project cannot be inherited.
const targetConfig = staging
  ? {
      ...stagingConfig,
      vars: { ...stagingConfig.vars, SUPABASE_URL: stagingSupabaseUrl },
    }
  : productionConfig;
const expectedProductionSha = productionDeployShaForEnvironment(process.env);
if (!staging) assertProductionReleaseGuard({ expectedSha: expectedProductionSha, cwd });
assertCloudflareWorkerNameOverride({
  environment,
  expectedName: targetConfig.name,
});
assertDeployConfig({
  environment,
  config: targetConfig,
  productionSupabaseUrl: productionConfig.vars.SUPABASE_URL,
});
assertNoInvariantSecrets(targetSecretNames(), environment);

run("npm", ["run", "build"]);
run("node", ["scripts/strip-build-dev-vars.mjs"]);

const src = new URL("../build/server/wrangler.json", import.meta.url);
const dest = new URL(`../build/server/wrangler.${environment}.json`, import.meta.url);
const cfg = JSON.parse(readFileSync(src, "utf8"));
if (staging) {
  cfg.name = targetConfig.name;
  cfg.workers_dev = targetConfig.workers_dev;
  cfg.vars = { ...cfg.vars, ...targetConfig.vars };
  cfg.routes = targetConfig.routes;
  cfg.ratelimits = targetConfig.ratelimits;
} else {
  assertProductionConfigParity(cfg, productionConfig, "built Worker config");
}
assertDeployConfig({ environment, config: cfg, productionSupabaseUrl: productionConfig.vars.SUPABASE_URL });
writeFileSync(dest, JSON.stringify(cfg));
if (!staging) assertProductionReleaseGuard({ expectedSha: expectedProductionSha, cwd });
run("npx", ["wrangler", "deploy", "-c", `build/server/wrangler.${environment}.json`]);
// redact_query_string is a script-level API setting that Wrangler 4.88 does
// not expose in its configuration schema. Apply it after each canonical
// production/staging upload and read it back before reporting success.
run("node", ["scripts/enforce-observability-redaction.mjs", "--worker", targetConfig.name]);
