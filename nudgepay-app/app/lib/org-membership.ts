// Membership join rules. A user may belong to many workspaces; (org_id, user_id)
// stays unique. Pure — no I/O — so create/accept and unit tests share one decision.

export const ALREADY_IN_WORKSPACE = "already in a workspace";

export class AlreadyInWorkspaceError extends Error {
  readonly code = "already_in_workspace" as const;
  constructor() {
    super(ALREADY_IN_WORKSPACE);
    this.name = "AlreadyInWorkspaceError";
  }
}

export type JoinDecision = "join" | "already_member" | "already_in_workspace";

// `existingOrgIds` are orgs the user already belongs to. `targetOrgId` is the
// invite's org; omit it when creating a new workspace.
export function canJoinOrg(
  existingOrgIds: readonly string[] | string | null | undefined,
  targetOrgId?: string | null,
): JoinDecision {
  const ids = Array.isArray(existingOrgIds)
    ? existingOrgIds
    : existingOrgIds
      ? [existingOrgIds]
      : [];
  if (targetOrgId && ids.includes(targetOrgId)) return "already_member";
  return "join";
}

const INVITE_ERROR_COPY: Record<string, string> = {
  "Invite not found": "This invite link is invalid or has been removed.",
  "Invite email missing": "This invite was sent to a different email address. Sign in with the invited account to accept it.",
  "This invite was sent to a different email address": "This invite was sent to a different email address. Sign in with the invited account to accept it.",
  "Invite already accepted": "This invite has already been used.",
  "Invite expired": "Ask the workspace owner for a new invite link.",
  [ALREADY_IN_WORKSPACE]: ALREADY_IN_WORKSPACE,
};

export function isAlreadyInWorkspaceError(err: unknown): err is AlreadyInWorkspaceError {
  return (
    err instanceof AlreadyInWorkspaceError ||
    (err instanceof Error &&
      ((err as { code?: string }).code === "already_in_workspace" ||
        err.message === ALREADY_IN_WORKSPACE))
  );
}

export function humanInviteError(err: unknown): string {
  if (isAlreadyInWorkspaceError(err)) return ALREADY_IN_WORKSPACE;
  if (err instanceof Error && INVITE_ERROR_COPY[err.message]) {
    return INVITE_ERROR_COPY[err.message];
  }
  return "Could not accept that invite. Try again or ask for a new link.";
}
