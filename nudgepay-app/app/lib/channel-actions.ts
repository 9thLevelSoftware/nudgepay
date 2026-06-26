// Pure module — no I/O, no node:*, no .server suffix. Presentation state for the
// per-customer Call action: hidden (no phone), blocked (case do-not-contact/legal
// hold OR per-customer do_not_call), or live. Keeps the DetailPanel JSX trivial
// and the gating unit-testable. The contact-block gate mirrors the SMS path so a
// do-not-contact / legal case can never expose a live Call.

import { channelBlocked, type CommPrefs } from "./comm-prefs";

export type CallAction =
  | { kind: "hidden" }
  | { kind: "blocked"; reason: string }
  | { kind: "live" };

export function resolveCallAction(
  prefs: CommPrefs,
  phone: string | null,
  contactBlocked = false,
): CallAction {
  if (!phone) return { kind: "hidden" };
  if (contactBlocked) return { kind: "blocked", reason: "Case is marked do-not-contact / legal" };
  if (channelBlocked(prefs, "call")) return { kind: "blocked", reason: "Customer asked not to be called" };
  return { kind: "live" };
}
