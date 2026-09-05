import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const LOCAL_DB_HARNESS_LOCK_NAME = "nudgepay-local-db-harness.lock";

function describeExistingLock(lockPath) {
  try {
    const owner = JSON.parse(readFileSync(join(lockPath, "owner.json"), "utf8"));
    return owner?.owner ? ` Active owner: ${owner.owner} (pid ${owner.pid ?? "unknown"}).` : "";
  } catch { return ""; }
}

/**
 * Lets a child process prove that its parent holds the shared lock without
 * acquiring it a second time. The random token is kept in the lock metadata,
 * so an arbitrary environment variable cannot bypass the inter-process gate.
 */
export function hasLocalDbHarnessLockToken({ token, root = tmpdir() } = {}) {
  if (typeof token !== "string" || !token) return false;
  try {
    const owner = JSON.parse(readFileSync(join(root, LOCAL_DB_HARNESS_LOCK_NAME, "owner.json"), "utf8"));
    return owner?.token === token;
  } catch {
    return false;
  }
}

export function acquireLocalDbHarnessLock({ owner, root = tmpdir(), pid = process.pid } = {}) {
  if (typeof owner !== "string" || !owner.trim()) throw new Error("Local DB harness lock requires a non-empty owner label.");
  const lockPath = join(root, LOCAL_DB_HARNESS_LOCK_NAME);
  const token = randomUUID();
  try {
    mkdirSync(lockPath);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "EEXIST") {
      throw new Error(`Local DB harness is already active.${describeExistingLock(lockPath)} Do not remove this lock automatically; confirm the owner is stopped, then remove ${lockPath} explicitly.`);
    }
    throw error;
  }
  try {
    writeFileSync(join(lockPath, "owner.json"), `${JSON.stringify({ owner: owner.trim(), pid, token, acquiredAt: new Date().toISOString() })}\n`, { mode: 0o600 });
  } catch (error) {
    rmSync(lockPath, { recursive: true, force: true, maxRetries: 3 });
    throw error;
  }
  let released = false;
  return {
    lockPath,
    token,
    release() {
      if (released) return;
      let current;
      try { current = JSON.parse(readFileSync(join(lockPath, "owner.json"), "utf8")); } catch { throw new Error("Local DB harness lock ownership metadata is missing; refusing to release another harness lock."); }
      if (current?.token !== token) throw new Error("Local DB harness lock ownership changed; refusing to release another harness lock.");
      rmSync(lockPath, { recursive: true, force: true, maxRetries: 3 });
      released = true;
    },
  };
}
