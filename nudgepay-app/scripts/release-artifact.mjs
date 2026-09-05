import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, posix, relative, resolve, sep } from "node:path";

export const RELEASE_MANIFEST_NAME = "release-manifest.json";

function releaseError(message) {
  return new Error(`Release artifact verification failed: ${message}`);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sha256File(path) {
  return sha256(readFileSync(path));
}

function withoutManifestDigest(manifest) {
  const { manifestSha256: _manifestSha256, ...unsigned } = manifest;
  return unsigned;
}

export function manifestDigest(manifest) {
  return sha256(canonicalJson(withoutManifestDigest(manifest)));
}

function assertSourceCommit(value) {
  if (typeof value !== "string" || !/^[a-f0-9]{40}$/i.test(value)) {
    throw releaseError("source commit must be a 40-character git SHA");
  }
}

function assertLatestMigration(value) {
  if (typeof value !== "string" || !/^\d+_[a-z0-9_]+\.sql$/i.test(value)) {
    throw releaseError("latest migration must be a numbered SQL migration filename");
  }
}

function portableRelative(root, path) {
  return relative(root, path).split(sep).join("/");
}

function assertSafeRelativePath(value) {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.includes("\\")
    || value.includes("\0")
    || isAbsolute(value)
    || posix.normalize(value) !== value
    || value === "."
    || value.startsWith("../")
  ) {
    throw releaseError(`unsafe artifact path ${JSON.stringify(value)}`);
  }
}

function isCredentialLikePath(path) {
  const name = basename(path).toLowerCase();
  return name === ".env"
    || name.startsWith(".env.")
    || name === ".dev.vars"
    || name.startsWith(".dev.vars.")
    || name === "credentials.json"
    || name === "service-account.json"
    || /\.(?:pem|key|p12|pfx)$/.test(name);
}

function walkRegularFiles(root, { rejectCredentials = true } = {}) {
  const resolvedRoot = resolve(root);
  if (!existsSync(resolvedRoot) || !lstatSync(resolvedRoot).isDirectory()) {
    throw releaseError(`directory does not exist: ${resolvedRoot}`);
  }
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      const relativePath = portableRelative(resolvedRoot, absolute);
      assertSafeRelativePath(relativePath);
      const stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) {
        throw releaseError(`symbolic links are forbidden: ${relativePath}`);
      }
      if (stat.isDirectory()) {
        visit(absolute);
        continue;
      }
      if (!stat.isFile()) throw releaseError(`non-regular artifact entry: ${relativePath}`);
      if (rejectCredentials && isCredentialLikePath(relativePath)) {
        throw releaseError(`credential-like file is forbidden: ${relativePath}`);
      }
      files.push({ absolute, path: relativePath, size: stat.size });
    }
  };
  visit(resolvedRoot);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

function assertEmptyDestination(artifactDir) {
  if (existsSync(artifactDir) && readdirSync(artifactDir).length > 0) {
    throw releaseError("artifact destination must be absent or empty");
  }
}

function targetConfigBytes(config) {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw releaseError("target config must be an object");
  }
  if (config.main !== "index.js" || config.no_bundle !== true) {
    throw releaseError("target config must use the prebuilt index.js with no_bundle=true");
  }
  if (config.assets?.directory !== "../client") {
    throw releaseError("target config must use the sealed ../client asset directory");
  }
  return `${JSON.stringify(config, null, 2)}\n`;
}

function fileRecords(artifactDir) {
  return walkRegularFiles(artifactDir)
    .filter((file) => file.path !== RELEASE_MANIFEST_NAME)
    .map((file) => ({ path: file.path, size: file.size, sha256: sha256File(file.absolute) }));
}

function artifactDigest(files) {
  return sha256(canonicalJson(files));
}

export function createReleaseArtifact({
  buildRoot,
  artifactDir,
  sourceCommit,
  latestMigration,
  migrationFiles,
  targetConfigs,
  createdAt = new Date().toISOString(),
}) {
  assertSourceCommit(sourceCommit);
  assertLatestMigration(latestMigration);
  if (
    !Array.isArray(migrationFiles)
    || migrationFiles.length === 0
    || migrationFiles.some((name) => typeof name !== "string" || !/^\d+_[a-z0-9_]+\.sql$/i.test(name))
    || migrationFiles.at(-1) !== latestMigration
  ) {
    throw releaseError("migration file inventory must be ordered and end at the latest migration");
  }
  if (!targetConfigs?.production || !targetConfigs?.staging) {
    throw releaseError("both production and staging target configs are required");
  }

  const sourceRoot = resolve(buildRoot);
  const destinationRoot = resolve(artifactDir);
  assertEmptyDestination(destinationRoot);
  const sourceFiles = walkRegularFiles(sourceRoot);
  const copiedFiles = sourceFiles.filter((file) => (
    file.path !== "server/wrangler.json"
    && file.path !== "server/wrangler.production.json"
    && file.path !== "server/wrangler.staging.json"
  ));
  if (!copiedFiles.some((file) => file.path === "server/index.js")) {
    throw releaseError("build output is missing server/index.js");
  }

  mkdirSync(destinationRoot, { recursive: true });
  for (const file of copiedFiles) {
    const destination = join(destinationRoot, ...file.path.split("/"));
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(file.absolute, destination);
  }

  const targetEntries = {};
  for (const environment of ["production", "staging"]) {
    const configPath = `server/wrangler.${environment}.json`;
    const bytes = targetConfigBytes(targetConfigs[environment]);
    writeFileSync(join(destinationRoot, ...configPath.split("/")), bytes, { flag: "wx" });
    targetEntries[environment] = {
      configPath,
      configSha256: sha256(bytes),
      workerName: targetConfigs[environment].name,
    };
  }

  const files = fileRecords(destinationRoot);
  const manifest = {
    schemaVersion: 1,
    createdAt,
    sourceCommit: sourceCommit.toLowerCase(),
    latestMigration,
    migrationFiles: [...migrationFiles],
    artifactSha256: artifactDigest(files),
    files,
    targets: targetEntries,
  };
  manifest.manifestSha256 = manifestDigest(manifest);
  const temporaryPath = join(destinationRoot, `${RELEASE_MANIFEST_NAME}.tmp`);
  writeFileSync(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
  renameSync(temporaryPath, join(destinationRoot, RELEASE_MANIFEST_NAME));
  return manifest;
}

function parseManifest(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw releaseError("release manifest is missing or invalid JSON");
  }
}

export function readAndVerifyReleaseArtifact({
  artifactDir,
  expectedSourceCommit,
  expectedLatestMigration,
  expectedMigrationFiles,
}) {
  const artifactRoot = resolve(artifactDir);
  const manifest = parseManifest(join(artifactRoot, RELEASE_MANIFEST_NAME));
  if (manifest?.schemaVersion !== 1) throw releaseError("unsupported manifest schema");
  assertSourceCommit(manifest.sourceCommit);
  assertLatestMigration(manifest.latestMigration);
  if (
    !Array.isArray(manifest.migrationFiles)
    || manifest.migrationFiles.length === 0
    || manifest.migrationFiles.some((name) => typeof name !== "string" || !/^\d+_[a-z0-9_]+\.sql$/i.test(name))
    || manifest.migrationFiles.at(-1) !== manifest.latestMigration
  ) {
    throw releaseError("manifest migration file inventory is invalid");
  }
  if (manifest.manifestSha256 !== manifestDigest(manifest)) {
    throw releaseError("manifest self-digest mismatch");
  }
  if (expectedSourceCommit && manifest.sourceCommit !== expectedSourceCommit.toLowerCase()) {
    throw releaseError("manifest source commit does not match the expected release SHA");
  }
  if (expectedLatestMigration && manifest.latestMigration !== expectedLatestMigration) {
    throw releaseError("manifest latest migration does not match the expected migration");
  }
  if (expectedMigrationFiles && JSON.stringify(manifest.migrationFiles) !== JSON.stringify(expectedMigrationFiles)) {
    throw releaseError("manifest migration file inventory does not match the source migration chain");
  }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw releaseError("manifest file inventory is empty");
  }

  const expectedPaths = new Set();
  for (const file of manifest.files) {
    assertSafeRelativePath(file?.path);
    if (expectedPaths.has(file.path)) throw releaseError(`duplicate artifact path: ${file.path}`);
    expectedPaths.add(file.path);
    if (!Number.isSafeInteger(file.size) || file.size < 0 || !/^[a-f0-9]{64}$/.test(file.sha256 ?? "")) {
      throw releaseError(`invalid file record: ${file.path}`);
    }
    const absolute = resolve(artifactRoot, ...file.path.split("/"));
    if (!absolute.startsWith(`${artifactRoot}${sep}`)) throw releaseError(`unsafe artifact path ${JSON.stringify(file.path)}`);
    let stat;
    try {
      stat = lstatSync(absolute);
    } catch {
      throw releaseError(`sealed file is missing: ${file.path}`);
    }
    if (stat.isSymbolicLink()) throw releaseError(`symbolic links are forbidden: ${file.path}`);
    if (!stat.isFile()) throw releaseError(`sealed entry is not a regular file: ${file.path}`);
    if (stat.size !== file.size || sha256File(absolute) !== file.sha256) {
      throw releaseError(`sealed file hash mismatch: ${file.path}`);
    }
  }

  const actualFiles = walkRegularFiles(artifactRoot)
    .map((file) => file.path)
    .filter((path) => path !== RELEASE_MANIFEST_NAME);
  for (const path of actualFiles) {
    if (!expectedPaths.has(path)) throw releaseError(`unlisted file in sealed artifact: ${path}`);
  }
  if (actualFiles.length !== expectedPaths.size) throw releaseError("sealed artifact file inventory differs");
  if (manifest.artifactSha256 !== artifactDigest(manifest.files)) {
    throw releaseError("artifact inventory digest mismatch");
  }

  for (const environment of ["production", "staging"]) {
    const target = manifest.targets?.[environment];
    if (!target) throw releaseError(`manifest is missing ${environment} target config`);
    assertSafeRelativePath(target.configPath);
    const record = manifest.files.find((file) => file.path === target.configPath);
    if (!record || record.sha256 !== target.configSha256) {
      throw releaseError(`${environment} target config is not sealed by its recorded digest`);
    }
    let config;
    try {
      config = JSON.parse(readFileSync(resolve(artifactRoot, ...target.configPath.split("/")), "utf8"));
    } catch {
      throw releaseError(`${environment} target config is invalid JSON`);
    }
    if (typeof target.workerName !== "string" || target.workerName !== config.name) {
      throw releaseError(`${environment} Worker name does not match its sealed config`);
    }
  }
  return manifest;
}
