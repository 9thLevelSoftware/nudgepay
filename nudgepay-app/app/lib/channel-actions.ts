// Pure module — no I/O, no node:*, no .server suffix. Presentation state for the
// per-customer Call action: hidden (no phone), blocked (do_not_call), or live.
// Keeps the DetailPanel JSX trivial and the gating unit-testable.

import { channelBlocked, type CommPrefs } from "./comm-prefs";

export type CallAction =
  | { kind: "hidden" }
  | { kind: "blocked"; reason: string }
  | { kind: "live" };

export function resolveCallAction(prefs: CommPrefs, phone: string | null): CallAction {
  if (!phone) return { kind: "hidden" };
  if (channelBlocked(prefs, "call")) return { kind: "blocked", reason: "Customer asked not to be called" };
  return { kind: "live" };
}
