import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const PRODUCTION_WORKER_NAME = "nudgepay-app";
export const STAGING_WORKER_NAME = "nudgepay-app-staging";
export const PRODUCTION_ROUTE = "nudgepay.9thlevelsoftware.com";
export const PRODUCTION_SUPABASE_ORIGIN = "https://epjumsnmpvilgasycpau.supabase.co";
export const INVARIANT_VAR_NAMES = ["SUPABASE_URL", "QBO_SANDBOX", "AUTH_RATE_LIMIT_REQUIRED", "CSP_MODE"];

const RATELIMITS = {
  production: { name: "AUTH_RATE_LIMIT", namespace_id: "1001", simple: { limit: 20, period: 60 } },
  staging: { name: "AUTH_RATE_LIMIT", namespace_id: "1002", simple: { limit: 20, period: 60 } },
};

function configError(message) {
  return new Error(`Deployment preflight failed: ${message}`);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sectionBody(source, section, array = false) {
  const brackets = array ? ["\\[\\[", "\\]\\]"] : ["\\[", "\\]"];
  const pattern = new RegExp(`^${brackets[0]}${escapeRegExp(section)}${brackets[1]}\\s*$`, "m");
  const match = pattern.exec(source);
  if (!match) return undefined;
  return source.slice(match.index + match[0].length).split(/^\s*\[/m, 1)[0];
}

function sectionBodies(source, section) {
  const pattern = new RegExp(`^\\[\\[${escapeRegExp(section)}\\]\\]\\s*$`, "gm");
  return [...source.matchAll(pattern)].map((match) => (
    source.slice((match.index ?? 0) + match[0].length).split(/^\s*\[/m, 1)[0]
  ));
}

function topLevelBody(source) {
  return source.split(/^\s*\[/m, 1)[0];
}

function readQuotedValue(body, key) {
  if (!body) return undefined;
  return new RegExp(`^\\s*${escapeRegExp(key)}\\s*=\\s*"([^"]+)"\\s*(?:#.*)?$`, "m").exec(body)?.[1];
}

function readBooleanValue(body, key) {
  if (!body) return undefined;
  const value = new RegExp(`^\\s*${escapeRegExp(key)}\\s*=\\s*(true|false)\\s*(?:#.*)?$`, "m").exec(body)?.[1];
  return value === undefined ? undefined : value === "true";
}

function readPositiveInteger(body, key) {
  if (!body) return undefined;
  const value = new RegExp(`${escapeRegExp(key)}\\s*=\\s*(\\d+)`).exec(body)?.[1];
  return value === undefined ? undefined : Number(value);
}

export function canonicalSupabaseOrigin(value) {
  if (typeof value !== "string") return undefined;
  const match = /^https:\/\/([a-z0-9]+)\.supabase\.co\/?$/i.exec(value);
  return match ? `https://${match[1].toLowerCase()}.supabase.co` : undefined;
}

export function isConcreteSupabaseUrl(value) {
  return canonicalSupabaseOrigin(value) !== undefined;
}

export function readTomlVar(source, section, key) {
  return readQuotedValue(sectionBody(source, section), key);
}

export function configFromToml(source, environment) {
  const prefix = environment === "root" ? "" : `env.${environment}`;
  const base = prefix ? sectionBody(source, prefix) : topLevelBody(source);
  const varsBody = sectionBody(source, prefix ? `${prefix}.vars` : "vars");
  const routeBodies = sectionBodies(source, prefix ? `${prefix}.routes` : "routes");
  const rateBodies = sectionBodies(source, prefix ? `${prefix}.ratelimits` : "ratelimits");

  return {
    name: readQuotedValue(base, "name"),
    workers_dev: readBooleanValue(base, "workers_dev"),
    vars: Object.fromEntries(INVARIANT_VAR_NAMES.map((key) => [key, readQuotedValue(varsBody, key)])),
    routes: routeBodies.map((body) => ({
      pattern: readQuotedValue(body, "pattern"),
      custom_domain: readBooleanValue(body, "custom_domain"),
    })),
    ratelimits: rateBodies.map((body) => {
      const simpleBody = /simple\s*=\s*\{([^}]+)\}/.exec(body)?.[1];
      return {
        name: readQuotedValue(body, "name"),
        namespace_id: readQuotedValue(body, "namespace_id"),
        simple: { limit: readPositiveInteger(simpleBody, "limit"), period: readPositiveInteger(simpleBody, "period") },
      };
    }),
  };
}

export const productionConfigFromToml = (source) => configFromToml(source, "production");
export const stagingConfigFromToml = (source) => configFromToml(source, "staging");
export const rootConfigFromToml = (source) => configFromToml(source, "root");

function assertRateLimit(environment, config) {
  const expected = RATELIMITS[environment];
  if ((config.ratelimits ?? []).length !== 1) {
    throw configError(`${environment} requires exactly one AUTH_RATE_LIMIT binding`);
  }
  const matching = (config.ratelimits ?? []).filter((binding) => binding.name === expected.name);
  if (matching.length !== 1) throw configError(`${environment} requires exactly one ${expected.name} binding`);
  const actual = matching[0];
  if (actual.namespace_id !== expected.namespace_id || actual.simple?.limit !== 20 || actual.simple?.period !== 60) {
    throw configError(`${environment} ${expected.name} must use namespace ${expected.namespace_id} at 20 requests per 60 seconds`);
  }
}

export function assertDeployConfig({ environment, config, productionSupabaseUrl }) {
  const isStaging = environment === "staging";
  if (environment !== "production" && !isStaging) throw configError(`unknown environment ${environment}`);

  const vars = config.vars ?? {};
  const expectedName = isStaging ? STAGING_WORKER_NAME : PRODUCTION_WORKER_NAME;
  const expectedSandbox = isStaging ? "true" : "false";
  if (config.name !== expectedName) throw configError(`${environment} must deploy ${expectedName}`);
  if (vars.QBO_SANDBOX !== expectedSandbox) throw configError(`${environment} requires QBO_SANDBOX=${expectedSandbox}`);
  if (vars.AUTH_RATE_LIMIT_REQUIRED !== "true") throw configError(`${environment} requires AUTH_RATE_LIMIT_REQUIRED=true`);
  if (config.workers_dev !== isStaging) throw configError(`${environment} workers_dev must be ${isStaging}`);
  if (vars.CSP_MODE !== "report-only" && vars.CSP_MODE !== "enforce") {
    throw configError(`${environment} requires CSP_MODE=report-only or CSP_MODE=enforce`);
  }
  const supabaseOrigin = canonicalSupabaseOrigin(vars.SUPABASE_URL);
  const productionOrigin = PRODUCTION_SUPABASE_ORIGIN;
  if (!supabaseOrigin) throw configError(`${environment} requires a canonical HTTPS SUPABASE_URL`);
  if (isStaging) {
    if (supabaseOrigin === productionOrigin) throw configError("staging SUPABASE_URL must not equal the production Supabase origin");
    if ((config.routes ?? []).length > 0) throw configError("staging must not attach custom routes");
  } else {
    if (supabaseOrigin !== productionOrigin) throw configError(`production SUPABASE_URL must equal the pinned ${PRODUCTION_SUPABASE_ORIGIN}`);
    const routes = config.routes ?? [];
    if (routes.length !== 1 || routes[0]?.pattern !== PRODUCTION_ROUTE || routes[0]?.custom_domain !== true) {
      throw configError(`production requires only the ${PRODUCTION_ROUTE} custom domain route`);
    }
  }
  assertRateLimit(environment, config);
}

function gitOutput(cwd, args) {
  try { return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); }
  catch { throw configError("production release guard requires a readable git checkout"); }
}

export function assertProductionReleaseGuard({ expectedSha, cwd }) {
  if (typeof expectedSha !== "string" || !/^[0-9a-f]{40}$/i.test(expectedSha)) throw configError("production release guard requires EXPECTED_DEPLOY_SHA as a 40-character commit SHA");
  const head = gitOutput(cwd, ["rev-parse", "HEAD"]);
  if (head.toLowerCase() !== expectedSha.toLowerCase()) throw configError("production release guard requires EXPECTED_DEPLOY_SHA to equal HEAD");
  if (gitOutput(cwd, ["status", "--porcelain=v1", "--untracked-files=all"]) !== "") throw configError("production release guard requires a clean tracked and untracked worktree");
}

export function productionDeployShaForEnvironment(env) {
  return env?.WORKERS_CI === "1" ? env.WORKERS_CI_COMMIT_SHA : env?.EXPECTED_DEPLOY_SHA;
}

export function assertNoInvariantSecrets(secretNames, environment) {
  const collisions = INVARIANT_VAR_NAMES.filter((name) => secretNames.includes(name));
  if (collisions.length > 0) {
    throw configError(`remove ${environment} secret bindings that override validated vars: ${collisions.join(", ")}`);
  }
}

function comparableConfig(config) {
  return {
    name: config.name,
    workers_dev: config.workers_dev,
    vars: Object.fromEntries(INVARIANT_VAR_NAMES.map((key) => [key, config.vars?.[key]])),
    routes: config.routes ?? [],
    ratelimits: config.ratelimits ?? [],
  };
}

export function assertProductionConfigParity(candidate, canonical, label = "production config") {
  if (JSON.stringify(comparableConfig(candidate)) !== JSON.stringify(comparableConfig(canonical))) {
    throw configError(`${label} does not match [env.production]`);
  }
}

export function parseDeploymentArgs(argv) {
  if (argv.length === 0) return "production";
  if (argv.length === 1 && argv[0] === "--staging") return "staging";
  throw configError("use no arguments for production or exactly --staging for staging");
}

function main() {
  const args = process.argv.slice(2);
  const source = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
  const canonical = productionConfigFromToml(source);
  if (args.length === 0) {
    const rootSource = readFileSync(new URL("../../wrangler.toml", import.meta.url), "utf8");
    const root = rootConfigFromToml(rootSource);
    assertDeployConfig({ environment: "production", config: canonical, productionSupabaseUrl: canonical.vars.SUPABASE_URL });
    assertDeployConfig({ environment: "production", config: root, productionSupabaseUrl: canonical.vars.SUPABASE_URL });
    assertProductionConfigParity(root, canonical, "root Workers Builds config");
    return;
  }
  if (args.length !== 4 || args[0] !== "--built-config" || args[2] !== "--environment") {
    throw configError("usage: deploy-preflight.mjs --built-config <path> --environment production");
  }
  if (args[3] !== "production") throw configError("built-config CLI validation supports production only");
  const built = JSON.parse(readFileSync(args[1], "utf8"));
  assertDeployConfig({ environment: "production", config: built, productionSupabaseUrl: canonical.vars.SUPABASE_URL });
  assertProductionConfigParity(built, canonical, "built Worker config");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
