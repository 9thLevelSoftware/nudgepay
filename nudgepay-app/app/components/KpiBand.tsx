// KpiBand — compact one-row KPI strip replacing MetricsStrip on the dashboard.
// Horizontal scroll on mobile, full grid on wider screens. Each tile links to
// its ?view= filter. Active tile gets copper accent. Carries the scope/filter
// chip when a view or search is active.

import { Link } from "react-router";
import type { Metrics, ViewId, SortId } from "../lib/worklist";
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

const TEXT: Record<Accent, string> = {
  ink: "text-text",
  copper: "text-copper",
  hot: "text-hot",
  cool: "text-cool",
  neutral: "text-muted",
};

interface KpiBandProps {
  metrics: Metrics;
  view?: ViewId;
  sort?: SortId;
  search?: string;
  scopeLabel?: string | null;
  clearHref?: string;
}

export function KpiBand({ metrics, view, sort = "recommended", search = "", scopeLabel, clearHref }: KpiBandProps) {
  const href = (v: ViewId) => {
    const p = new URLSearchParams({ view: v, sort, ...(search ? { q: search } : {}) });
    return `?${p.toString()}`;
  };

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
        className="flex gap-2 overflow-x-auto snap-x snap-mandatory scrollbar-none"
        aria-label="Collections summary metrics"
      >
        {tiles.map((t) => {
          const active = view === t.viewId;
          return (
            <Link
              key={t.viewId}
              to={href(t.viewId)}
              aria-label={`${t.label}: ${plural(t.m.count, "account")}, ${formatUSD(t.m.amount)}`}
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
                <span className="font-mono text-[10px] font-semibold uppercase tracking-wide text-muted truncate">
                  {t.label}
                </span>
                <span className="flex items-baseline gap-1.5">
                  <span className="font-display text-sm font-bold tabular-nums text-text leading-tight">
                    {formatUSD(t.m.amount)}
                  </span>
                  <span className={`text-[10px] tabular-nums ${TEXT[t.accent]}`}>
                    {t.m.count}
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
