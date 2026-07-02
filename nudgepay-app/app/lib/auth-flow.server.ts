// Pure decision helpers for auth routes. No I/O — keeps route files thin and
// these branches unit-testable without cookie/session infrastructure.

export type SignupOutcome = { redirectTo: string } | { confirmEmail: true; returnTo: string };

// Supabase signUp returns a session only when email confirmation is OFF
// (local dev). In production (confirmation ON) session is null and no auth
// cookie is set, so redirecting to an auth-gated page would bounce to /login.
// `returnTo` is threaded through so login↔signup pages preserve the invite
// destination. When a session exists (local dev) we redirect straight there;
// when confirmation is required, we stash it so the "sign in" link carries it.
export function signupOutcome(hasSession: boolean, returnTo: string): SignupOutcome {
  return hasSession
    ? { redirectTo: returnTo || "/onboarding" }
    : { confirmEmail: true, returnTo };
}

// Intuit's Disconnect URL is hit by Intuit's browser AFTER Intuit has already
// revoked the connection on their side. Any authenticated session that resolves
// to an org should clear that org's now-stale tokens (reflecting state Intuit
// already enforced); without a session we can't identify an org, so clear
// nothing and just render a confirmation.
export function intuitDisconnectPlan(
  org: { org_id: string; role: string } | null,
): { clear: boolean; orgId: string | null } {
  if (org) return { clear: true, orgId: org.org_id };
  return { clear: false, orgId: null };
}

// Maps raw Supabase auth error strings to human-readable copy. Deliberately
// does NOT change error/success timing or enumerate valid emails differently
// from invalid ones — that's an auth-hardening concern out of scope here;
// this is purely a copy fix so users understand what went wrong.
const AUTH_ERROR_MAP: Record<string, string> = {
  "Invalid login credentials": "That email and password don't match. Try again or create an account.",
  "User already registered": "An account with this email already exists — log in instead.",
  "Email not confirmed": "Please check your inbox and confirm your email before signing in.",
};

export function humanAuthError(message: string): string {
  return AUTH_ERROR_MAP[message] ?? "Something went wrong. Please try again.";
}
