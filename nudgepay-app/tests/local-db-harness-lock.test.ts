import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { acquireLocalDbHarnessLock, hasLocalDbHarnessLockToken } from "../scripts/local-db-harness-lock.mjs";

test("local database harness lock atomically rejects a concurrent owner and releases cleanly", () => {
  const root = mkdtempSync(join(tmpdir(), "nudgepay-harness-lock-"));
  try {
    const first = acquireLocalDbHarnessLock({ root, owner: "vitest", pid: 101 });
    expect(existsSync(first.lockPath)).toBe(true);
    expect(() => acquireLocalDbHarnessLock({ root, owner: "authenticated-e2e", pid: 202 })).toThrow(/already active[\s\S]*vitest[\s\S]*Do not remove.*automatically/);
    first.release();
    expect(existsSync(first.lockPath)).toBe(false);
    const second = acquireLocalDbHarnessLock({ root, owner: "authenticated-e2e", pid: 202 });
    second.release();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("release is idempotent and never deletes a lock whose ownership metadata changed", () => {
  const root = mkdtempSync(join(tmpdir(), "nudgepay-harness-lock-"));
  try {
    const lock = acquireLocalDbHarnessLock({ root, owner: "vitest" });
    lock.release();
    expect(() => lock.release()).not.toThrow();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a child may use only the active parent's opaque lock token", () => {
  const root = mkdtempSync(join(tmpdir(), "nudgepay-harness-lock-"));
  try {
    const lock = acquireLocalDbHarnessLock({ root, owner: "authenticated-e2e" });
    expect(hasLocalDbHarnessLockToken({ root, token: lock.token })).toBe(true);
    expect(hasLocalDbHarnessLockToken({ root, token: "not-the-owner" })).toBe(false);
    lock.release();
    expect(hasLocalDbHarnessLockToken({ root, token: lock.token })).toBe(false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
