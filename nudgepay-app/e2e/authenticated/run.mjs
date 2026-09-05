import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { acquireLocalDbHarnessLock } from "../../scripts/local-db-harness-lock.mjs";

const bin = {
  supabase: resolve("node_modules/supabase/dist/supabase.js"),
  playwright: resolve("node_modules/@playwright/test/cli.js"),
};
let startedByRunner = false;

function run(command, args, options = {}) {
  return spawnSync(process.execPath, [bin[command], ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
    windowsHide: true,
    env: options.env,
  });
}

function fail(message, result) {
  const detail = result?.stderr?.trim() || result?.stdout?.trim();
  if (detail) process.stderr.write(`${detail}\n`);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

const docker = spawnSync("docker", ["info", "--format", "{{.ServerVersion}}"], {
  encoding: "utf8",
  stdio: "pipe",
  windowsHide: true,
});
if (docker.status !== 0) {
  fail("Authenticated E2E requires a running Docker engine for isolated local Supabase.", docker);
} else {
  let lock;
  try {
    lock = acquireLocalDbHarnessLock({ owner: "authenticated-e2e-runner" });
    let status = run("supabase", ["status", "-o", "env"], { capture: true });
    if (status.status !== 0) {
      const start = run("supabase", ["start"]);
      if (start.status !== 0) {
        fail("Could not start isolated local Supabase; authenticated E2E did not run.", start);
      } else {
        startedByRunner = true;
        status = run("supabase", ["status", "-o", "env"], { capture: true });
        if (status.status !== 0) fail("Local Supabase started but did not become healthy.", status);
      }
    }

    if (process.exitCode !== 1) {
      const playwright = run("playwright", [
        "test",
        "--config=e2e/authenticated/playwright.config.ts",
        ...process.argv.slice(2),
      ], {
        env: { ...process.env, NUDGEPAY_LOCAL_DB_HARNESS_LOCK_TOKEN: lock.token },
      });
      process.exitCode = playwright.status ?? 1;
    }
  } finally {
    if (startedByRunner) run("supabase", ["stop"]);
    lock?.release();
  }
}
