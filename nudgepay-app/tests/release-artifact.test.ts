import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createReleaseArtifact,
  readAndVerifyReleaseArtifact,
} from "../scripts/release-artifact.mjs";

const sourceCommit = "a".repeat(40);

function targetConfig(name: string, main = "index.js") {
  return {
    name,
    main,
    no_bundle: true,
    assets: { directory: "../client" },
    vars: { SUPABASE_URL: "https://example.supabase.co" },
  };
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "nudgepay-release-artifact-"));
  const buildRoot = join(root, "build");
  mkdirSync(join(buildRoot, "server", "assets"), { recursive: true });
  mkdirSync(join(buildRoot, "client"), { recursive: true });
  writeFileSync(join(buildRoot, "server", "index.js"), "export default {}\n");
  writeFileSync(join(buildRoot, "server", "assets", "worker.js"), "export const worker = true\n");
  writeFileSync(join(buildRoot, "client", "app.js"), "console.log('client')\n");
  writeFileSync(join(buildRoot, "server", "wrangler.json"), JSON.stringify(targetConfig("nudgepay-app")));
  return { root, buildRoot, artifactDir: join(root, "artifact") };
}

describe("sealed release artifacts", () => {
  it("seals one build with immutable production and staging target configs", () => {
    const { root, buildRoot, artifactDir } = fixture();
    try {
      const manifest = createReleaseArtifact({
        buildRoot,
        artifactDir,
        sourceCommit,
        latestMigration: "0064_workspace_deletion_fk_indexes.sql",
        migrationFiles: ["0063_provider_monitor.sql", "0064_workspace_deletion_fk_indexes.sql"],
        createdAt: "2026-09-05T20:00:00.000Z",
        targetConfigs: {
          production: targetConfig("nudgepay-app"),
          staging: targetConfig("nudgepay-app-staging"),
        },
      });

      expect(manifest.sourceCommit).toBe(sourceCommit);
      expect(manifest.latestMigration).toBe("0064_workspace_deletion_fk_indexes.sql");
      expect(manifest.migrationFiles).toEqual(["0063_provider_monitor.sql", "0064_workspace_deletion_fk_indexes.sql"]);
      expect(manifest.targets.production.configPath).toBe("server/wrangler.production.json");
      expect(manifest.targets.staging.configPath).toBe("server/wrangler.staging.json");
      expect(manifest.files.map((file: { path: string }) => file.path)).toEqual([
        "client/app.js",
        "server/assets/worker.js",
        "server/index.js",
        "server/wrangler.production.json",
        "server/wrangler.staging.json",
      ]);

      const verified = readAndVerifyReleaseArtifact({
        artifactDir,
        expectedSourceCommit: sourceCommit,
        expectedLatestMigration: "0064_workspace_deletion_fk_indexes.sql",
        expectedMigrationFiles: ["0063_provider_monitor.sql", "0064_workspace_deletion_fk_indexes.sql"],
      });
      expect(verified.manifestSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(verified.artifactSha256).toBe(manifest.artifactSha256);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails verification after a sealed file is changed or an unlisted file appears", () => {
    const { root, buildRoot, artifactDir } = fixture();
    try {
      createReleaseArtifact({
        buildRoot,
        artifactDir,
        sourceCommit,
        latestMigration: "0064_workspace_deletion_fk_indexes.sql",
        migrationFiles: ["0064_workspace_deletion_fk_indexes.sql"],
        targetConfigs: {
          production: targetConfig("nudgepay-app"),
          staging: targetConfig("nudgepay-app-staging"),
        },
      });
      writeFileSync(join(artifactDir, "server", "index.js"), "tampered\n");
      expect(() => readAndVerifyReleaseArtifact({ artifactDir })).toThrow(/hash mismatch/);

      writeFileSync(join(artifactDir, "server", "index.js"), "export default {}\n");
      writeFileSync(join(artifactDir, "unlisted.txt"), "unexpected\n");
      expect(() => readAndVerifyReleaseArtifact({ artifactDir })).toThrow(/unlisted file/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects credential-like files and links before copying build output", () => {
    const secretFixture = fixture();
    try {
      writeFileSync(join(secretFixture.buildRoot, "server", ".dev.vars"), "SECRET=value\n");
      expect(() => createReleaseArtifact({
        buildRoot: secretFixture.buildRoot,
        artifactDir: secretFixture.artifactDir,
        sourceCommit,
        latestMigration: "0064_workspace_deletion_fk_indexes.sql",
        migrationFiles: ["0064_workspace_deletion_fk_indexes.sql"],
        targetConfigs: {
          production: targetConfig("nudgepay-app"),
          staging: targetConfig("nudgepay-app-staging"),
        },
      })).toThrow(/credential-like file/);
    } finally {
      rmSync(secretFixture.root, { recursive: true, force: true });
    }

    const linkFixture = fixture();
    try {
      const target = join(linkFixture.root, "linked-target");
      mkdirSync(target);
      symlinkSync(target, join(linkFixture.buildRoot, "server", "linked"), "junction");
      expect(() => createReleaseArtifact({
        buildRoot: linkFixture.buildRoot,
        artifactDir: linkFixture.artifactDir,
        sourceCommit,
        latestMigration: "0064_workspace_deletion_fk_indexes.sql",
        migrationFiles: ["0064_workspace_deletion_fk_indexes.sql"],
        targetConfigs: {
          production: targetConfig("nudgepay-app"),
          staging: targetConfig("nudgepay-app-staging"),
        },
      })).toThrow(/symbolic links/);
    } finally {
      rmSync(linkFixture.root, { recursive: true, force: true });
    }
  });

  it("rejects manifest path traversal even when the self-digest is recomputed", async () => {
    const { root, buildRoot, artifactDir } = fixture();
    try {
      createReleaseArtifact({
        buildRoot,
        artifactDir,
        sourceCommit,
        latestMigration: "0064_workspace_deletion_fk_indexes.sql",
        migrationFiles: ["0064_workspace_deletion_fk_indexes.sql"],
        targetConfigs: {
          production: targetConfig("nudgepay-app"),
          staging: targetConfig("nudgepay-app-staging"),
        },
      });
      const path = join(artifactDir, "release-manifest.json");
      const manifest = JSON.parse(readFileSync(path, "utf8"));
      manifest.files[0].path = "../outside.txt";
      const { manifestDigest } = await import("../scripts/release-artifact.mjs");
      manifest.manifestSha256 = manifestDigest(manifest);
      writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
      expect(() => readAndVerifyReleaseArtifact({ artifactDir })).toThrow(/unsafe artifact path/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects a manifest Worker name that differs from its sealed config", async () => {
    const { root, buildRoot, artifactDir } = fixture();
    try {
      createReleaseArtifact({
        buildRoot,
        artifactDir,
        sourceCommit,
        latestMigration: "0064_workspace_deletion_fk_indexes.sql",
        migrationFiles: ["0064_workspace_deletion_fk_indexes.sql"],
        targetConfigs: {
          production: targetConfig("nudgepay-app"),
          staging: targetConfig("nudgepay-app-staging"),
        },
      });
      const path = join(artifactDir, "release-manifest.json");
      const manifest = JSON.parse(readFileSync(path, "utf8"));
      manifest.targets.production.workerName = "another-worker";
      const { manifestDigest } = await import("../scripts/release-artifact.mjs");
      manifest.manifestSha256 = manifestDigest(manifest);
      writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
      expect(() => readAndVerifyReleaseArtifact({ artifactDir })).toThrow(/Worker name.*sealed config/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
