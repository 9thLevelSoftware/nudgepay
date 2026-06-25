// Shared display-formatting constants and helpers. No I/O, no node:*, no
// .server suffix — safe in both the client bundle and the server.

export const STATUS_LABEL: Record<string, string> = {
  new: "New",
  working: "Working",
  promised: "Promised",
  waiting: "Waiting",
  on_hold: "On hold",
  resolved: "Resolved",
};

export const EXCEPTION_REASON_LABEL: Record<string, string> = {
  disputed: "Disputed",
  payment_plan: "Payment plan",
  do_not_contact: "Do not contact",
  other: "Other",
};

const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
});

export function formatUSD(amount: number): string {
  return usdFormatter.format(amount);
}
