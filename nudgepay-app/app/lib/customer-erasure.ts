// Pure customer PII-erasure gates. No I/O — the route calls the service-role
// RPC only after this helper accepts the typed name and an owner.

import { orgNameMatches } from "./qbo-disconnect";

export const ERASED_CUSTOMER_NAME = "Erased customer";

export type CustomerErasureDecision =
  | { ok: true }
  | { ok: false; error: "forbidden" | "confirm" | "already" };

export function customerErasureDecision(input: {
  isOwner: boolean;
  alreadyErased: boolean;
  typedName: unknown;
  customerName: string;
}): CustomerErasureDecision {
  if (!input.isOwner) return { ok: false, error: "forbidden" };
  if (input.alreadyErased) return { ok: false, error: "already" };
  if (!orgNameMatches(input.typedName, input.customerName)) {
    return { ok: false, error: "confirm" };
  }
  return { ok: true };
}
