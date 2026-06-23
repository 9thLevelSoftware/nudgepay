import type { Metrics } from "../lib/worklist-pure";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

interface TileProps {
  label: string;
  count: number;
  amount: number;
  /** Optional accent class applied to the count text and a thin top border strip. */
  accent?: "hot" | "warm" | "copper" | "ink";
}

/** Accent → token mappings (static literals so Tailwind v4 scanner picks them up). */
const accentTokens: Record<NonNullable<TileProps["accent"]>, { count: string; bar: string }> = {
  hot:    { count: "text-hot",    bar: "bg-hot" },
  warm:   { count: "text-warm",   bar: "bg-warm" },
  copper: { count: "text-copper", bar: "bg-copper" },
  ink:    { count: "text-ink",    bar: "bg-ink" },
};

function MetricTile({ label, count, amount, accent = "ink" }: TileProps) {
  const tokens = accentTokens[accent];
  return (
    <div className="relative bg-surface rounded-lg border border-border overflow-hidden flex flex-col gap-1 px-4 py-3 min-w-0">
      {/* Thin accent bar along the top edge */}
      <span className={`absolute inset-x-0 top-0 h-0.5 ${tokens.bar} opacity-70`} aria-hidden="true" />

      {/* Count — display font, prominent */}
      <span className={`font-display text-3xl font-semibold leading-none tracking-tight ${tokens.count}`}>
        {count}
      </span>

      {/* Dollar total — mono, tabular */}
      <span className="font-mono text-sm text-muted leading-snug tabular-nums">
        {usd.format(amount)}
      </span>

      {/* Label — body, muted caption */}
      <span className="font-sans text-xs text-muted uppercase tracking-wide leading-none mt-0.5">
        {label}
      </span>
    </div>
  );
}

interface MetricsStripProps {
  metrics: Metrics;
}

/**
 * MetricsStrip — four summary tiles across the top of the collections workspace.
 *
 * Tile order (per spec): 30+ days past due · High value · Never contacted · All open.
 * Hot accent on 30+ (urgency signal), warm on Never contacted (attention signal),
 * copper on High value (brand/value signal), ink-neutral on All open.
 */
export function MetricsStrip({ metrics }: MetricsStripProps) {
  return (
    <div
      className="grid grid-cols-2 gap-3 sm:grid-cols-4"
      aria-label="Collections summary metrics"
    >
      <MetricTile
        label="30+ days past due"
        count={metrics.thirtyPlus.count}
        amount={metrics.thirtyPlus.amount}
        accent="hot"
      />
      <MetricTile
        label="High value"
        count={metrics.highValue.count}
        amount={metrics.highValue.amount}
        accent="copper"
      />
      <MetricTile
        label="Never contacted"
        count={metrics.neverContacted.count}
        amount={metrics.neverContacted.amount}
        accent="warm"
      />
      <MetricTile
        label="All open"
        count={metrics.allOpen.count}
        amount={metrics.allOpen.amount}
        accent="ink"
      />
    </div>
  );
}
