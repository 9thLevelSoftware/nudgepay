import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createDeploymentReceipt,
  createDeploymentAttempt,
  deriveReleaseTargetConfigs,
  latestMigrationFilename,
  validatedMigrationFilenames,
  parseReleaseDeploymentArgs,
  parseReleasePreparationArgs,
  receiptDigest,
  resolveReceiptDirectory,
  writeDeploymentReceipt,
} from "../scripts/release-deployment.mjs";

function builtConfig() {
  return {
    name: "nudgepay-app",
    main: "index.js",
    no_bundle: true,
    assets: { directory: "../client" },
    workers_dev: false,
    routes: [{ pattern: "nudgepay.9thlevelsoftware.com", custom_domain: true }],
    vars: {
      SUPABASE_URL: "https://epjumsnmpvilgasycpau.supabase.co",
      QBO_SANDBOX: "false",
      AUTH_RATE_LIMIT_REQUIRED: "true",
      CSP_MODE: "report-only",
    },
    ratelimits: [{
      name: "AUTH_RATE_LIMIT",
      namespace_id: "1001",
      simple: { limit: 20, period: 60 },
    }],
    triggers: { crons: ["*/5 * * * *", "*/30 * * * *", "0 * * * *"] },
  };
}

describe("release deployment orchestration contracts", () => {
  const deploymentId = "11111111-1111-4111-8111-111111111111";
  const oldVersionId = "22222222-2222-4222-8222-222222222222";
  const newVersionId = "33333333-3333-4333-8333-333333333333";
  it("requires an explicit sealed artifact for production and staging deployment", () => {
    expect(() => parseReleaseDeploymentArgs([])).toThrow(/sealed artifact/);
    expect(parseReleaseDeploymentArgs([
      "--artifact-dir", "C:/evidence/release-a",
      "--receipt-dir", "C:/evidence/receipts",
      "--expected-manifest-sha", "a".repeat(64),
      "--expected-config-sha", "b".repeat(64),
    ])).toEqual({
      environment: "production",
      artifactDir: "C:/evidence/release-a",
      receiptDir: "C:/evidence/receipts",
      expectedManifestSha: "a".repeat(64),
      expectedConfigSha: "b".repeat(64),
    });
    expect(parseReleaseDeploymentArgs([
      "--staging",
      "--artifact-dir", "C:/evidence/release-a",
      "--expected-manifest-sha", "a".repeat(64),
      "--expected-config-sha", "b".repeat(64),
    ])).toEqual({
      environment: "staging",
      artifactDir: "C:/evidence/release-a",
      receiptDir: undefined,
      expectedManifestSha: "a".repeat(64),
      expectedConfigSha: "b".repeat(64),
    });
    expect(() => parseReleaseDeploymentArgs([
      "--artifact-dir", "one", "--artifact-dir", "two",
      "--expected-manifest-sha", "a".repeat(64),
      "--expected-config-sha", "b".repeat(64),
    ])).toThrow(/duplicate/);
  });

  it("parses preparation separately so preparation can never upload", () => {
    expect(parseReleasePreparationArgs(["--artifact-dir", "C:/evidence/release-a"])).toEqual({
      artifactDir: "C:/evidence/release-a",
    });
    expect(() => parseReleasePreparationArgs([])).toThrow(/--artifact-dir/);
    expect(() => parseReleasePreparationArgs(["--staging", "--artifact-dir", "x"])).toThrow(/usage/);
  });

  it("selects the latest numbered migration without accepting unrelated files", () => {
    expect(latestMigrationFilename([
      "0063_provider_monitor.sql",
      "README.md",
      "0064_workspace_deletion_fk_indexes.sql",
      "seed.sql",
    ])).toBe("0064_workspace_deletion_fk_indexes.sql");
    expect(() => latestMigrationFilename(["README.md"])).toThrow(/numbered migrations/);
    expect(validatedMigrationFilenames([
      "0003_three.sql",
      "0001_one.sql",
      "0002_two.sql",
    ])).toEqual(["0001_one.sql", "0002_two.sql", "0003_three.sql"]);
    expect(() => validatedMigrationFilenames([
      "0001_one.sql",
      "0003_three.sql",
    ])).toThrow(/migration sequence.*0002/i);
  });

  it("keeps mutable deployment receipts outside the sealed artifact", () => {
    expect(resolveReceiptDirectory({
      artifactDir: "C:/evidence/release-a",
      receiptDir: undefined,
    })).toMatch(/release-a-receipts$/);
    expect(() => resolveReceiptDirectory({
      artifactDir: "C:/evidence/release-a",
      receiptDir: "C:/evidence/release-a/receipts",
    })).toThrow(/outside the sealed artifact/);
    expect(() => resolveReceiptDirectory({
      artifactDir: "C:/evidence/release-a",
      receiptDir: "C:/evidence/release-a/..receipts",
    })).toThrow(/outside the sealed artifact/);
  });

  it("derives both target configs from one build while limiting environment changes", () => {
    const built = builtConfig();
    const production = {
      name: "nudgepay-app",
      workers_dev: false,
      routes: built.routes,
      vars: built.vars,
      ratelimits: built.ratelimits,
    };
    const staging = {
      name: "nudgepay-app-staging",
      workers_dev: true,
      routes: [],
      vars: {
        SUPABASE_URL: "https://isolatedstaging.supabase.co",
        QBO_SANDBOX: "true",
        AUTH_RATE_LIMIT_REQUIRED: "true",
        CSP_MODE: "report-only",
      },
      ratelimits: [{
        name: "AUTH_RATE_LIMIT",
        namespace_id: "1002",
        simple: { limit: 20, period: 60 },
      }],
    };
    const targets = deriveReleaseTargetConfigs({ built, production, staging });
    expect(targets.production).toEqual(built);
    expect(targets.staging).toEqual({
      ...built,
      name: "nudgepay-app-staging",
      workers_dev: true,
      routes: [],
      vars: staging.vars,
      ratelimits: staging.ratelimits,
    });
    expect(built.name).toBe("nudgepay-app");

    const leaked = builtConfig();
    (leaked.vars as Record<string, string>).STRIPE_SECRET_KEY = "leaked";
    expect(() => deriveReleaseTargetConfigs({ built: leaked, production: {
      ...production,
      vars: leaked.vars,
    }, staging })).toThrow(/secret-like binding.*STRIPE_SECRET_KEY/i);

    const leakedMonitorToken = builtConfig();
    (leakedMonitorToken.vars as Record<string, string>).MONITOR_TOKEN = "x".repeat(32);
    expect(() => deriveReleaseTargetConfigs({ built: leakedMonitorToken, production: {
      ...production,
      vars: leakedMonitorToken.vars,
    }, staging })).toThrow(/secret-like binding.*MONITOR_TOKEN/i);
  });

  it("creates a self-digested receipt only for a new fully active version after redaction", () => {
    const receipt = createDeploymentReceipt({
      environment: "production",
      sourceCommit: "a".repeat(40),
      artifactSha256: "b".repeat(64),
      manifestSha256: "c".repeat(64),
      configSha256: "d".repeat(64),
      workerName: "nudgepay-app",
      previousDeployment: {
        deploymentId: "55555555-5555-4555-8555-555555555555",
        versionId: oldVersionId,
        createdOn: "2026-09-05T19:59:00.000Z",
      },
      deployment: {
        deploymentId,
        versionId: newVersionId,
        createdOn: "2026-09-05T20:00:00.000Z",
      },
      queryStringRedactionVerified: true,
      providerConfiguration: {
        application: true,
        qbo: true,
        twilio: true,
        email: true,
        operatorAlert: true,
        stripe: true,
        monitoring: true,
      },
      releaseAnnotation: `nudgepay-release:${"c".repeat(64)}:production:44444444-4444-4444-8444-444444444444`,
      recordedAt: "2026-09-05T20:01:00.000Z",
    });
    expect(receipt.versionId).toBe(newVersionId);
    expect(receipt.previousVersionId).toBe(oldVersionId);
    expect(receipt.receiptSha256).toBe(receiptDigest(receipt));
    expect(() => createDeploymentReceipt({
      ...receipt,
      previousDeployment: {
        deploymentId: "55555555-5555-4555-8555-555555555555",
        versionId: oldVersionId,
        createdOn: "2026-09-05T19:59:00.000Z",
      },
      deployment: { deploymentId, versionId: oldVersionId, createdOn: receipt.deployedAt },
    })).toThrow(/new Worker version/);
    expect(() => createDeploymentReceipt({
      ...receipt,
      deployment: { deploymentId, versionId: newVersionId, createdOn: receipt.deployedAt },
      queryStringRedactionVerified: false,
    })).toThrow(/redaction/);
  });

  it("creates deployment receipts without replacing prior evidence", () => {
    const directory = mkdtempSync(join(tmpdir(), "nudgepay-receipt-"));
    const receiptPath = join(directory, "production.json");
    try {
      writeDeploymentReceipt({ receiptPath, receipt: { versionId: newVersionId } });
      expect(JSON.parse(readFileSync(receiptPath, "utf8"))).toEqual({ versionId: newVersionId });
      expect(() => writeDeploymentReceipt({
        receiptPath,
        receipt: { versionId: oldVersionId },
      })).toThrow();
      expect(JSON.parse(readFileSync(receiptPath, "utf8"))).toEqual({ versionId: newVersionId });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("records the prior version before an upload attempt without claiming automatic rollback", () => {
    const attempt = createDeploymentAttempt({
      environment: "production",
      sourceCommit: "a".repeat(40),
      manifestSha256: "b".repeat(64),
      configSha256: "c".repeat(64),
      workerName: "nudgepay-app",
      previousDeployment: {
        deploymentId,
        versionId: oldVersionId,
        createdOn: "2026-09-05T20:00:00.000Z",
      },
      attemptId: "123-1",
      recordedAt: "2026-09-05T20:01:00.000Z",
    });
    expect(attempt.previousDeployment?.versionId).toBe(oldVersionId);
    expect(attempt.automaticRollback).toBe(false);
    expect(attempt.attemptSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(() => createDeploymentAttempt({
      ...attempt,
      previousDeployment: { ...attempt.previousDeployment, versionId: "not-a-version" },
    })).toThrow(/previous Worker deployment/);
  });
});
