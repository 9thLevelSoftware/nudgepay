// Pure decision helpers for auth routes. No I/O — keeps route files thin and
// these branches unit-testable without cookie/session infrastructure.

export type SignupOutcome = { redirectTo: string } | { confirmEmail: true };

// Supabase signUp returns a session only when email confirmation is OFF
// (local dev). In production (confirmation ON) session is null and no auth
// cookie is set, so redirecting to an auth-gated page would bounce to /login.
export function signupOutcome(hasSession: boolean): SignupOutcome {
  return hasSession ? { redirectTo: "/onboarding" } : { confirmEmail: true };
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
