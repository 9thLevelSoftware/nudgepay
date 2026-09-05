// KpiBand — compact one-row KPI strip replacing MetricsStrip on the dashboard.
// Horizontal scroll on mobile, full grid on wider screens. Each tile links to
// its ?view= filter. Active tile gets copper accent. Carries the scope/filter
// chip when a view or search is active.

import { Link } from "react-router";
import type { Metrics, ViewId, SortId } from "../lib/worklist";
import { dashboardHref, type DensityId, type EntityMode } from "../lib/queue-chrome";
import { formatUSD } from "../lib/format";
import { plural } from "../lib/labels";
import { Icon } from "./Icons";

// Static accent → dot/text classes. Tailwind v4 scanner needs literal strings.
type Accent = "ink" | "copper" | "hot" | "cool" | "neutral";

const DOT: Record<Accent, string> = {
  ink: "bg-ink",
  copper: "bg-copper",
  hot: "bg-hot",
  cool: "bg-cool",
  neutral: "bg-muted",
};

interface KpiBandProps {
  metrics: Metrics;
  view?: ViewId;
  sort?: SortId;
  search?: string;
  density?: DensityId;
  entity?: EntityMode;
  scopeLabel?: string | null;
  clearHref?: string;
  lastContactTruncated?: boolean;
}

export function KpiBand({ metrics, view, sort = "recommended", search = "", density, entity, scopeLabel, clearHref, lastContactTruncated = false }: KpiBandProps) {
  const href = (v: ViewId) =>
    dashboardHref({ view: v, sort, q: search || undefined, entity, density });

  const tiles: { label: string; viewId: ViewId; accent: Accent; m: { count: number; amount: number } }[] = [
    { label: "30+ days past due", viewId: "30-plus",         accent: "copper",  m: metrics.thirtyPlus },
    { label: "High value",        viewId: "high-value",      accent: "cool",    m: metrics.highValue },
    { label: "Never contacted",   viewId: "never-contacted", accent: "neutral", m: metrics.neverContacted },
    { label: "All open",          viewId: "all-open",        accent: "ink",     m: metrics.allOpen },
    { label: "Coming due",        viewId: "coming-due",      accent: "cool",    m: metrics.comingDue },
    { label: "Follow-ups due",    viewId: "follow-ups-due",  accent: "copper",  m: metrics.followUpsDue },
    { label: "Broken promises",   viewId: "broken-promises", accent: "hot",     m: metrics.brokenPromises },
    { label: "On hold",           viewId: "on-hold",         accent: "neutral", m: metrics.onHold },
  ];

  const contactViews = new Set<ViewId>(["never-contacted", "broken-promises"]);

  return (
    <>
      {(scopeLabel || lastContactTruncated) && (
        <div className="flex items-center gap-2 mb-2 text-xs font-sans text-muted">
          {lastContactTruncated ? (
            <span
              className="inline-flex items-center rounded-md bg-copper/10 border border-copper/20 px-2 py-0.5 text-[10px] font-sans font-medium text-copper"
              title="Based on the last 5,000 contact rows. Totals may under-count."
            >
              Partial history
            </span>
          ) : null}
          {scopeLabel ? (
            <span className="inline-flex items-center gap-1.5 rounded-md bg-copper/10 border border-copper/20 px-2.5 py-1 font-medium text-copper">
              <Icon name="filter" size={12} aria-hidden />
              {scopeLabel}
            </span>
          ) : null}
          {clearHref && (
            <Link to={clearHref} className="text-copper hover:underline font-medium">
              Clear
            </Link>
          )}
        </div>
      )}
      <div
        className="flex gap-2 overflow-x-auto snap-x snap-mandatory scrollbar-none"
        aria-label="Collections summary metrics"
      >
        {tiles.map((t) => {
          const active = view === t.viewId;
          const hideTotals = lastContactTruncated && contactViews.has(t.viewId);
          const amountLabel = hideTotals ? "—" : formatUSD(t.m.amount);
          const countLabel = hideTotals ? "—" : String(t.m.count);
          return (
            <Link
              key={t.viewId}
              to={href(t.viewId)}
              aria-label={`${t.label}: ${hideTotals ? "incomplete" : `${plural(t.m.count, "account")}, ${formatUSD(t.m.amount)}`}`}
              aria-current={active ? "true" : undefined}
              className={[
                "snap-start shrink-0 flex items-center gap-2.5 rounded-lg border px-3 py-2 min-w-[160px] transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper",
                active
                  ? "border-copper bg-copper/10"
                  : "border-border bg-paper hover:border-copper/50",
              ].join(" ")}
            >
              <span aria-hidden="true" className={`w-2 h-2 rounded-full shrink-0 ${DOT[t.accent]}`} />
              <span className="flex flex-col min-w-0">
                <span className="truncate font-mono text-[10px] font-semibold uppercase tracking-wide text-text">
                  {t.label}
                </span>
                <span className="flex items-baseline gap-1.5">
                  <span className="font-display text-sm font-bold tabular-nums text-text leading-tight">
                    {amountLabel}
                  </span>
                  <span className="text-[10px] tabular-nums text-text">
                    {countLabel}
                  </span>
                </span>
              </span>
            </Link>
          );
        })}
      </div>
    </>
  );
}
