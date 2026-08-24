// Empty-state copy for the collections work queue. Pure; no I/O.

export const FIRST_RUN_QUEUE_TITLE = "Connect QuickBooks to load overdue invoices.";
export const HEALTHY_EMPTY_QUEUE_TITLE = "No overdue accounts.";
export const FILTER_MISS_QUEUE_TITLE = "No accounts match this view.";
export const RECONNECT_QUEUE_TITLE = "Reconnect QuickBooks to load overdue invoices.";
export const PARTIAL_QUEUE_TITLE = "Queue may be incomplete.";
export const FOCUS_HANDLED_EMPTY = "All cases are handled or on hold.";

export type EmptyQueueCopy = {
  title: string;
  /** Filter-miss only — the empty-state UI links “Clear the search”. */
  clearSearch: boolean;
};

/**
 * First-run / reconnect / healthy-empty / filter-miss / truncated partial.
 * Call only when the visible queue is empty.
 */
export function emptyQueueCopy({
  connected,
  view,
  q,
  truncated = false,
  needsReconnect = false,
}: {
  connected: boolean;
  view: string;
  q: string;
  truncated?: boolean;
  needsReconnect?: boolean;
}): EmptyQueueCopy {
  if (needsReconnect) {
    return { title: RECONNECT_QUEUE_TITLE, clearSearch: false };
  }
  if (!connected) {
    return { title: FIRST_RUN_QUEUE_TITLE, clearSearch: false };
  }
  if (truncated) {
    return { title: PARTIAL_QUEUE_TITLE, clearSearch: false };
  }
  const filterMiss = q.trim() !== "" || view !== "all-open";
  if (filterMiss) {
    return { title: FILTER_MISS_QUEUE_TITLE, clearSearch: true };
  }
  return { title: HEALTHY_EMPTY_QUEUE_TITLE, clearSearch: false };
}

/** Focus empty-deck body. Disconnected must not claim cases are handled. */
export function focusEmptyBody({
  connected,
  needsReconnect = false,
  heldCount,
  heldSummary,
}: {
  connected: boolean;
  needsReconnect?: boolean;
  heldCount: number;
  heldSummary?: string;
}): string {
  if (needsReconnect) return RECONNECT_QUEUE_TITLE;
  if (!connected) return FIRST_RUN_QUEUE_TITLE;
  if (heldCount > 0 && heldSummary) return heldSummary;
  return FOCUS_HANDLED_EMPTY;
}
