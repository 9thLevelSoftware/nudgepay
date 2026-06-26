import { Link } from "react-router";
import type { Metrics, ViewId, SortId } from "../lib/worklist";
import { formatUSD } from "../lib/format";

interface TileProps {
  label: string;
  count: number;
  amount: number;
  viewId: ViewId;
  active: boolean;
  href: string;
  accent: "hot" | "warm" | "copper" | "ink";
}

// Accent → count-text token (static literals for the Tailwind scanner).
const accentText: Record<TileProps["accent"], string> = {
  hot: "text-hot",
  warm: "text-warm",
  copper: "text-copper",
  ink: "text-text",
};

/**
 * MetricTile — a clickable KPI tile.
 *
 * Leads with the dollar amount (the at-a-glance financial signal), with the
 * count + label beneath. The whole tile is a `<Link>` to its `?view=` filter,
 * mirroring the queue's URL-driven selection. The tile whose view is active
 * gets the single copper active treatment (ring + faint tint).
 */
function MetricTile({ label, count, amount, active, href, accent }: TileProps) {
  return (
    <Link
      to={href}
      aria-label={`${label}: ${count} accounts, ${formatUSD(amount)}`}
      aria-current={active ? "true" : undefined}
      className={[
        "flex flex-col gap-1 p-4 rounded-tile bg-surface shadow-tile min-w-0 transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper",
        active ? "ring-2 ring-copper bg-copper/5" : "border border-border hover:border-copper/50",
      ].join(" ")}
    >
      <span className="font-display text-2xl font-semibold leading-none tracking-tight tabular-nums text-text">
        {formatUSD(amount)}
      </span>
      <span className="font-sans text-xs text-muted uppercase tracking-wide leading-none mt-0.5">
        <span className={`font-mono font-medium ${accentText[accent]}`}>{count}</span> · {label}
      </span>
    </Link>
  );
}

interface MetricsStripProps {
  metrics: Metrics;
  view?: ViewId;
  sort?: SortId;
  search?: string;
}

/**
 * MetricsStrip — six clickable summary tiles across the top of the workspace.
 *
 * Tile order (per spec): 30+ days past due · High value · Never contacted ·
 * All open · Follow-ups due · Broken promises. Each tile links to its `?view=`
 * filter (preserving the current sort + search); the active view's tile carries
 * the copper active treatment. Hot accent on 30+/Broken promises (urgency),
 * warm on Never contacted/Follow-ups due (attention), copper on High value
 * (brand/value), neutral ink on All open.
 */
export function MetricsStrip({ metrics, view, sort = "recommended", search = "" }: MetricsStripProps) {
  const href = (v: ViewId) => {
    const p = new URLSearchParams({ view: v, sort, ...(search ? { q: search } : {}) });
    return `?${p.toString()}`;
  };
  const tiles: {
    label: string;
    viewId: ViewId;
    accent: TileProps["accent"];
    m: { count: number; amount: number };
  }[] = [
    { label: "30+ days past due", viewId: "30-plus", accent: "hot", m: metrics.thirtyPlus },
    { label: "High value", viewId: "high-value", accent: "copper", m: metrics.highValue },
    { label: "Never contacted", viewId: "never-contacted", accent: "warm", m: metrics.neverContacted },
    { label: "All open", viewId: "all-open", accent: "ink", m: metrics.allOpen },
    { label: "Follow-ups due", viewId: "follow-ups-due", accent: "warm", m: metrics.followUpsDue },
    { label: "Broken promises", viewId: "broken-promises", accent: "hot", m: metrics.brokenPromises },
    { label: "On hold", viewId: "on-hold", accent: "ink", m: metrics.onHold },
  ];
  return (
    <div
      className="grid grid-cols-2 gap-3 sm:gap-6 sm:grid-cols-3 xl:grid-cols-7"
      aria-label="Collections summary metrics"
    >
      {tiles.map((t) => (
        <MetricTile
          key={t.viewId}
          label={t.label}
          count={t.m.count}
          amount={t.m.amount}
          viewId={t.viewId}
          active={view === t.viewId}
          href={href(t.viewId)}
          accent={t.accent}
        />
      ))}
    </div>
  );
}
