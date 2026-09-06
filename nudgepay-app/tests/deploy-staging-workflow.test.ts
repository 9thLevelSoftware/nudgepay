import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const workflow = readFileSync(new URL("../../.github/workflows/deploy-staging.yml", import.meta.url), "utf8");

test("staging release evidence records the job outcome even after an earlier failure", () => {
  const summary = workflow.indexOf("Record staging job summary");
  const upload = workflow.indexOf("Retain staging receipt, qualification, and rollback identity");

  expect(summary).toBeGreaterThan(-1);
  expect(workflow.slice(summary, upload)).toContain("if: always()");
  expect(workflow).toContain("working-directory: ${{ runner.temp }}");
  expect(workflow).toContain("RELEASE_JOB_STATUS: ${{ job.status }}");
  expect(workflow).toContain("WORKFLOW_RUN_ID: ${{ github.run_id }}");
  expect(workflow).toContain("SOURCE_SHA: ${{ needs.candidate.outputs.source_sha }}");
  expect(workflow).toContain("mkdir -p staging-evidence/attempts");
  expect(workflow).toContain('writeFileSync("staging-evidence/job-summary.json"');
  expect(summary).toBeLessThan(upload);
});
