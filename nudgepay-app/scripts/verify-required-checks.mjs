#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const REQUIRED_PR_CHECKS = [
  "secret scan",
  "CodeQL (JavaScript/TypeScript)",
  "typecheck + unit tests",
  "production check",
  "supabase integration",
  "browser smoke",
  "npm audit (production)",
  "authenticated browser flows",
];

export function configuredCheckNames(requiredStatusChecks) {
  return [...new Set([
    ...(requiredStatusChecks?.contexts ?? []),
    ...(requiredStatusChecks?.checks ?? []).map((check) => check.context),
  ].filter((name) => typeof name === "string"))].sort();
}

export function missingRequiredChecks(configured) {
  const names = new Set(configured);
  return REQUIRED_PR_CHECKS.filter((name) => !names.has(name));
}

function ghJson(args) {
  const result = spawnSync("gh", args, { encoding: "utf8", windowsHide: true });
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || `gh ${args.join(" ")} failed`);
  }
  return JSON.parse(result.stdout);
}

function main() {
  if (process.argv.length > 3) throw new Error("Usage: node scripts/verify-required-checks.mjs [branch]");
  const branch = process.argv[2] ?? "main";
  const repository = process.env.GITHUB_REPOSITORY
    ?? ghJson(["repo", "view", "--json", "nameWithOwner"]).nameWithOwner;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error("Could not resolve owner/repository");
  if (!/^[A-Za-z0-9._/-]+$/.test(branch)) throw new Error("Invalid branch name");

  const statusChecks = ghJson([
    "api",
    `repos/${repository}/branches/${branch}/protection/required_status_checks`,
  ]);
  const configured = configuredCheckNames(statusChecks);
  const missing = missingRequiredChecks(configured);
  console.log(JSON.stringify({ repository, branch, configured, expected: REQUIRED_PR_CHECKS, missing }, null, 2));
  if (missing.length > 0) {
    throw new Error(`Hosted branch protection is missing required checks: ${missing.join(", ")}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
