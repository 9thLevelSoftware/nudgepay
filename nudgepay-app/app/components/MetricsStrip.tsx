import { Link } from "react-router";
import type { Metrics, ViewId, SortId } from "../lib/worklist";
import { formatUSD } from "../lib/format";
import { Icon } from "./Icons";

type Accent = "copper" | "cool" | "hot" | "ink" | "neutral";

interface TileProps {
  label: string;
  count: number;
  amount: number;
  viewId: ViewId;
  active: boolean;
  href: string;
  accent: Accent;
}

// Static literal maps for the Tailwind v4 scanner.
const ACCENT_TEXT: Record<Accent, string> = {
  copper: "text-copper",
  cool: "text-cool",
  hot: "text-hot",
  ink: "text-text",
  neutral: "text-muted",
};
const ACCENT_DOT: Record<Accent, string> = {
  copper: "bg-copper",
  cool: "bg-cool",
  hot: "bg-hot",
  ink: "bg-ink",
  neutral: "bg-muted",
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
        "relative flex flex-col text-left p-4 rounded-tile overflow-hidden min-w-0 transition-colors",
        "snap-start shrink-0 min-w-[140px] sm:shrink sm:min-w-0",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper",
        active
          ? "bg-copper/5 border border-copper shadow-tile"
          : "bg-paper border border-border hover:border-copper/50",
      ].join(" ")}
    >
      <span
        aria-hidden="true"
        className={`absolute top-0 inset-x-0 h-0.5 ${active ? "bg-copper" : "bg-transparent"}`}
      />
      <span className="flex items-center gap-1.5 mb-2">
        <span aria-hidden="true" className={`w-2 h-2 rounded-full shrink-0 ${ACCENT_DOT[accent]}`} />
        <span className="font-mono text-[11px] font-semibold uppercase tracking-wide text-muted truncate">
          {label}
        </span>
      </span>
      <span className="font-display text-2xl font-semibold leading-none tracking-tight tabular-nums text-text">
        {formatUSD(amount)}
      </span>
      <span className="mt-1.5 text-xs text-muted">
        <span className={`font-mono font-semibold ${ACCENT_TEXT[accent]}`}>{count}</span>{" "}
        {count === 1 ? "account" : "accounts"}
      </span>
    </Link>
  );
}

interface MetricsStripProps {
  metrics: Metrics;
  view?: ViewId;
  sort?: SortId;
  search?: string;
  scopeLabel?: string | null;
  clearHref?: string;
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
export function MetricsStrip({ metrics, view, sort = "recommended", search = "", scopeLabel, clearHref }: MetricsStripProps) {
  const href = (v: ViewId) => {
    const p = new URLSearchParams({ view: v, sort, ...(search ? { q: search } : {}) });
    return `?${p.toString()}`;
  };
  const tiles: {
    label: string;
    viewId: ViewId;
    accent: Accent;
    m: { count: number; amount: number };
  }[] = [
    { label: "30+ days past due", viewId: "30-plus",         accent: "copper",  m: metrics.thirtyPlus },
    { label: "High value",        viewId: "high-value",      accent: "cool",    m: metrics.highValue },
    { label: "Never contacted",   viewId: "never-contacted", accent: "neutral", m: metrics.neverContacted },
    { label: "All open",          viewId: "all-open",        accent: "ink",     m: metrics.allOpen },
    { label: "Follow-ups due",    viewId: "follow-ups-due",  accent: "copper",  m: metrics.followUpsDue },
    { label: "Broken promises",   viewId: "broken-promises", accent: "hot",     m: metrics.brokenPromises },
    { label: "On hold",           viewId: "on-hold",         accent: "neutral", m: metrics.onHold },
  ];
  return (
    <>
      {scopeLabel && (
        <div className="flex items-center gap-2 mb-2 text-xs font-sans text-muted">
          <span className="inline-flex items-center gap-1.5 rounded-md bg-copper/10 border border-copper/20 px-2.5 py-1 font-medium text-copper">
            <Icon name="filter" size={12} aria-hidden />
            {scopeLabel}
          </span>
          {clearHref && (
            <Link to={clearHref} className="text-copper hover:underline font-medium">
              Clear
            </Link>
          )}
        </div>
      )}
      <div
        className="flex gap-3 overflow-x-auto snap-x snap-mandatory scrollbar-none sm:grid sm:gap-6 sm:grid-cols-3 xl:grid-cols-7"
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
    </>
  );
}
