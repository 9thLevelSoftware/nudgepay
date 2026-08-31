// Pure workspace-deletion gates. No I/O. Owner must type the workspace name.

import { orgNameMatches } from "./qbo-disconnect";

export type WorkspaceDeletionDecision =
  | { ok: true }
  | { ok: false; error: "forbidden" | "confirm" };

export function workspaceDeletionDecision(input: {
  isOwner: boolean;
  typedName: unknown;
  orgName: string;
}): WorkspaceDeletionDecision {
  if (!input.isOwner) return { ok: false, error: "forbidden" };
  if (!orgNameMatches(input.typedName, input.orgName)) {
    return { ok: false, error: "confirm" };
  }
  return { ok: true };
}
