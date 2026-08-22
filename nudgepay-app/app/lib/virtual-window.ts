// Fixed-height list window. Pure; no I/O, no DOM. Used by WorkQueue so a
// 1,000-row queue only mounts the rows in view (+ overscan).
// Local density union — do not import queue-chrome.

export type QueueDensity = "general" | "detailed" | "risk";

/** Desktop queue row: py-2 + two text lines + border ≈ 56px. */
export const QUEUE_ROW_H = 56;
/** Two peek lines + existing two-line customer cell. */
export const QUEUE_ROW_DETAILED_H = 96;
export const QUEUE_ROW_RISK_H = 64;
/** Mobile card: p-3 + header/status/contact + mb-2 ≈ 108px. */
export const QUEUE_CARD_H = 108;
export const QUEUE_CARD_DETAILED_H = 132;
export const QUEUE_CARD_RISK_H = 128;
/** Extra rows mounted above and below the viewport. */
export const QUEUE_OVERSCAN = 8;

export function queueRowHeight(density: QueueDensity, mobile: boolean): number {
  if (mobile) {
    if (density === "detailed") return QUEUE_CARD_DETAILED_H;
    if (density === "risk") return QUEUE_CARD_RISK_H;
    return QUEUE_CARD_H;
  }
  if (density === "detailed") return QUEUE_ROW_DETAILED_H;
  if (density === "risk") return QUEUE_ROW_RISK_H;
  return QUEUE_ROW_H;
}

export type VisibleWindowArgs = {
  scrollTop: number;
  viewportH: number;
  rowH: number;
  count: number;
  overscan: number;
};

export type VisibleWindow = {
  /** Inclusive start index. */
  start: number;
  /** Exclusive end index. */
  end: number;
  padTop: number;
  padBottom: number;
};

/**
 * Slice + spacer for a virtualized list. `end` is exclusive.
 * Pads are in pixels so the scroller keeps a stable total height of `count * rowH`.
 */
export function visibleWindow({
  scrollTop,
  viewportH,
  rowH,
  count,
  overscan,
}: VisibleWindowArgs): VisibleWindow {
  const n = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  if (n === 0 || !Number.isFinite(rowH) || rowH <= 0) {
    return { start: 0, end: 0, padTop: 0, padBottom: 0 };
  }

  const y = Number.isFinite(scrollTop) && scrollTop > 0 ? scrollTop : 0;
  const h = Number.isFinite(viewportH) && viewportH > 0 ? viewportH : 0;
  const extra = Number.isFinite(overscan) ? Math.max(0, Math.floor(overscan)) : 0;

  const first = Math.floor(y / rowH);
  const last = Math.ceil((y + h) / rowH);
  const start = Math.max(0, first - extra);
  const end = Math.min(n, Math.max(start, last + extra));
  return {
    start,
    end,
    padTop: start * rowH,
    padBottom: (n - end) * rowH,
  };
}
