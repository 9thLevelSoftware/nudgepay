// Single-tenant membership rules. Until an org switcher exists, a user may
// belong to at most one workspace. Pure — no I/O — so create/accept and unit
// tests share one decision.

export const ALREADY_IN_WORKSPACE = "already in a workspace";

export class AlreadyInWorkspaceError extends Error {
  readonly code = "already_in_workspace" as const;
  constructor() {
    super(ALREADY_IN_WORKSPACE);
    this.name = "AlreadyInWorkspaceError";
  }
}

export type JoinDecision = "join" | "already_member" | "already_in_workspace";

// `targetOrgId` is the invite's org. Omit it when creating a new org — any
// existing membership is a reject.
export function canJoinOrg(
  existingOrgId: string | null | undefined,
  targetOrgId?: string | null,
): JoinDecision {
  if (!existingOrgId) return "join";
  if (targetOrgId && existingOrgId === targetOrgId) return "already_member";
  return "already_in_workspace";
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
