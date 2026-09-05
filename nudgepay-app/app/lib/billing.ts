// Agency SaaS billing — the workspace owner pays NudgePay. Pure, no I/O.
// This is not debtor payments. NudgePay does not charge customers.

export const BILLING_STATUSES = [
  "none",
  "incomplete",
  "trialing",
  "active",
  "past_due",
  "canceled",
  "unpaid",
  "paused",
  "incomplete_expired",
] as const;
export type BillingStatus = (typeof BILLING_STATUSES)[number];

export type OrgBilling = {
  status: BillingStatus;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  currentPeriodEnd: string | null;
};

export function parseBillingStatus(raw: string | null | undefined): BillingStatus {
  if (raw && (BILLING_STATUSES as readonly string[]).includes(raw)) return raw as BillingStatus;
  return "none";
}

export function billingIsCurrent(status: BillingStatus): boolean {
  return status === "active" || status === "trialing";
}

export function billingCanManage(status: BillingStatus): boolean {
  return status !== "none" && status !== "canceled" && status !== "incomplete_expired";
}

export function billingStatusLabel(status: BillingStatus): string {
  switch (status) {
    case "active":
      return "Active";
    case "trialing":
      return "Trial";
    case "past_due":
      return "Past due";
    case "unpaid":
      return "Unpaid";
    case "paused":
      return "Paused";
    case "incomplete_expired":
      return "Incomplete (expired)";
    case "canceled":
      return "Canceled";
    case "incomplete":
      return "Incomplete";
    default:
      return "Not subscribed";
  }
}

export const BILLING_COPY = {
  heading: "NudgePay billing",
  body: "This is your agency's NudgePay subscription. NudgePay does not charge your customers or process invoice payments.",
  unconfigured: "Billing is not configured on this server yet.",
  members: "Only the workspace owner can manage billing.",
} as const;

export function mapStripeSubscriptionStatus(raw: string | null | undefined): BillingStatus {
  return parseBillingStatus(raw);
}
