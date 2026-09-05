import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertCloudflareWorkerNameOverride,
  assertDeployConfig,
  assertProductionReleaseGuard,
  assertNoInvariantSecrets,
  assertProductionConfigParity,
  isConcreteSupabaseUrl,
  parseDeploymentArgs,
  productionConfigFromToml,
  rootConfigFromToml,
  stagingConfigFromToml,
  STAGING_WORKER_NAME,
  PRODUCTION_SUPABASE_ORIGIN,
  productionDeployShaForEnvironment,
} from "../scripts/deploy-preflight.mjs";

const productionUrl = PRODUCTION_SUPABASE_ORIGIN;
const productionRate = { name: "AUTH_RATE_LIMIT", namespace_id: "1001", simple: { limit: 20, period: 60 } };
const stagingRate = { name: "AUTH_RATE_LIMIT", namespace_id: "1002", simple: { limit: 20, period: 60 } };

function stagingConfig(overrides: Record<string, unknown> = {}) {
  return {
    name: STAGING_WORKER_NAME,
    workers_dev: true,
    routes: [],
    ratelimits: [stagingRate],
    vars: {
      SUPABASE_URL: "https://stagingproject.supabase.co",
      QBO_SANDBOX: "true",
      AUTH_RATE_LIMIT_REQUIRED: "true",
      CSP_MODE: "report-only",
    },
    ...overrides,
  };
}

function productionConfig(overrides: Record<string, unknown> = {}) {
  return {
    name: "nudgepay-app",
    workers_dev: false,
    routes: [{ pattern: "nudgepay.9thlevelsoftware.com", custom_domain: true }],
    ratelimits: [productionRate],
    vars: {
      SUPABASE_URL: productionUrl,
      QBO_SANDBOX: "false",
      AUTH_RATE_LIMIT_REQUIRED: "true",
      CSP_MODE: "report-only",
    },
    ...overrides,
  };
}

describe("deployment preflight", () => {
  it("accepts isolated canonical production and staging configs", () => {
    expect(() => assertDeployConfig({ environment: "staging", config: stagingConfig(), productionSupabaseUrl: productionUrl })).not.toThrow();
    expect(() => assertDeployConfig({ environment: "production", config: productionConfig(), productionSupabaseUrl: productionUrl })).not.toThrow();
  });

  it("pins production to the repository origin even when a caller supplies another URL", () => {
    expect(() => assertDeployConfig({ environment: "production", config: productionConfig(), productionSupabaseUrl: "https://attacker.supabase.co" })).not.toThrow();
    expect(() => assertDeployConfig({ environment: "production", config: productionConfig({ vars: { ...productionConfig().vars, SUPABASE_URL: "https://attacker.supabase.co" } }), productionSupabaseUrl: productionUrl })).toThrow(/pinned/);
    expect(() => assertDeployConfig({ environment: "staging", config: stagingConfig({ vars: { ...stagingConfig().vars, SUPABASE_URL: productionUrl } }), productionSupabaseUrl: "https://attacker.supabase.co" })).toThrow(/must not equal/);
  });

  it("rejects non-sandbox staging and production routes in staging", () => {
    expect(() => assertDeployConfig({
      environment: "staging",
      config: stagingConfig({ vars: { ...stagingConfig().vars, QBO_SANDBOX: "false" } }),
      productionSupabaseUrl: productionUrl,
    })).toThrow(/QBO_SANDBOX=true/);
    expect(() => assertDeployConfig({
      environment: "staging",
      config: stagingConfig({ routes: [{ pattern: "nudgepay.9thlevelsoftware.com", custom_domain: true }] }),
      productionSupabaseUrl: productionUrl,
    })).toThrow(/must not attach custom routes/);
  });

  it("rejects production Supabase slash and case aliases", () => {
    for (const alias of [`${productionUrl}/`, "https://EPJUMSNMPVILGASYCPAU.supabase.co"]) {
      expect(() => assertDeployConfig({
        environment: "staging",
        config: stagingConfig({ vars: { ...stagingConfig().vars, SUPABASE_URL: alias } }),
        productionSupabaseUrl: productionUrl,
      }), alias).toThrow(/must not equal the production Supabase origin/);
    }
  });

  it("rejects malformed and non-canonical Supabase origins", () => {
    for (const invalid of ["https://stagingproject.supabase.co/path", `${productionUrl}?x=1`, "https://@productionproject.supabase.co", "https://stagingproject.supabase.co:8443", "https://productionproject.supabase.co.evil.test", "https://.supabase.co"]) {
      expect(() => assertDeployConfig({
        environment: "staging",
        config: stagingConfig({ vars: { ...stagingConfig().vars, SUPABASE_URL: invalid } }),
        productionSupabaseUrl: productionUrl,
      }), invalid).toThrow(/canonical HTTPS SUPABASE_URL/);
    }
  });

  it("rejects secret bindings that override validated vars in either environment", () => {
    for (const name of ["SUPABASE_URL", "QBO_SANDBOX", "AUTH_RATE_LIMIT_REQUIRED", "CSP_MODE"]) {
      expect(() => assertNoInvariantSecrets(["SUPABASE_ANON_KEY", name], "production"), name).toThrow(/override validated vars/);
    }
    expect(() => assertNoInvariantSecrets(["SUPABASE_ANON_KEY"], "staging")).not.toThrow();
  });

  it("requires the production custom domain and exact auth limiter", () => {
    expect(() => assertDeployConfig({ environment: "production", config: productionConfig({ routes: [] }), productionSupabaseUrl: productionUrl })).toThrow(/custom domain route/);
    expect(() => assertDeployConfig({ environment: "production", config: productionConfig({ ratelimits: [] }), productionSupabaseUrl: productionUrl })).toThrow(/AUTH_RATE_LIMIT/);
    expect(() => assertDeployConfig({
      environment: "production",
      config: productionConfig({ ratelimits: [{ ...productionRate, namespace_id: "1002" }] }),
      productionSupabaseUrl: productionUrl,
    })).toThrow(/namespace 1001/);
    expect(() => assertDeployConfig({
      environment: "production",
      config: productionConfig({ vars: { ...productionConfig().vars, AUTH_RATE_LIMIT_REQUIRED: "false" } }),
      productionSupabaseUrl: productionUrl,
    })).toThrow(/AUTH_RATE_LIMIT_REQUIRED=true/);
  });

  it("rejects alternate production ingress and invalid values", () => {
    expect(isConcreteSupabaseUrl("https://REPLACE_WITH_STAGING_SUPABASE_URL")).toBe(false);
    expect(() => assertDeployConfig({ environment: "production", config: productionConfig({ workers_dev: true }), productionSupabaseUrl: productionUrl })).toThrow(/workers_dev must be false/);
  });

  it("rejects unknown deployment arguments so staging typos cannot deploy production", () => {
    expect(parseDeploymentArgs([])).toBe("production");
    expect(parseDeploymentArgs(["--staging"])).toBe("staging");
    expect(() => parseDeploymentArgs(["--env", "staging"])).toThrow(/exactly --staging/);
    expect(() => parseDeploymentArgs(["--stagng"])).toThrow(/exactly --staging/);
  });

  it("pins top-level, production, and root-build configuration to one production target", () => {
    const toml = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
    const rootToml = readFileSync(new URL("../../wrangler.toml", import.meta.url), "utf8");
    const production = productionConfigFromToml(toml);
    const root = rootConfigFromToml(rootToml);
    const topLevel = rootConfigFromToml(toml);
    expect(production.name).toBe("nudgepay-app");
    expect(production.vars.SUPABASE_URL).toMatch(/^https:\/\/[a-z0-9]+\.supabase\.co$/);
    expect(() => assertProductionConfigParity(topLevel, production, "top level")).not.toThrow();
    expect(() => assertProductionConfigParity(root, production, "root")).not.toThrow();
  });

  it("keeps staging URL out of source and reads staging CSP mode from Wrangler", () => {
    const toml = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
    const staging = stagingConfigFromToml(toml);
    expect(staging.vars.QBO_SANDBOX).toBe("true");
    expect(staging.vars.CSP_MODE).toBe("report-only");
    expect(staging.vars.SUPABASE_URL).toBeUndefined();

    const enforceSource = toml.replace(
      /(\[env\.staging\.vars\][\s\S]*?CSP_MODE\s*=\s*)"report-only"/,
      '$1"enforce"',
    );
    const enforced = stagingConfigFromToml(enforceSource);
    const deployable = { ...enforced, vars: { ...enforced.vars, SUPABASE_URL: "https://stagingproject.supabase.co" } };
    expect(enforced.vars.CSP_MODE).toBe("enforce");
    expect(() => assertDeployConfig({ environment: "staging", config: deployable, productionSupabaseUrl: productionUrl })).not.toThrow();
  });

  it("requires a clean checkout at the explicitly expected production revision", () => {
    const cwd = mkdtempSync(join(tmpdir(), "nudgepay-deploy-guard-"));
    try {
      const git = (args: string[]) => execFileSync("git", args, { cwd, stdio: "pipe" });
      git(["init"]); git(["config", "user.email", "test@example.invalid"]); git(["config", "user.name", "NudgePay Test"]);
      writeFileSync(join(cwd, "tracked.txt"), "clean\n"); git(["add", "tracked.txt"]); git(["commit", "-m", "fixture"]);
      const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim();
      expect(() => assertProductionReleaseGuard({ cwd, expectedSha: head })).not.toThrow();
      expect(() => assertProductionReleaseGuard({ cwd, expectedSha: undefined })).toThrow(/EXPECTED_DEPLOY_SHA/);
      expect(() => assertProductionReleaseGuard({ cwd, expectedSha: "0".repeat(40) })).toThrow(/equal HEAD/);
      writeFileSync(join(cwd, "tracked.txt"), "dirty\n");
      expect(() => assertProductionReleaseGuard({ cwd, expectedSha: head })).toThrow(/clean tracked and untracked/);
      git(["checkout", "--", "tracked.txt"]);
      writeFileSync(join(cwd, "untracked.txt"), "dirty\n");
      expect(() => assertProductionReleaseGuard({ cwd, expectedSha: head })).toThrow(/clean tracked and untracked/);
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });

  it("uses the Workers Builds commit only in the Workers Builds environment", () => {
    expect(productionDeployShaForEnvironment({ WORKERS_CI: "1", WORKERS_CI_COMMIT_SHA: "a".repeat(40), EXPECTED_DEPLOY_SHA: "b".repeat(40) })).toBe("a".repeat(40));
    expect(productionDeployShaForEnvironment({ WORKERS_CI: "0", WORKERS_CI_COMMIT_SHA: "a".repeat(40), EXPECTED_DEPLOY_SHA: "b".repeat(40) })).toBe("b".repeat(40));
    expect(productionDeployShaForEnvironment({ WORKERS_CI: "1" })).toBeUndefined();
  });

  it("rejects a Workers Builds name override that changes the canonical target", () => {
    expect(() => assertCloudflareWorkerNameOverride({
      environment: "production",
      expectedName: "nudgepay-app",
      env: {},
    })).not.toThrow();
    expect(() => assertCloudflareWorkerNameOverride({
      environment: "production",
      expectedName: "nudgepay-app",
      env: { WRANGLER_CI_OVERRIDE_NAME: "nudgepay-app" },
    })).not.toThrow();
    expect(() => assertCloudflareWorkerNameOverride({
      environment: "production",
      expectedName: "nudgepay-app",
      env: { WRANGLER_CI_OVERRIDE_NAME: "another-worker" },
    })).toThrow(/canonical Worker nudgepay-app/);
  });
});
