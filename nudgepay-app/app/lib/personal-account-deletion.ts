// Pure personal-account (Auth user) erasure gates. No I/O — the route calls
// service-role deleteUser only after this helper accepts the confirm token
// and the user is not the last owner of a remaining workspace.

export const PERSONAL_DELETE_TOKEN = "DELETE";

export type PersonalAccountDeletionDecision =
  | { ok: true }
  | { ok: false; error: "confirm" | "last-owner" };

/**
 * True when the typed confirm value is the current email (trim, case-
 * insensitive) or the exact token `DELETE`. LEAVE is leave-workspace only.
 */
export function personalAccountConfirmMatches(typed: unknown, currentEmail: string): boolean {
  if (typeof typed !== "string") return false;
  const token = typed.trim();
  if (!token) return false;
  if (token === PERSONAL_DELETE_TOKEN) return true;
  const email = currentEmail.trim().toLowerCase();
  if (!email) return false;
  return token.toLowerCase() === email;
}

export function personalAccountDeletionDecision(input: {
  confirm: unknown;
  currentEmail: string;
  isLastOwner: boolean;
}): PersonalAccountDeletionDecision {
  if (!personalAccountConfirmMatches(input.confirm, input.currentEmail)) {
    return { ok: false, error: "confirm" };
  }
  if (input.isLastOwner) return { ok: false, error: "last-owner" };
  return { ok: true };
}
