// Pure leave-workspace gates. No I/O — the route disconnects QBO, removes the
// selected membership, and signs out only after this helper accepts the confirm token
// and the user is not the last owner. This is not account or workspace erasure.

export const LEAVE_CONFIRM_TOKEN = "LEAVE";
/** Previous Settings token; still accepted so older privacy copy keeps working. */
export const DELETE_CONFIRM_TOKEN = "DELETE";

export type AccountDeletionDecision =
  | { ok: true }
  | { ok: false; error: "confirm" | "last-owner" };

/** Last owner of a workspace cannot leave. */
export function isLastOwnerMember(isOwner: boolean, ownerCount: number): boolean {
  return isOwner && ownerCount < 2;
}

/**
 * True when the typed confirm value is the current email (trim, case-
 * insensitive) or the exact token `LEAVE` / `DELETE`. Empty / non-string never matches.
 */
export function deletionConfirmMatches(typed: unknown, currentEmail: string): boolean {
  if (typeof typed !== "string") return false;
  const token = typed.trim();
  if (!token) return false;
  if (token === LEAVE_CONFIRM_TOKEN || token === DELETE_CONFIRM_TOKEN) return true;
  const email = currentEmail.trim().toLowerCase();
  if (!email) return false;
  return token.toLowerCase() === email;
}

export function accountDeletionDecision(input: {
  confirm: unknown;
  currentEmail: string;
  isLastOwner: boolean;
}): AccountDeletionDecision {
  if (!deletionConfirmMatches(input.confirm, input.currentEmail)) {
    return { ok: false, error: "confirm" };
  }
  if (input.isLastOwner) return { ok: false, error: "last-owner" };
  return { ok: true };
}

/** Revoke org QBO tokens only when this user is the last remaining member. */
export function shouldDisconnectQboOnAccountDelete(
  qboConnected: boolean,
  otherMemberCount: number,
): boolean {
  return qboConnected && otherMemberCount === 0;
}
