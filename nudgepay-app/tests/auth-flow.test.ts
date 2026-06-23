import { expect, test } from "vitest";
import { signupOutcome } from "../app/lib/auth-flow.server";

test("signupOutcome redirects to onboarding when a session is returned (confirmation off)", () => {
  expect(signupOutcome(true)).toEqual({ redirectTo: "/onboarding" });
});

test("signupOutcome asks the user to confirm email when no session is returned (confirmation on)", () => {
  expect(signupOutcome(false)).toEqual({ confirmEmail: true });
});
