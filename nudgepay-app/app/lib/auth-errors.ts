// Maps raw GoTrue/Supabase auth error strings to human copy. Unknown messages
// stay generic so we never leak internals (stack traces, schema, error codes).
// This is a copy map only — it does not change timing or distinguish valid vs
// invalid emails. Prefix matches cover GoTrue strings with a dynamic suffix
// (password min length, resend cooldown).

export const AUTH_GENERIC_ERROR = "Something went wrong. Please try again.";

const TOO_MANY = "Too many attempts. Wait a few minutes and try again.";
const SIGNUP_OFF = "New accounts aren't being accepted right now.";
const TOKEN_BAD = "This link is invalid or has expired. Request a new one.";
const TOO_SHORT = "That password is too short. Choose a longer one.";

export const AUTH_ERROR_MAP: Record<string, string> = {
  "Invalid login credentials":
    "That email and password don't match. Try again or create an account.",
  "User already registered":
    "An account with this email already exists — log in instead.",
  "Email not confirmed":
    "Please check your inbox and confirm your email before signing in.",

  "Password should be at least 6 characters": TOO_SHORT,
  "Password should be at least 6 characters.": TOO_SHORT,
  "Password should be at least 8 characters": TOO_SHORT,
  "Password should be at least 8 characters.": TOO_SHORT,
  "New password should be different from the old password.":
    "Choose a different password from the one you already use.",
  "Password is known to be weak and easy to guess, please choose a different one.":
    "That password is too easy to guess. Choose a stronger one.",
  "Signup requires a valid password": "Enter a password to create your account.",
  "Password cannot be longer than 72 characters":
    "That password is too long. Use 72 characters or fewer.",
  "Password update requires reauthentication":
    "Sign in again to change your password.",

  "Too many requests": TOO_MANY,
  "email rate limit exceeded": TOO_MANY,
  "Email rate limit exceeded": TOO_MANY,
  over_request_rate_limit: TOO_MANY,
  over_email_send_rate_limit: TOO_MANY,

  "Signups not allowed for this instance": SIGNUP_OFF,
  "Email signups are disabled": SIGNUP_OFF,
  "Email logins are disabled": "Email sign-in isn't available right now.",

  "Confirmation link accepted. Please proceed to confirm link sent to the other email":
    "Check both inboxes and confirm the email change before continuing.",

  "Token has expired or is invalid": TOKEN_BAD,
  "Email link is invalid or has expired": TOKEN_BAD,
  "Invalid token": TOKEN_BAD,

  "User is banned":
    "This account can't sign in right now. Contact support if you need help.",
};

const AUTH_ERROR_PREFIXES: ReadonlyArray<readonly [string, string]> = [
  ["Password should be at least", TOO_SHORT],
  ["For security purposes, you can only request this after", TOO_MANY],
];

export function humanAuthError(message: string): string {
  const mapped = AUTH_ERROR_MAP[message];
  if (mapped) return mapped;
  for (const [prefix, copy] of AUTH_ERROR_PREFIXES) {
    if (message.startsWith(prefix)) return copy;
  }
  return AUTH_GENERIC_ERROR;
}
