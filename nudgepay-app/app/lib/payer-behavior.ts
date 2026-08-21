// Pure payer-band math. No I/O — loaders fetch paid invoices + reply counts.

import { ageInDays } from "./worklist";

export type PayerBand = "good" | "fair" | "risk" | "unknown";

export type PayerStats = {
  band: PayerBand;
  daysToPay: number | null;
  paidSample: number;
  replyRate: number | null;
  outbound: number;
  inbound: number;
  brokenPromise: boolean;
};

export const PAYER_BAND_LABEL: Record<PayerBand, string> = {
  good: "GOOD",
  fair: "FAIR",
  risk: "RISK",
  unknown: "—",
};

export const PAYER_BAND_HINT = "Heuristic from NudgePay activity, not a bureau rating.";

export function daysToPay(
  invoices: { invoiceDate: string | null; paidDate: string | null }[],
): number | null {
  const rows = invoices
    .filter((i) => i.invoiceDate && i.paidDate)
    .sort((a, b) => (a.paidDate! < b.paidDate! ? 1 : a.paidDate! > b.paidDate! ? -1 : 0))
    .slice(0, 12);
  if (rows.length === 0) return null;
  const sum = rows.reduce((s, i) => s + ageInDays(i.invoiceDate as string, i.paidDate as string), 0);
  return sum / rows.length;
}

export function replyRate(outbound: number, inbound: number): number | null {
  if (outbound <= 0) return null;
  return inbound / outbound;
}

export function payerBand(s: Omit<PayerStats, "band">): PayerBand {
  if (s.brokenPromise
    || (s.daysToPay != null && s.daysToPay >= 45)
    || (s.replyRate != null && s.replyRate < 0.2 && s.outbound >= 3)) {
    return "risk";
  }
  if (s.daysToPay != null && s.daysToPay <= 35
    && (s.replyRate == null || s.replyRate >= 0.5)
    && !s.brokenPromise) {
    return "good";
  }
  if (s.paidSample > 0 || s.outbound > 0) return "fair";
  return "unknown";
}

export function buildPayerStats(input: Omit<PayerStats, "band">): PayerStats {
  return { ...input, band: payerBand(input) };
}
