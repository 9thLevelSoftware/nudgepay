import { Link } from "react-router";
import type { Metrics, ViewId, SortId } from "../lib/worklist";
import { formatUSD } from "../lib/format";
import { Icon } from "./Icons";
import { MetricTile, type MetricAccent } from "./MetricTile";

type Accent = MetricAccent;

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
            value={formatUSD(t.m.amount)}
            sub={`${t.m.count} ${t.m.count === 1 ? "account" : "accounts"}`}
            accent={t.accent}
            href={href(t.viewId)}
            active={view === t.viewId}
            ariaLabel={`${t.label}: ${t.m.count} accounts, ${formatUSD(t.m.amount)}`}
            className="snap-start shrink-0 min-w-[140px] sm:shrink sm:min-w-0"
          />
        ))}
      </div>
    </>
  );
}
