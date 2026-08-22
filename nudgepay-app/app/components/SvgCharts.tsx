import type { ReactNode } from "react";

export type ChartTone = "ink" | "copper" | "cool" | "warm" | "hot";

const STROKE: Record<ChartTone, string> = {
  ink: "stroke-ink",
  copper: "stroke-copper",
  cool: "stroke-cool",
  warm: "stroke-warm",
  hot: "stroke-hot",
};

const FILL: Record<ChartTone, string> = {
  ink: "fill-ink",
  copper: "fill-copper",
  cool: "fill-cool",
  warm: "fill-warm",
  hot: "fill-hot",
};

export function Sparkline({
  values,
  label,
  tone = "copper",
  className = "",
}: {
  values: number[];
  label: string;
  tone?: ChartTone;
  className?: string;
}) {
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = Math.max(max - min, 1);
  const points = values
    .map((value, index) => {
      const x = values.length <= 1 ? 0 : (index / (values.length - 1)) * 100;
      const y = 26 - ((value - min) / span) * 22;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg
      viewBox="0 0 100 28"
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
      className={`h-7 w-full ${className}`}
    >
      <title>{label}</title>
      <polyline
        points={points}
        fill="none"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={STROKE[tone]}
      />
    </svg>
  );
}

export interface ChartPoint {
  label: string;
  value: number | null;
}

export function TrendLineChart({
  points,
  label,
  tone = "copper",
  formatValue = (value) => String(value),
}: {
  points: ChartPoint[];
  label: string;
  tone?: ChartTone;
  formatValue?: (value: number) => string;
}) {
  const values = points.map((point) => point.value ?? 0);
  const max = Math.max(...values, 1);
  const width = 600;
  const height = 160;
  const left = 8;
  const right = width - 8;
  const top = 12;
  const bottom = 126;
  const xFor = (index: number) =>
    points.length <= 1 ? width / 2 : left + (index / (points.length - 1)) * (right - left);
  const yFor = (value: number) => bottom - (value / max) * (bottom - top);
  const line = points.map((point, index) => `${xFor(index)},${yFor(point.value ?? 0)}`).join(" ");
  const labelIndexes = points.length <= 4
    ? points.map((_, index) => index)
    : [0, Math.floor((points.length - 1) / 2), points.length - 1];

  return (
    <div className="min-w-0">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} className="h-40 w-full">
        <title>{label}</title>
        <line x1={left} x2={right} y1={bottom} y2={bottom} className="stroke-border" strokeWidth="1" />
        <line x1={left} x2={right} y1={(top + bottom) / 2} y2={(top + bottom) / 2} className="stroke-border/60" strokeWidth="1" strokeDasharray="3 4" />
        <polyline
          points={line}
          fill="none"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={STROKE[tone]}
        />
        {points.map((point, index) => point.value == null ? null : (
          <circle key={`${point.label}-${index}`} cx={xFor(index)} cy={yFor(point.value)} r="3" className={FILL[tone]}>
            <title>{`${point.label}: ${formatValue(point.value)}`}</title>
          </circle>
        ))}
        {labelIndexes.map((index) => (
          <text key={`${points[index]?.label ?? index}-label`} x={xFor(index)} y="148" textAnchor="middle" className="fill-muted font-mono text-[10px]">
            {points[index]?.label}
          </text>
        ))}
      </svg>
    </div>
  );
}

export interface AgingBucket {
  label: string;
  amount: number;
  count: number;
}

export function AgingBarChart({ buckets, label = "Accounts receivable aging" }: { buckets: AgingBucket[]; label?: string }) {
  const total = buckets.reduce((sum, bucket) => sum + bucket.amount, 0);
  const tones: ChartTone[] = ["cool", "copper", "warm", "hot", "ink"];
  let offset = 0;

  return (
    <div role="img" aria-label={label} className="flex flex-col gap-3">
      <svg viewBox="0 0 600 34" className="h-9 w-full" preserveAspectRatio="none">
        <title>{label}</title>
        <rect x="0" y="4" width="600" height="26" rx="6" className="fill-border/50" />
        {buckets.map((bucket, index) => {
          const width = total > 0 ? (bucket.amount / total) * 600 : 0;
          const x = offset;
          offset += width;
          return width <= 0 ? null : (
            <rect key={bucket.label} x={x} y="4" width={width} height="26" className={FILL[tones[index % tones.length]]}>
              <title>{`${bucket.label}: ${bucket.amount.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })}`}</title>
            </rect>
          );
        })}
      </svg>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-5">
        {buckets.map((bucket, index) => (
          <div key={bucket.label} className="flex min-w-0 items-start gap-1.5 text-xs">
            <span aria-hidden="true" className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${FILL[tones[index % tones.length]]}`} />
            <span className="min-w-0">
              <span className="block truncate text-muted">{bucket.label}</span>
              <span className="block font-mono tabular-nums text-text">
                {bucket.amount.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })}
                <span className="ml-1 text-muted">({bucket.count})</span>
              </span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ChartCard({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-surface p-4 shadow-tile">
      <h2 className="font-display text-base font-semibold text-text">{title}</h2>
      {description ? <p className="mt-0.5 text-xs text-muted">{description}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}
