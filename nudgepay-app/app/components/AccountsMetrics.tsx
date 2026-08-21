// app/components/AccountsMetrics.tsx
import type { AccountMetrics } from "../lib/accounts";
import { formatUSD } from "../lib/format";
import { MetricTile } from "./MetricTile";

export function AccountsMetrics({ metrics }: { metrics: AccountMetrics }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-6 sm:grid-cols-4" aria-label="Accounts summary metrics">
      <MetricTile label="Customers in collections" value={String(metrics.totalCustomers)} sub="in this workspace" accent="ink" />
      <MetricTile label="Open A/R" value={formatUSD(metrics.totalOpenAR)} sub="across all accounts" accent="copper" />
      <MetricTile label="Unassigned" value={String(metrics.unassignedCount)} sub="no owner" accent="neutral" />
      <MetricTile label="Paid up" value={String(metrics.paidUpCount)} sub="zero balance" accent="cool" />
    </div>
  );
}
