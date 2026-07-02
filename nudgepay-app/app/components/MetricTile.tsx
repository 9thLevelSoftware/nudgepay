import { Link } from "react-router";

export type MetricAccent = "ink" | "copper" | "hot" | "cool" | "neutral";

// Static literal maps for the Tailwind v4 scanner — no dynamic concatenation.
const ACCENT_TEXT: Record<MetricAccent, string> = {
  ink: "text-text",
  copper: "text-copper",
  hot: "text-hot",
  cool: "text-cool",
  neutral: "text-muted",
};
const ACCENT_DOT: Record<MetricAccent, string> = {
  ink: "bg-ink",
  copper: "bg-copper",
  hot: "bg-hot",
  cool: "bg-cool",
  neutral: "bg-muted",
};

interface MetricTileProps {
  label: string;
  value: string;
  sub: string;
  accent: MetricAccent;
  href?: string;
  active?: boolean;
  className?: string;
  ariaLabel?: string;
}

/**
 * MetricTile — a shared KPI tile used across Accounts/Promises/Messages
 * summary rows and the Collections MetricsStrip.
 *
 * Renders as a `<Link>` when `href` is provided, otherwise a plain `<div>`
 * (AccountsMetrics has no per-tile destination). The `active` prop adds the
 * copper ring + top-bar treatment used by MetricsStrip's selected view.
 */
export function MetricTile({
  label, value, sub, accent, href, active = false, className = "", ariaLabel,
}: MetricTileProps) {
  const inner = (
    <>
      <span
        aria-hidden="true"
        className={`absolute top-0 inset-x-0 h-0.5 ${active ? "bg-copper" : ACCENT_DOT[accent]}`}
      />
      <span className="flex items-center gap-1.5 mb-2">
        <span aria-hidden="true" className={`w-2 h-2 rounded-full shrink-0 ${ACCENT_DOT[accent]}`} />
        <span className="font-mono text-[11px] font-semibold uppercase tracking-wide text-muted truncate">
          {label}
        </span>
      </span>
      <span className="font-display text-2xl font-semibold leading-none tracking-tight tabular-nums text-text">
        {value}
      </span>
      <span className={`mt-1.5 text-xs ${ACCENT_TEXT[accent]}`}>{sub}</span>
    </>
  );

  const baseClass = [
    "relative flex flex-col p-4 rounded-tile overflow-hidden min-w-0",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper",
    active
      ? "bg-copper/5 border border-copper shadow-tile"
      : "bg-paper border border-border hover:border-copper/50",
    className,
  ].join(" ");

  if (href) {
    return (
      <Link
        to={href}
        aria-label={ariaLabel}
        aria-current={active ? "true" : undefined}
        className={baseClass}
      >
        {inner}
      </Link>
    );
  }

  return (
    <div aria-label={ariaLabel} className={baseClass}>
      {inner}
    </div>
  );
}
