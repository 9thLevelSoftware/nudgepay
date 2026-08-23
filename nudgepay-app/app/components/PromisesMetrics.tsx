// app/components/PromisesMetrics.tsx
import type { PromiseMetrics } from "../lib/promise-ledger";
import { formatUSD } from "../lib/format";
import { MetricTile } from "./MetricTile";

export function PromisesMetrics({ metrics, truncated = false }: { metrics: PromiseMetrics; truncated?: boolean }) {
  const keptRateLabel = truncated || metrics.keptRate == null ? "—" : `${Math.round(metrics.keptRate * 100)}%`;
  const n = (v: number) => (truncated ? "—" : String(v));
  const usd = (v: number) => (truncated ? "—" : formatUSD(v));
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-6 sm:grid-cols-4" aria-label="Promises summary metrics">
      <MetricTile href="?tab=active"   label="Active"     value={n(metrics.activeCount)}   sub={`${usd(metrics.activeAmount)} promised`}   accent="copper" />
      <MetricTile href="?tab=due-soon" label="Due soon"   value={n(metrics.dueSoonCount)}  sub={`${usd(metrics.dueSoonAmount)} promised`}  accent="ink" />
      <MetricTile href="?tab=broken"   label="Broken"     value={n(metrics.brokenCount)}   sub={`${usd(metrics.brokenOutstanding)} outstanding`} accent="hot" />
      <MetricTile href="?tab=kept"     label="Kept rate"  value={keptRateLabel}            sub="of resolved promises"                          accent="cool" />
    </div>
  );
}
