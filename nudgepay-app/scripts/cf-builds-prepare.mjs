// Prepares the Workers build output. Always cwd to this package, even when
// Wrangler [build] is invoked from the repository root.
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  assertDeployConfig,
  assertNoInvariantSecrets,
  assertProductionReleaseGuard,
  assertProductionConfigParity,
  productionDeployShaForEnvironment,
  productionConfigFromToml,
  rootConfigFromToml,
} from "./deploy-preflight.mjs";

const appRoot = fileURLToPath(new URL("..", import.meta.url));

function expectedProductionDeploySha(env = process.env) {
  // Cloudflare Workers Builds supplies the commit checked out for this build.
  // Local/manual production preparation must identify the separately approved
  // candidate explicitly.
  return productionDeployShaForEnvironment(env);
}

const expectedDeploySha = expectedProductionDeploySha();
assertProductionReleaseGuard({ expectedSha: expectedDeploySha, cwd: appRoot });

function run(cmd, args, extraEnv = {}) {
  const r = spawnSync(cmd, args, {
    cwd: appRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: {
      ...process.env,
      CI: "true",
      ...extraEnv,
    },
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

function productionSecretNames() {
  const result = spawnSync("npx", ["wrangler", "secret", "list", "--env", "production"], {
    cwd: appRoot,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    throw new Error("Deployment preflight failed: could not read the production secret inventory");
  }
  try {
    return JSON.parse(result.stdout).map((secret) => secret.name).filter((name) => typeof name === "string");
  } catch {
    throw new Error("Deployment preflight failed: could not read the production secret inventory");
  }
}

const nodeModules = new URL("../node_modules", import.meta.url);
if (!existsSync(nodeModules)) {
  // NODE_ENV=production makes npm omit=dev; react-router/vite live in
  // devDependencies. --include=dev matches render.yaml's production install.
  run("npm", ["ci", "--include=dev"]);
}
run("npm", ["run", "build"], { NODE_ENV: "production" });
run("node", ["scripts/strip-build-dev-vars.mjs"]);

const appSource = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
const rootSource = readFileSync(new URL("../../wrangler.toml", import.meta.url), "utf8");
const production = productionConfigFromToml(appSource);
const root = rootConfigFromToml(rootSource);
const built = JSON.parse(readFileSync(new URL("../build/server/wrangler.json", import.meta.url), "utf8"));

assertNoInvariantSecrets(productionSecretNames(), "production");

for (const [label, config] of [["root Workers Builds config", root], ["built Worker config", built]]) {
  assertDeployConfig({ environment: "production", config, productionSupabaseUrl: production.vars.SUPABASE_URL });
  assertProductionConfigParity(config, production, label);
}
if (existsSync(new URL("../build/server/.dev.vars", import.meta.url))) {
  throw new Error("Deployment preflight failed: build/server/.dev.vars remains after stripping");
}
assertProductionReleaseGuard({ expectedSha: expectedDeploySha, cwd: appRoot });
