import { describe, expect, it } from "vitest";
import { receiptDigest } from "../scripts/release-deployment.mjs";
import {
  assertConfiguredProviders,
  assertDeploymentUnchanged,
  assertMigrationParity,
  assertLinkedSupabaseProject,
  assertQualificationBaseUrl,
  assertReceiptMatchesRelease,
  parseDeploymentStatus,
  parsePreviousDeploymentStatus,
  parseVersionList,
  parseQualificationArgs,
  parseSecretInventory,
  parsePredeploySecretInventory,
  parseMigrationList,
  readyzConfigurationEvidence,
  readyzDatabaseEvidence,
  fetchReadyzDatabase,
  monitorzRuntimeEvidence,
  inspectConfiguredProviders,
  verifyReceiptDigest,
} from "../scripts/release-qualifier.mjs";

const allSecretNames = [
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
const deploymentId = "11111111-1111-4111-8111-111111111111";
const versionId = "22222222-2222-4222-8222-222222222222";

describe("release qualification", () => {
  it("requires explicit release identity and target inputs", () => {
    expect(parseQualificationArgs([
      "--environment", "production",
      "--qualification", "strict",
      "--artifact-dir", "C:/evidence/release-a",
      "--receipt", "C:/evidence/receipts/production.json",
      "--base-url", "https://nudgepay.example",
      "--expected-sha", "a".repeat(40),
      "--expected-migration", "0064_workspace_deletion_fk_indexes.sql",
      "--expected-manifest-sha", "b".repeat(64),
      "--expected-config-sha", "c".repeat(64),
    ])).toEqual({
      environment: "production",
      qualification: "strict",
      artifactDir: "C:/evidence/release-a",
      receiptPath: "C:/evidence/receipts/production.json",
      baseUrl: "https://nudgepay.example",
      expectedSha: "a".repeat(40),
      expectedMigration: "0064_workspace_deletion_fk_indexes.sql",
      expectedManifestSha: "b".repeat(64),
      expectedConfigSha: "c".repeat(64),
    });
    expect(() => parseQualificationArgs([])).toThrow(/required options/);
    expect(() => parseQualificationArgs([
      "--environment", "prod",
      "--qualification", "strict",
      "--artifact-dir", "x",
      "--receipt", "y",
      "--base-url", "https://example.com",
      "--expected-sha", "a".repeat(40),
      "--expected-migration", "0064_x.sql",
      "--expected-manifest-sha", "b".repeat(64),
      "--expected-config-sha", "c".repeat(64),
    ])).toThrow(/environment/);
    expect(() => parseQualificationArgs([
      "--environment", "production",
      "--qualification", "bootstrap",
      "--artifact-dir", "x",
      "--receipt", "y",
      "--base-url", "https://example.com",
      "--expected-sha", "a".repeat(40),
      "--expected-migration", "0064_x.sql",
      "--expected-manifest-sha", "b".repeat(64),
      "--expected-config-sha", "c".repeat(64),
    ])).toThrow(/bootstrap.*staging/i);
  });

  it("accepts only Wrangler's documented secret-list JSON records", () => {
    expect(parseSecretInventory(JSON.stringify([
      { name: "SUPABASE_ANON_KEY", type: "secret_text" },
      { name: "STRIPE_PRICE_ID", type: "secret_text" },
    ]))).toEqual(["SUPABASE_ANON_KEY", "STRIPE_PRICE_ID"]);
    expect(() => parseSecretInventory('{"SUPABASE_ANON_KEY":true}')).toThrow(/secret inventory/);
    expect(() => parseSecretInventory('[{"name":42}]')).toThrow(/secret inventory/);
  });

  it("treats only Wrangler's exact new-Worker bootstrap result as an empty secret inventory", () => {
    const stderr = `X [ERROR] Worker "nudgepay-app-staging" not found.\n\nIf this is a new Worker, run \`wrangler deploy\` first to create it.\nOtherwise, check that the Worker name is correct and you're logged into the right account.\n`;
    expect(parsePredeploySecretInventory({
      result: { status: 1, stdout: "", stderr },
      environment: "staging",
      qualification: "bootstrap",
      workerName: "nudgepay-app-staging",
    })).toEqual([]);
    expect(() => parsePredeploySecretInventory({
      result: { status: 1, stdout: "", stderr },
      environment: "staging",
      qualification: "strict",
      workerName: "nudgepay-app-staging",
    })).toThrow(/secret inventory before upload/);
    expect(() => parsePredeploySecretInventory({
      result: { status: 1, stdout: "", stderr: "X [ERROR] Authentication failed.\n" },
      environment: "staging",
      qualification: "bootstrap",
      workerName: "nudgepay-app-staging",
    })).toThrow(/secret inventory before upload/);
  });

  it("requires every provider configuration group, including Stripe and a Twilio sender", () => {
    const evidence = assertConfiguredProviders(allSecretNames);
    expect(evidence).toEqual({
      application: true,
      qbo: true,
      twilio: true,
      email: true,
      operatorAlert: true,
      stripe: true,
      monitoring: true,
    });

    expect(() => assertConfiguredProviders(allSecretNames.filter((name) => name !== "STRIPE_PRICE_ID"))).toThrow(/stripe.*STRIPE_PRICE_ID/i);
    expect(() => assertConfiguredProviders(allSecretNames.filter((name) => name !== "TWILIO_MESSAGING_SERVICE_SID"))).toThrow(/Twilio sender/);
    expect(() => assertConfiguredProviders([
      ...allSecretNames.filter((name) => name !== "TWILIO_MESSAGING_SERVICE_SID"),
      "TWILIO_FROM_NUMBER",
    ])).not.toThrow();
  });

  it("records missing provider configuration during staging bootstrap without treating it as qualified", () => {
    expect(inspectConfiguredProviders([
      "SUPABASE_ANON_KEY",
      "SUPABASE_SERVICE_KEY",
      "MONITOR_TOKEN",
    ])).toEqual({
      configured: {
        application: true,
        qbo: false,
        twilio: false,
        email: false,
        operatorAlert: false,
        stripe: false,
        monitoring: true,
      },
      missing: {
        qbo: [
          "QBO_CLIENT_ID",
          "QBO_CLIENT_SECRET",
          "QBO_REDIRECT_URI",
          "QBO_ENCRYPTION_KEY",
          "QBO_WEBHOOK_VERIFIER_TOKEN",
        ],
        twilio: [
          "TWILIO_ACCOUNT_SID",
          "TWILIO_AUTH_TOKEN",
          "TWILIO_PUBLIC_BASE_URL",
          "TWILIO_MESSAGING_SERVICE_SID or TWILIO_FROM_NUMBER",
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
      },
    });
  });

  it("parses the documented Supabase migration table and rejects any local/remote drift", () => {
    const table = `
      LOCAL | REMOTE | TIME (UTC)
     --------|--------|------------
      0062  | 0062   |
      0063  | 0063   |
      0064  | 0064   |
    `;
    const rows = parseMigrationList(table);
    expect(rows).toEqual([
      { local: "0062", remote: "0062" },
      { local: "0063", remote: "0063" },
      { local: "0064", remote: "0064" },
    ]);
    const expected = ["0062_a.sql", "0063_b.sql", "0064_c.sql"];
    expect(() => assertMigrationParity(rows, expected)).not.toThrow();
    expect(() => assertMigrationParity([...rows, { local: "0065", remote: "" }], [...expected, "0065_d.sql"])).toThrow(/migration history differs/);
    expect(() => assertMigrationParity([rows[0], rows[2]], expected)).toThrow(/exactly match/);
    expect(() => assertMigrationParity([...rows, rows[2]], expected)).toThrow(/exactly match/);
    expect(() => parseMigrationList(`${table}\n unexpected | row |`)).toThrow(/unrecognized data row/);
  });

  it("accepts only an exact single-version 100 percent Wrangler deployment", () => {
    const status = parseDeploymentStatus(JSON.stringify({
      id: deploymentId,
      created_on: "2026-09-05T20:01:00.000Z",
      versions: [{ version_id: versionId, percentage: 100 }],
    }));
    expect(status).toEqual({
      deploymentId,
      versionId,
      createdOn: "2026-09-05T20:01:00.000Z",
    });
    expect(() => parseDeploymentStatus(JSON.stringify({
      id: deploymentId,
      created_on: "2026-09-05T20:01:00.000Z",
      versions: [
        { version_id: "old", percentage: 50 },
        { version_id: "new", percentage: 50 },
      ],
    }))).toThrow(/exactly one version at 100%/);
    expect(() => parseDeploymentStatus(JSON.stringify({
      id: "../unsafe",
      created_on: "not-a-date",
      versions: [{ version_id: "../unsafe", percentage: 100 }],
    }))).toThrow(/exactly one version at 100%/);
  });

  it("allows only Wrangler's explicit no-deployments result for a first upload", () => {
    expect(parsePreviousDeploymentStatus({
      status: 1,
      stdout: "",
      stderr: "X [ERROR] The Worker nudgepay-app-staging has no deployments.\n",
    })).toBeUndefined();
    expect(() => parsePreviousDeploymentStatus({
      status: 1,
      stdout: "",
      stderr: "X [ERROR] Authentication failed.\n",
    })).toThrow(/current Worker deployment status/);
  });

  it("fails qualification if the active deployment changes during checks", () => {
    const before = { deploymentId, versionId, createdOn: "2026-09-05T20:01:00.000Z" };
    expect(() => assertDeploymentUnchanged(before, { ...before })).not.toThrow();
    expect(() => assertDeploymentUnchanged(before, {
      ...before,
      versionId: "33333333-3333-4333-8333-333333333333",
    })).toThrow(/changed during release qualification/);
  });

  it("binds the active version to the unique Wrangler release annotation", () => {
    const message = `nudgepay-release:${"a".repeat(64)}:production:nonce`;
    expect(parseVersionList(JSON.stringify([{
      id: versionId,
      metadata: { created_on: "2026-09-05T20:00:59.000Z" },
      annotations: { "workers/message": message },
    }]), message)).toEqual({ versionId, createdOn: "2026-09-05T20:00:59.000Z" });
    expect(() => parseVersionList(JSON.stringify([{
      id: versionId,
      metadata: { created_on: "2026-09-05T20:00:59.000Z" },
      annotations: { "workers/message": "another deploy" },
    }]), message)).toThrow(/release annotation/);
  });

  it("matches an external deployment receipt to the sealed manifest and active version", () => {
    const manifest = {
      sourceCommit: "a".repeat(40),
      artifactSha256: "b".repeat(64),
      manifestSha256: "c".repeat(64),
      targets: { production: { configSha256: "d".repeat(64) } },
    };
    const unsignedReceipt = {
      schemaVersion: 1,
      environment: "production",
      sourceCommit: manifest.sourceCommit,
      artifactSha256: manifest.artifactSha256,
      manifestSha256: manifest.manifestSha256,
      configSha256: manifest.targets.production.configSha256,
      workerName: "nudgepay-app",
      deploymentId,
      versionId,
      deployedAt: "2026-09-05T20:01:00.000Z",
      releaseAnnotation: `nudgepay-release:${manifest.manifestSha256}:production:44444444-4444-4444-8444-444444444444`,
      queryStringRedactionVerified: true,
    };
    const receipt = { ...unsignedReceipt, receiptSha256: receiptDigest(unsignedReceipt) };
    expect(() => verifyReceiptDigest(receipt)).not.toThrow();
    expect(() => assertReceiptMatchesRelease({
      receipt,
      manifest,
      environment: "production",
      expectedWorkerName: "nudgepay-app",
      activeDeployment: { deploymentId, versionId, createdOn: receipt.deployedAt },
    })).not.toThrow();
    expect(() => assertReceiptMatchesRelease({
      receipt: { ...receipt, versionId: "33333333-3333-4333-8333-333333333333" },
      manifest,
      environment: "production",
      expectedWorkerName: "nudgepay-app",
      activeDeployment: { deploymentId, versionId, createdOn: receipt.deployedAt },
    })).toThrow(/active Worker version/);
    expect(() => verifyReceiptDigest({ ...receipt, workerName: "other-worker" })).toThrow(/receipt self-digest/);
  });

  it("binds migration and health probes to the sealed Supabase and Worker targets", () => {
    expect(() => assertLinkedSupabaseProject({
      targetSupabaseUrl: "https://stagingref.supabase.co",
      linkedProjectRef: "stagingref\n",
    })).not.toThrow();
    expect(() => assertLinkedSupabaseProject({
      targetSupabaseUrl: "https://stagingref.supabase.co",
      linkedProjectRef: "productionref",
    })).toThrow(/linked Supabase project/);
    expect(() => assertQualificationBaseUrl({
      environment: "production",
      baseUrl: "https://nudgepay.9thlevelsoftware.com",
      workerName: "nudgepay-app",
      targetConfig: { routes: [{ pattern: "nudgepay.9thlevelsoftware.com", custom_domain: true }] },
    })).not.toThrow();
    expect(() => assertQualificationBaseUrl({
      environment: "production",
      baseUrl: "https://healthy.example.com",
      workerName: "nudgepay-app",
      targetConfig: { routes: [{ pattern: "nudgepay.9thlevelsoftware.com", custom_domain: true }] },
    })).toThrow(/sealed production route/);
    expect(() => assertQualificationBaseUrl({
      environment: "staging",
      baseUrl: "https://other-worker.example.workers.dev",
      workerName: "nudgepay-app-staging",
      targetConfig: { routes: [] },
    })).toThrow(/approved staging Worker origin/);
    expect(() => assertQualificationBaseUrl({
      environment: "staging",
      baseUrl: "https://nudgepay-app-staging.other-account.workers.dev",
      workerName: "nudgepay-app-staging",
      targetConfig: { routes: [] },
    })).toThrow(/approved staging Worker origin/);
  });

  it("requires readyz database/config success and each provider it can inspect", () => {
    expect(readyzDatabaseEvidence({
      ok: true,
      providers: { qbo: false, twilio: false, email: false, operatorAlert: false },
    })).toEqual({ database: true });
    expect(() => readyzDatabaseEvidence({
      ok: false,
      reason: "db",
      providers: { qbo: false, twilio: false, email: false, operatorAlert: false },
    })).toThrow(/readyz.*database/i);
    expect(readyzConfigurationEvidence({
      ok: true,
      providers: { qbo: true, twilio: true, email: true, operatorAlert: true },
    })).toEqual({ database: true, qbo: true, twilio: true, email: true, operatorAlert: true });
    expect(() => readyzConfigurationEvidence({
      ok: true,
      providers: { qbo: true, twilio: true, email: false, operatorAlert: true },
    })).toThrow(/readyz.*email/i);
  });

  it("accepts bootstrap readiness only with a live database and a non-cacheable response", async () => {
    const body = {
      ok: true,
      providers: { qbo: false, twilio: false, email: false, operatorAlert: false },
    };
    await expect(fetchReadyzDatabase("https://staging.example", async () => Response.json(body, {
      headers: { "Cache-Control": "no-store" },
    }))).resolves.toEqual({ database: true });
    await expect(fetchReadyzDatabase("https://staging.example", async () => Response.json(body))).rejects.toThrow(
      /Cache-Control: no-store/,
    );
  });

  it("requires every authenticated monitor check to be healthy", () => {
    const healthy = {
      ok: true,
      checks: {
        database: "ok",
        provider_monitor: "ok",
        cdc: "ok",
        digest: "ok",
        retention: "ok",
        cdc_checkpoint: "ok",
        qbo_sync: "ok",
        operator_alert: "ok",
      },
    };
    expect(monitorzRuntimeEvidence(healthy)).toEqual(healthy.checks);
    expect(() => monitorzRuntimeEvidence({
      ...healthy,
      ok: false,
      checks: { ...healthy.checks, operator_alert: "fail" },
    })).toThrow(/monitorz.*operator_alert/i);
  });
});
