import type { Heat } from "../lib/worklist.server";

// Map the heat band to the Tailwind token classes for text, background tint, and bar fill.
// Tailwind v4 with @theme: bg-cool/10, bg-warm/10, bg-hot/10 are the tint tokens.
const bandTokens: Record<
  Heat["band"],
  { text: string; tint: string; bar: string }
> = {
  cool: {
    text: "text-cool",
    tint: "bg-cool/10",
    bar: "bg-cool",
  },
  warm: {
    text: "text-warm",
    tint: "bg-warm/10",
    bar: "bg-warm",
  },
  hot: {
    text: "text-hot",
    tint: "bg-hot/10",
    bar: "bg-hot",
  },
};

interface ThermalBandProps {
  heat: Heat;
}

/**
 * ThermalBand — the signature thermal aging indicator.
 *
 * Renders a compact chip: a saturated left-edge bar (3px wide) in the band
 * color, a subtle tinted background, the label (COOL/WARM/HOT) in the band
 * color, and the age in days in IBM Plex Mono.
 *
 * Static color only — reduced-motion safe by construction (no animation).
 */
export function ThermalBand({ heat }: ThermalBandProps) {
  const tokens = bandTokens[heat.band];

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded ${tokens.tint} pr-2 overflow-hidden`}
      aria-label={`${heat.label}, ${heat.days} days overdue`}
    >
      {/* Saturated left-edge bar */}
      <span className={`self-stretch w-1 shrink-0 ${tokens.bar}`} aria-hidden="true" />

      {/* Label: COOL / WARM / HOT */}
      <span
        className={`text-[11px] font-sans font-semibold uppercase tracking-wide leading-none py-1 ${tokens.text}`}
      >
        {heat.label}
      </span>

      {/* Day count in mono */}
      <span
        className={`font-mono text-[11px] leading-none py-1 ${tokens.text} opacity-80`}
      >
        {heat.days}d
      </span>
    </span>
  );
}
