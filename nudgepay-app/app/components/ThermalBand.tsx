import type { Heat } from "../lib/worklist";

// Map the heat band to the Tailwind token classes for text.
// Tailwind v4 with @theme: literal class strings only.
const bandTokens: Record<Heat["band"], { text: string }> = {
  cool: { text: "text-cool" },
  warm: { text: "text-warm" },
  hot:  { text: "text-hot" },
};

interface ThermalBandProps {
  heat: Heat;
}

/**
 * ThermalBand — the signature thermal aging indicator.
 *
 * Slim label-only treatment: the row now carries the heat color via a left rail.
 * Renders the label (COOL/WARM/HOT) in the band color and the age in days in mono.
 *
 * Static color only — reduced-motion safe by construction (no animation).
 */
export function ThermalBand({ heat }: ThermalBandProps) {
  const tokens = bandTokens[heat.band];
  return (
    <span
      className="inline-flex items-center gap-1.5"
      aria-label={`${heat.label.toLowerCase()}, ${heat.days} days overdue`}
    >
      <span className={`font-mono text-[10px] font-semibold uppercase tracking-wide leading-none ${tokens.text}`}>
        {heat.label}
      </span>
      <span className="font-mono text-[11px] leading-none text-muted">{heat.days}d</span>
    </span>
  );
}
