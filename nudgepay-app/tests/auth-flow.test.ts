import { expect, test } from "vitest";
import { signupOutcome, intuitDisconnectPlan } from "../app/lib/auth-flow.server";
import { humanAuthError } from "../app/lib/auth-errors";

test("signupOutcome redirects to onboarding when a session is returned with no returnTo", () => {
  expect(signupOutcome(true, "")).toEqual({ redirectTo: "/onboarding" });
});

test("signupOutcome redirects to returnTo when a session is returned with a returnTo", () => {
  expect(signupOutcome(true, "/accept/xyz")).toEqual({ redirectTo: "/accept/xyz" });
});

test("signupOutcome asks the user to confirm email when no session is returned (no returnTo)", () => {
  expect(signupOutcome(false, "")).toEqual({ confirmEmail: true, returnTo: "" });
});

test("signupOutcome preserves returnTo in confirm-email outcome", () => {
  expect(signupOutcome(false, "/accept/xyz")).toEqual({ confirmEmail: true, returnTo: "/accept/xyz" });
});

test("intuitDisconnectPlan never clears tokens from the unsigned GET landing (owner)", () => {
  expect(intuitDisconnectPlan({ org_id: "org-1", role: "owner" }))
    .toEqual({ clear: false, orgId: null });
});

test("intuitDisconnectPlan never clears tokens from the unsigned GET landing (member)", () => {
  expect(intuitDisconnectPlan({ org_id: "org-2", role: "member" }))
    .toEqual({ clear: false, orgId: null });
});

test("intuitDisconnectPlan clears nothing when there is no session/org", () => {
  expect(intuitDisconnectPlan(null)).toEqual({ clear: false, orgId: null });
});

test("humanAuthError maps invalid login credentials to human copy", () => {
  expect(humanAuthError("Invalid login credentials")).toBe(
    "That email and password don't match. Try again or create an account."
  );
});

test("humanAuthError maps user already registered to human copy", () => {
  expect(humanAuthError("User already registered")).toBe(
    "An account with this email already exists — log in instead."
  );
});

test("humanAuthError maps email not confirmed to actionable copy", () => {
  expect(humanAuthError("Email not confirmed")).toBe(
    "Please check your inbox and confirm your email before signing in."
  );
});

test("humanAuthError maps additional GoTrue strings to human copy", () => {
  expect(humanAuthError("Password should be at least 6 characters.")).toBe(
    "That password is too short. Choose a longer one.",
  );
  expect(humanAuthError("New password should be different from the old password.")).toBe(
    "Choose a different password from the one you already use.",
  );
  expect(humanAuthError("Too many requests")).toBe(
    "Too many attempts. Wait a few minutes and try again.",
  );
  expect(humanAuthError("Signups not allowed for this instance")).toBe(
    "New accounts aren't being accepted right now.",
  );
  expect(
    humanAuthError(
      "Confirmation link accepted. Please proceed to confirm link sent to the other email",
    ),
  ).toBe("Check both inboxes and confirm the email change before continuing.");
  expect(
    humanAuthError(
      "Password is known to be weak and easy to guess, please choose a different one.",
    ),
  ).toBe("That password is too easy to guess. Choose a stronger one.");
  expect(humanAuthError("over_request_rate_limit")).toBe(
    "Too many attempts. Wait a few minutes and try again.",
  );
  expect(humanAuthError("Token has expired or is invalid")).toBe(
    "This link is invalid or has expired. Request a new one.",
  );
  expect(humanAuthError("Invalid token")).toBe(
    "This link is invalid or has expired. Request a new one.",
  );
  expect(humanAuthError("User is banned")).toBe(
    "This account can't sign in right now. Contact support if you need help.",
  );
});

test("humanAuthError falls back to a generic message for unmapped errors", () => {
  expect(humanAuthError("Some obscure Supabase error")).toBe(
    "Something went wrong. Please try again."
  );
});
