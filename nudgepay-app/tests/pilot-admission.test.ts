import { expect, test } from "vitest";
import { createOrgForUser } from "../app/lib/orgs.server";
import { makeUserClient, runLocalTestSql, serviceClient } from "./helpers";

async function removeAdmittedWorkspaces(): Promise<void> {
  runLocalTestSql("truncate table public.pilot_workspace_admissions;\n");
}

test("concurrent production onboarding admits at most ten pilot workspaces", async () => {
  const service = serviceClient();
  await removeAdmittedWorkspaces();
  const owner = await makeUserClient("pilot-cap-owner@example.com");

  try {
    const attempts = await Promise.allSettled(
      Array.from({ length: 12 }, (_, index) =>
        createOrgForUser(service, owner.userId, `Pilot admission ${index + 1}`),
      ),
    );
    const admitted = attempts.filter((attempt) => attempt.status === "fulfilled");
    const rejected = attempts.filter((attempt) => attempt.status === "rejected");

    expect(admitted).toHaveLength(10);
    expect(rejected).toHaveLength(2);
    for (const attempt of rejected) {
      expect((attempt as PromiseRejectedResult).reason).toMatchObject({
        message: "Pilot workspace capacity reached",
      });
    }
  } finally {
    await removeAdmittedWorkspaces();
  }
});

test("the release gate fails explicitly when existing workspaces exceed the pilot cap", async () => {
  const service = serviceClient();
  await removeAdmittedWorkspaces();
  try {
    const { data: orgs, error: orgError } = await service.from("organizations")
      .insert(Array.from({ length: 11 }, (_, i) => ({ name: `Over-cap fixture ${i}` })))
      .select("id");
    if (orgError) throw orgError;
    const { error: admissionError } = await service.from("pilot_workspace_admissions")
      .insert((orgs ?? []).map((org) => ({ org_id: org.id })));
    if (admissionError) throw admissionError;

    const { error } = await service.rpc("assert_pilot_workspace_capacity");
    expect(error?.message).toMatch(/capacity exceeded.*11.*maximum 10/i);
  } finally {
    await removeAdmittedWorkspaces();
  }
});
