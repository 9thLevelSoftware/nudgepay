// app/components/PromisesMetrics.tsx
import { Link } from "react-router";
import type { PromiseMetrics } from "../lib/promise-ledger";
import { formatUSD } from "../lib/format";

type Accent = "ink" | "copper" | "hot" | "cool";
const ACCENT_TEXT: Record<Accent, string> = {
  ink: "text-text", copper: "text-copper", hot: "text-hot", cool: "text-cool",
};
const ACCENT_DOT: Record<Accent, string> = {
  ink: "bg-ink", copper: "bg-copper", hot: "bg-hot", cool: "bg-cool",
};

function Tile({ to, label, value, sub, accent }: { to: string; label: string; value: string; sub: string; accent: Accent }) {
  return (
    <Link
      to={to}
      className="relative flex flex-col p-4 rounded-tile overflow-hidden min-w-0 bg-paper border border-border hover:border-copper/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
    >
      <span aria-hidden="true" className={`absolute top-0 inset-x-0 h-0.5 ${ACCENT_DOT[accent]}`} />
      <span className="flex items-center gap-1.5 mb-2">
        <span aria-hidden="true" className={`w-2 h-2 rounded-full shrink-0 ${ACCENT_DOT[accent]}`} />
        <span className="font-mono text-[11px] font-semibold uppercase tracking-wide text-muted truncate">{label}</span>
      </span>
      <span className="font-display text-2xl font-semibold leading-none tracking-tight tabular-nums text-text">{value}</span>
      <span className={`mt-1.5 text-xs ${ACCENT_TEXT[accent]}`}>{sub}</span>
    </Link>
  );
}

export function PromisesMetrics({ metrics }: { metrics: PromiseMetrics }) {
  const keptRateLabel = metrics.keptRate == null ? "—" : `${Math.round(metrics.keptRate * 100)}%`;
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-6 sm:grid-cols-4" aria-label="Promises summary metrics">
      <Tile to="?tab=active"   label="Active"     value={String(metrics.activeCount)}   sub={`${formatUSD(metrics.activeAmount)} promised`}   accent="copper" />
      <Tile to="?tab=due-soon" label="Due soon"   value={String(metrics.dueSoonCount)}  sub={`${formatUSD(metrics.dueSoonAmount)} promised`}  accent="ink" />
      <Tile to="?tab=broken"   label="Broken"     value={String(metrics.brokenCount)}   sub={`${formatUSD(metrics.brokenOutstanding)} outstanding`} accent="hot" />
      <Tile to="?tab=kept"     label="Kept rate"  value={keptRateLabel}                 sub="of resolved promises"                          accent="cool" />
    </div>
  );
}
