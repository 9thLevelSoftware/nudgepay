// app/components/AccountsMetrics.tsx
import type { AccountMetrics } from "../lib/accounts";
import { formatUSD } from "../lib/format";

type Accent = "ink" | "copper" | "neutral" | "cool";
const ACCENT_TEXT: Record<Accent, string> = {
  ink: "text-text", copper: "text-copper", neutral: "text-muted", cool: "text-cool",
};
const ACCENT_DOT: Record<Accent, string> = {
  ink: "bg-ink", copper: "bg-copper", neutral: "bg-muted", cool: "bg-cool",
};

function Tile({ label, value, sub, accent }: { label: string; value: string; sub: string; accent: Accent }) {
  return (
    <div className="relative flex flex-col p-4 rounded-tile overflow-hidden min-w-0 bg-paper border border-border">
      <span aria-hidden="true" className={`absolute top-0 inset-x-0 h-0.5 ${ACCENT_DOT[accent]}`} />
      <span className="flex items-center gap-1.5 mb-2">
        <span aria-hidden="true" className={`w-2 h-2 rounded-full shrink-0 ${ACCENT_DOT[accent]}`} />
        <span className="font-mono text-[11px] font-semibold uppercase tracking-wide text-muted truncate">{label}</span>
      </span>
      <span className="font-display text-2xl font-semibold leading-none tracking-tight tabular-nums text-text">{value}</span>
      <span className={`mt-1.5 text-xs ${ACCENT_TEXT[accent]}`}>{sub}</span>
    </div>
  );
}

export function AccountsMetrics({ metrics }: { metrics: AccountMetrics }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-6 sm:grid-cols-4" aria-label="Accounts summary metrics">
      <Tile label="Total customers" value={String(metrics.totalCustomers)} sub="in directory" accent="ink" />
      <Tile label="Open A/R" value={formatUSD(metrics.totalOpenAR)} sub="across all accounts" accent="copper" />
      <Tile label="Unassigned" value={String(metrics.unassignedCount)} sub="no owner" accent="neutral" />
      <Tile label="Paid up" value={String(metrics.paidUpCount)} sub="zero balance" accent="cool" />
    </div>
  );
}
