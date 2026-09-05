import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { canonicalJson, sha256 } from "../scripts/release-artifact.mjs";
import { receiptDigest } from "../scripts/release-deployment.mjs";
import {
  assertCurrentMainSha,
  assertEnvironmentProtection,
  assertQualifiedStagingJobs,
  assertQualifiedStagingRun,
  assertReleaseWorkflowMetadata,
  assertRequiredCiJobs,
  assertTrustedCiTrigger,
  locateReceipt,
} from "../scripts/release-workflow.mjs";
import { REQUIRED_PR_CHECKS } from "../scripts/verify-required-checks.mjs";

const sourceSha = "a".repeat(40);
const repository = "9thLevelSoftware/nudgepay";

describe("release workflow trust boundary", () => {
  it("accepts only a successful same-repository main push CI run", () => {
    const event = {
      repository: { full_name: repository },
      workflow_run: {
        id: 42,
        name: "CI",
        event: "push",
        conclusion: "success",
        head_branch: "main",
        head_sha: sourceSha,
        head_repository: { full_name: repository },
      },
    };
    expect(assertTrustedCiTrigger(event)).toEqual({ ciRunId: 42, sourceSha, repository });
    expect(() => assertTrustedCiTrigger({
      ...event,
      workflow_run: { ...event.workflow_run, event: "pull_request" },
    })).toThrow(/successful CI push/);
    expect(() => assertTrustedCiTrigger({
      ...event,
      workflow_run: { ...event.workflow_run, head_repository: { full_name: "fork/repo" } },
    })).toThrow(/this repository/);
  });

  it("requires all eight actual CI jobs once for the exact source SHA", () => {
    const jobs = REQUIRED_PR_CHECKS.map((name) => ({
      name, status: "completed", conclusion: "success", head_sha: sourceSha,
    }));
    expect(assertRequiredCiJobs({ total_count: jobs.length, jobs }, sourceSha)).toEqual(REQUIRED_PR_CHECKS);
    expect(() => assertRequiredCiJobs({
      total_count: jobs.length - 1,
      jobs: jobs.filter((job) => job.name !== "browser smoke"),
    }, sourceSha)).toThrow(/browser smoke/);
    expect(() => assertRequiredCiJobs({
      total_count: jobs.length,
      jobs: jobs.map((job) => job.name === "production check" ? { ...job, head_sha: "b".repeat(40) } : job),
    }, sourceSha)).toThrow(/production check/);
  });

  it("rejects candidates when main advances while they wait", () => {
    expect(() => assertCurrentMainSha(sourceSha, sourceSha)).not.toThrow();
    expect(() => assertCurrentMainSha(sourceSha, "b".repeat(40))).toThrow(/stale/);
  });

  it("requires an exact successful staging gate before handoff", () => {
    const run = {
      name: "Deploy staging",
      path: ".github/workflows/deploy-staging.yml",
      event: "workflow_run",
      conclusion: "success",
      head_branch: "main",
      head_sha: sourceSha,
      head_repository: { full_name: repository },
    };
    expect(() => assertQualifiedStagingRun(run, { repository })).not.toThrow();
    expect(() => assertQualifiedStagingRun({ ...run, conclusion: "failure" }, { repository })).toThrow(/successful trusted/);
    const jobs = [
      { name: "seal successful main candidate", status: "completed", conclusion: "success" },
      { name: "deploy and qualify staging", status: "completed", conclusion: "success" },
    ];
    expect(() => assertQualifiedStagingJobs({ total_count: 2, jobs })).not.toThrow();
    expect(() => assertQualifiedStagingJobs({
      total_count: 2,
      jobs: jobs.map((job) => job.name.startsWith("deploy") ? { ...job, conclusion: "skipped" } : job),
    })).toThrow(/deploy and qualify staging/);
  });

  it("requires fail-closed main-only environments and the named production reviewer", () => {
    const environment = {
      name: "production",
      can_admins_bypass: false,
      deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
      protection_rules: [{
        type: "required_reviewers",
        prevent_self_review: false,
        reviewers: [{ type: "User", reviewer: { login: "9thLevelSoftware" } }],
      }],
    };
    const policies = { total_count: 1, branch_policies: [{ name: "main", type: "branch" }] };
    expect(() => assertEnvironmentProtection(environment, policies, {
      expectedName: "production", requireReviewer: true, releaseOwner: "9thLevelSoftware",
    })).not.toThrow();
    expect(() => assertEnvironmentProtection({ ...environment, can_admins_bypass: true }, policies, {
      expectedName: "production", requireReviewer: true, releaseOwner: "9thLevelSoftware",
    })).toThrow(/fail-closed/);
    expect(() => assertEnvironmentProtection(environment, {
      total_count: 2,
      branch_policies: [{ name: "main" }, { name: "release/*" }],
    }, { expectedName: "production", requireReviewer: true, releaseOwner: "9thLevelSoftware" })).toThrow(/only the main branch/);
    expect(() => assertEnvironmentProtection(environment, {
      total_count: 1,
      branch_policies: [{ name: "main", type: "tag" }],
    }, { expectedName: "production", requireReviewer: true, releaseOwner: "9thLevelSoftware" })).toThrow(/only the main branch/);
  });

  it("accepts one self-digested receipt only when its release identity matches", () => {
    const directory = mkdtempSync(join(tmpdir(), "nudgepay-workflow-receipt-"));
    const manifestSha256 = "b".repeat(64);
    const configSha256 = "c".repeat(64);
    const unsigned = {
      schemaVersion: 1,
      recordedAt: "2026-09-05T20:00:00.000Z",
      environment: "staging",
      sourceCommit: sourceSha,
      artifactSha256: "d".repeat(64),
      manifestSha256,
      configSha256,
      workerName: "nudgepay-app-staging",
      deploymentId: "11111111-1111-4111-8111-111111111111",
      versionId: "22222222-2222-4222-8222-222222222222",
      deployedAt: "2026-09-05T20:00:00.000Z",
      queryStringRedactionVerified: true,
      providerConfiguration: {},
      releaseAnnotation: `nudgepay-release:${manifestSha256}:staging:22222222-2222-4222-8222-222222222222`,
      evidenceScope: "configuration_verified_not_provider_integration",
    };
    const receipt = { ...unsigned, receiptSha256: receiptDigest(unsigned) };
    try {
      writeFileSync(join(directory, "staging-22222222.json"), JSON.stringify(receipt));
      mkdirSync(join(directory, "attempts"));
      writeFileSync(join(directory, "attempts", "staging-attempt-1-1.json"), "{}");
      expect(locateReceipt({
        directory,
        environment: "staging",
        expectedReceiptSha256: receipt.receiptSha256,
        expectedSourceSha: sourceSha,
        expectedManifestSha256: manifestSha256,
        expectedConfigSha256: configSha256,
      }).receipt).toEqual(receipt);
      expect(() => locateReceipt({
        directory,
        environment: "staging",
        expectedSourceSha: "e".repeat(40),
      })).toThrow(/does not match the sealed candidate/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("self-digests workflow metadata and matches independent promotion inputs", () => {
    const unsigned = {
      schemaVersion: 1,
      sourceSha,
      latestMigration: "0066_system_job_health.sql",
      artifactSha256: "b".repeat(64),
      manifestSha256: "c".repeat(64),
      targets: {
        staging: { workerName: "nudgepay-app-staging", configSha256: "d".repeat(64), supabaseProjectRef: "stage" },
        production: { workerName: "nudgepay-app", configSha256: "e".repeat(64), supabaseProjectRef: "prod" },
      },
    };
    const metadata = { ...unsigned, metadataSha256: sha256(canonicalJson(unsigned)) };
    expect(assertReleaseWorkflowMetadata(metadata, {
      sourceSha,
      manifestSha256: "c".repeat(64),
      stagingConfigSha256: "d".repeat(64),
      productionConfigSha256: "e".repeat(64),
    })).toEqual(metadata);
    expect(() => assertReleaseWorkflowMetadata(metadata, {
      sourceSha,
      manifestSha256: "f".repeat(64),
    })).toThrow(/independently expected/);
  });
});

describe("release workflow wiring", () => {
  const staging = readFileSync(new URL("../../.github/workflows/deploy-staging.yml", import.meta.url), "utf8");
  const production = readFileSync(new URL("../../.github/workflows/promote-production.yml", import.meta.url), "utf8");
  const deployWorker = readFileSync(new URL("../scripts/deploy-worker.mjs", import.meta.url), "utf8");

  it("chains trusted CI to staging and preserves hidden sealed files", () => {
    expect(staging).toContain("workflow_run:");
    expect(staging).toContain("workflows: [CI]");
    expect(staging).toContain("include-hidden-files: true");
    expect(staging).toContain('GITHUB_RUN_ATTEMPT" != "1"');
    expect(staging).toContain('--evidence-dir "$RUNNER_TEMP/staging-evidence/attempts"');
    expect(staging).toContain("release:predeploy");
    expect(staging.indexOf("release:predeploy")).toBeLessThan(staging.indexOf("npm run deploy:staging"));
    expect(staging).toContain("cancel-in-progress: false");
  });

  it("keeps production explicit, attested, protected, and on the retained artifact", () => {
    expect(production).toContain("workflow_dispatch:");
    expect(production).toContain("operator_attests_remaining_gates:");
    expect(production).toContain("PRODUCTION_PROMOTION_ENABLED");
    expect(production).toContain("requalify retained staging artifact");
    expect(production).toContain("run-id: ${{ needs.authorize.outputs.staging_run_id }}");
    expect(production).toContain('GITHUB_RUN_ATTEMPT" != "1"');
    expect(production).toContain('--evidence-dir "$RUNNER_TEMP/production-evidence/attempts"');
    expect(production).not.toContain("secrets.CLOUDFLARE_ACCOUNT_ID");
    expect(production.match(/\$\{\{ inputs\.source_sha \}\}/g)).toHaveLength(1);
    expect(production.indexOf("release:predeploy")).toBeLessThan(production.indexOf("npm run deploy --"));
    expect(production).toContain("cancel-in-progress: false");
  });

  it("persists the deploy wrapper's own predecessor observation before upload", () => {
    expect(deployWorker).toContain('const attemptDirectory = join(outputDirectory, "attempts")');
    expect(deployWorker.indexOf("const uploadAttempt = createDeploymentAttempt")).toBeLessThan(
      deployWorker.indexOf('"deploy",'),
    );
  });
});
