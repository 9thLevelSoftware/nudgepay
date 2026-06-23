import { expect, test } from "vitest";
import { signupOutcome, intuitDisconnectPlan } from "../app/lib/auth-flow.server";

test("signupOutcome redirects to onboarding when a session is returned (confirmation off)", () => {
  expect(signupOutcome(true)).toEqual({ redirectTo: "/onboarding" });
});

test("signupOutcome asks the user to confirm email when no session is returned (confirmation on)", () => {
  expect(signupOutcome(false)).toEqual({ confirmEmail: true });
});

test("intuitDisconnectPlan clears tokens for any authenticated org (owner)", () => {
  expect(intuitDisconnectPlan({ org_id: "org-1", role: "owner" }))
    .toEqual({ clear: true, orgId: "org-1" });
});

test("intuitDisconnectPlan clears tokens for a non-owner member too (Intuit already revoked)", () => {
  expect(intuitDisconnectPlan({ org_id: "org-2", role: "member" }))
    .toEqual({ clear: true, orgId: "org-2" });
});

test("intuitDisconnectPlan clears nothing when there is no session/org", () => {
  expect(intuitDisconnectPlan(null)).toEqual({ clear: false, orgId: null });
});
