// app/components/AccountsMetrics.tsx
import type { AccountMetrics } from "../lib/accounts";
import { formatUSD } from "../lib/format";
import { MetricTile } from "./MetricTile";

export function AccountsMetrics({ metrics, truncated = false }: { metrics: AccountMetrics; truncated?: boolean }) {
  const n = (v: number) => (truncated ? "—" : String(v));
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-6 sm:grid-cols-4" aria-label="Accounts summary metrics">
      <MetricTile label="Customers in collections" value={n(metrics.totalCustomers)} sub="in this workspace" accent="ink" />
      <MetricTile label="Open A/R" value={truncated ? "—" : formatUSD(metrics.totalOpenAR)} sub="across all accounts" accent="copper" />
      <MetricTile label="Unassigned" value={n(metrics.unassignedCount)} sub="no owner" accent="neutral" />
      <MetricTile label="Paid up" value={n(metrics.paidUpCount)} sub="zero balance" accent="cool" />
    </div>
  );
}
