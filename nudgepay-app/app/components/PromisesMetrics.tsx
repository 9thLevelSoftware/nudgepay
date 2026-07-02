// app/components/PromisesMetrics.tsx
import type { PromiseMetrics } from "../lib/promise-ledger";
import { formatUSD } from "../lib/format";
import { MetricTile } from "./MetricTile";

export function PromisesMetrics({ metrics }: { metrics: PromiseMetrics }) {
  const keptRateLabel = metrics.keptRate == null ? "—" : `${Math.round(metrics.keptRate * 100)}%`;
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-6 sm:grid-cols-4" aria-label="Promises summary metrics">
      <MetricTile href="?tab=active"   label="Active"     value={String(metrics.activeCount)}   sub={`${formatUSD(metrics.activeAmount)} promised`}   accent="copper" />
      <MetricTile href="?tab=due-soon" label="Due soon"   value={String(metrics.dueSoonCount)}  sub={`${formatUSD(metrics.dueSoonAmount)} promised`}  accent="ink" />
      <MetricTile href="?tab=broken"   label="Broken"     value={String(metrics.brokenCount)}   sub={`${formatUSD(metrics.brokenOutstanding)} outstanding`} accent="hot" />
      <MetricTile href="?tab=kept"     label="Kept rate"  value={keptRateLabel}                 sub="of resolved promises"                          accent="cool" />
    </div>
  );
}
