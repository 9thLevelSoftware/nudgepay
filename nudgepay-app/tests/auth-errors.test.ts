import { expect, test } from "vitest";
import {
  AUTH_ERROR_MAP,
  AUTH_GENERIC_ERROR,
  humanAuthError,
} from "../app/lib/auth-errors";

const TOO_MANY = "Too many attempts. Wait a few minutes and try again.";
const SIGNUP_OFF = "New accounts aren't being accepted right now.";
const TOKEN_BAD = "This link is invalid or has expired. Request a new one.";
const TOO_SHORT = "That password is too short. Choose a longer one.";

const CASES: Array<[string, string]> = [
  [
    "Invalid login credentials",
    "That email and password don't match. Try again or create an account.",
  ],
  [
    "User already registered",
    "An account with this email already exists — log in instead.",
  ],
  [
    "Email not confirmed",
    "Please check your inbox and confirm your email before signing in.",
  ],
  ["Password should be at least 6 characters", TOO_SHORT],
  ["Password should be at least 6 characters.", TOO_SHORT],
  ["Password should be at least 8 characters", TOO_SHORT],
  ["Password should be at least 8 characters.", TOO_SHORT],
  [
    "New password should be different from the old password.",
    "Choose a different password from the one you already use.",
  ],
  [
    "Password is known to be weak and easy to guess, please choose a different one.",
    "That password is too easy to guess. Choose a stronger one.",
  ],
  ["Signup requires a valid password", "Enter a password to create your account."],
  [
    "Password cannot be longer than 72 characters",
    "That password is too long. Use 72 characters or fewer.",
  ],
  [
    "Password update requires reauthentication",
    "Sign in again to change your password.",
  ],
  ["Too many requests", TOO_MANY],
  ["email rate limit exceeded", TOO_MANY],
  ["Email rate limit exceeded", TOO_MANY],
  ["over_request_rate_limit", TOO_MANY],
  ["over_email_send_rate_limit", TOO_MANY],
  ["Signups not allowed for this instance", SIGNUP_OFF],
  ["Email signups are disabled", SIGNUP_OFF],
  ["Email logins are disabled", "Email sign-in isn't available right now."],
  [
    "Confirmation link accepted. Please proceed to confirm link sent to the other email",
    "Check both inboxes and confirm the email change before continuing.",
  ],
  ["Token has expired or is invalid", TOKEN_BAD],
  ["Email link is invalid or has expired", TOKEN_BAD],
  ["Invalid token", TOKEN_BAD],
  [
    "User is banned",
    "This account can't sign in right now. Contact support if you need help.",
  ],
];

test("humanAuthError maps invalid login credentials to human copy", () => {
  expect(humanAuthError("Invalid login credentials")).toBe(
    "That email and password don't match. Try again or create an account.",
  );
});

test("humanAuthError maps user already registered to human copy", () => {
  expect(humanAuthError("User already registered")).toBe(
    "An account with this email already exists — log in instead.",
  );
});

test("humanAuthError maps email not confirmed to actionable copy", () => {
  expect(humanAuthError("Email not confirmed")).toBe(
    "Please check your inbox and confirm your email before signing in.",
  );
});

test("humanAuthError maps every AUTH_ERROR_MAP key to its copy", () => {
  expect(new Set(CASES.map(([raw]) => raw))).toEqual(new Set(Object.keys(AUTH_ERROR_MAP)));
  for (const [raw, copy] of CASES) {
    expect(humanAuthError(raw), raw).toBe(copy);
  }
});

test("humanAuthError maps password-too-short GoTrue strings", () => {
  expect(humanAuthError("Password should be at least 6 characters")).toBe(TOO_SHORT);
  expect(humanAuthError("Password should be at least 6 characters.")).toBe(TOO_SHORT);
  expect(humanAuthError("Password should be at least 8 characters")).toBe(TOO_SHORT);
  expect(humanAuthError("Password should be at least 8 characters.")).toBe(TOO_SHORT);
});

test("humanAuthError maps same-password GoTrue string", () => {
  expect(humanAuthError("New password should be different from the old password.")).toBe(
    "Choose a different password from the one you already use.",
  );
});

test("humanAuthError maps weak-password GoTrue string", () => {
  expect(
    humanAuthError(
      "Password is known to be weak and easy to guess, please choose a different one.",
    ),
  ).toBe("That password is too easy to guess. Choose a stronger one.");
});

test("humanAuthError maps rate-limit and over-request GoTrue strings", () => {
  expect(humanAuthError("Too many requests")).toBe(TOO_MANY);
  expect(humanAuthError("email rate limit exceeded")).toBe(TOO_MANY);
  expect(humanAuthError("Email rate limit exceeded")).toBe(TOO_MANY);
  expect(humanAuthError("over_request_rate_limit")).toBe(TOO_MANY);
  expect(humanAuthError("over_email_send_rate_limit")).toBe(TOO_MANY);
});

test("humanAuthError maps signup-disabled GoTrue strings", () => {
  expect(humanAuthError("Signups not allowed for this instance")).toBe(SIGNUP_OFF);
  expect(humanAuthError("Email signups are disabled")).toBe(SIGNUP_OFF);
});

test("humanAuthError maps email-change confirmation copy", () => {
  expect(
    humanAuthError(
      "Confirmation link accepted. Please proceed to confirm link sent to the other email",
    ),
  ).toBe("Check both inboxes and confirm the email change before continuing.");
});

test("humanAuthError maps expired and invalid token GoTrue strings", () => {
  expect(humanAuthError("Token has expired or is invalid")).toBe(TOKEN_BAD);
  expect(humanAuthError("Email link is invalid or has expired")).toBe(TOKEN_BAD);
  expect(humanAuthError("Invalid token")).toBe(TOKEN_BAD);
});

test("humanAuthError maps user-banned GoTrue string", () => {
  expect(humanAuthError("User is banned")).toBe(
    "This account can't sign in right now. Contact support if you need help.",
  );
});

test("humanAuthError maps signup-requires-password GoTrue string", () => {
  expect(humanAuthError("Signup requires a valid password")).toBe(
    "Enter a password to create your account.",
  );
});

test("humanAuthError maps password-too-long GoTrue string", () => {
  expect(humanAuthError("Password cannot be longer than 72 characters")).toBe(
    "That password is too long. Use 72 characters or fewer.",
  );
});

test("humanAuthError maps password reauthentication GoTrue string", () => {
  expect(humanAuthError("Password update requires reauthentication")).toBe(
    "Sign in again to change your password.",
  );
});

test("humanAuthError maps email-logins-disabled GoTrue string", () => {
  expect(humanAuthError("Email logins are disabled")).toBe(
    "Email sign-in isn't available right now.",
  );
});

test("humanAuthError maps dynamic password-length prefixes", () => {
  expect(humanAuthError("Password should be at least 12 characters.")).toBe(TOO_SHORT);
});

test("humanAuthError maps dynamic resend-cooldown prefixes", () => {
  expect(humanAuthError("For security purposes, you can only request this after 42 seconds.")).toBe(
    TOO_MANY,
  );
});

test("humanAuthError falls back to a generic message for unmapped errors", () => {
  expect(humanAuthError("Some obscure Supabase error")).toBe(AUTH_GENERIC_ERROR);
  expect(humanAuthError("")).toBe(AUTH_GENERIC_ERROR);
});

test("humanAuthError does not leak GoTrue internals or enumerate unknown emails", () => {
  expect(humanAuthError("Database error querying schema")).toBe(AUTH_GENERIC_ERROR);
  expect(humanAuthError("User not found")).toBe(AUTH_GENERIC_ERROR);
  expect(humanAuthError("User with this email not found")).toBe(AUTH_GENERIC_ERROR);
  expect(humanAuthError("invalid claim: missing sub claim")).toBe(AUTH_GENERIC_ERROR);
  expect(humanAuthError("Unexpected failure, please check server logs for more information")).toBe(
    AUTH_GENERIC_ERROR,
  );
});
