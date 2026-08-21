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

// Intuit's Disconnect URL is a browser GET landing. It is not signed by Intuit
// and carries no one-time state that proves the caller intended to mutate this
// workspace, so it must never clear local tokens. The in-app POST disconnect is
// the owner-gated mutation path.
export function intuitDisconnectPlan(
  org: { org_id: string; role: string } | null,
): { clear: boolean; orgId: string | null } {
  void org;
  return { clear: false, orgId: null };
}

export { humanAuthError } from "./auth-errors";
