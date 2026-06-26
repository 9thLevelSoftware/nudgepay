// Shared display-formatting constants and helpers. No I/O, no node:*, no
// .server suffix — safe in both the client bundle and the server.

import { EXCEPTION_STATES, EXCEPTION_POLICY } from "./exceptions";

export const STATUS_LABEL: Record<string, string> = {
  new: "New",
  working: "Working",
  promised: "Promised",
  waiting: "Waiting",
  on_hold: "On hold",
  resolved: "Resolved",
};

// Derived from the single source of truth so the label set never drifts.
export const EXCEPTION_REASON_LABEL: Record<string, string> = Object.fromEntries(
  EXCEPTION_STATES.map((s) => [s, EXCEPTION_POLICY[s].label]),
);

const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
});

export function formatUSD(amount: number): string {
  return usdFormatter.format(amount);
}
