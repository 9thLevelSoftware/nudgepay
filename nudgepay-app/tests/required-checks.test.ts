import { expect, test } from "vitest";
import {
  REQUIRED_PR_CHECKS,
  configuredCheckNames,
  missingRequiredChecks,
} from "../scripts/verify-required-checks.mjs";

test("normalizes legacy contexts and app-bound required checks", () => {
  expect(configuredCheckNames({
    contexts: ["production check", "secret scan"],
    checks: [{ context: "secret scan", app_id: 1 }, { context: "CodeQL (JavaScript/TypeScript)", app_id: 2 }],
  })).toEqual(["CodeQL (JavaScript/TypeScript)", "production check", "secret scan"]);
});

test("reports every candidate check missing from hosted branch protection", () => {
  expect(missingRequiredChecks(REQUIRED_PR_CHECKS)).toEqual([]);
  expect(missingRequiredChecks(REQUIRED_PR_CHECKS.filter((name) => name !== "authenticated browser flows")))
    .toEqual(["authenticated browser flows"]);
});
