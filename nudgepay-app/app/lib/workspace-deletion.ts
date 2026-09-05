// Pure workspace-deletion gates. No I/O. Owner must type the workspace name.

import { orgNameMatches } from "./qbo-disconnect";

export type WorkspaceDeletionDecision =
  | { ok: true }
  | { ok: false; error: "forbidden" | "confirm" };

export type WorkspaceDeletionProviderError = "billing" | "pending" | "workspace";
export type WorkspaceDeletionQboPlan = "none" | "disconnect" | "blocked";

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

export function billingBlocksWorkspaceDeletion(row: {
  status?: string | null;
  stripe_subscription_id?: string | null;
} | null): boolean {
  if (!row) return false;
  return ["incomplete", "trialing", "active", "past_due", "unpaid", "paused"].includes(row.status ?? "")
    || (
      Boolean(row.stripe_subscription_id)
      && !["canceled", "incomplete_expired"].includes(row.status ?? "")
    );
}

/** Map the database's fail-closed conflict to an actionable Settings error. */
export function workspaceDeletionRpcError(error: {
  code?: string | null;
  message?: string | null;
}): WorkspaceDeletionProviderError {
  if (error.code !== "PT409") return "workspace";
  if (/billing subscription/i.test(error.message ?? "")) return "billing";
  if (/pending provider work/i.test(error.message ?? "")) return "pending";
  return "workspace";
}

export function workspaceDeletionQboPlan(input: {
  hasAccessToken: boolean;
  hasRefreshToken: boolean;
  configured: boolean;
}): WorkspaceDeletionQboPlan {
  if (!input.hasAccessToken && !input.hasRefreshToken) return "none";
  if (!input.configured || !input.hasRefreshToken) return "blocked";
  return "disconnect";
}
