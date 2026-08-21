// Empty-state copy for the collections work queue. Pure; no I/O.

export const FIRST_RUN_QUEUE_TITLE = "Connect QuickBooks to load overdue invoices.";
export const FILTER_MISS_QUEUE_TITLE = "No accounts match this view.";

export type EmptyQueueCopy = {
  title: string;
  /** Filter-miss only — the empty-state UI links “Clear the search”. */
  clearSearch: boolean;
};

/**
 * First-run / disconnected / no cases at all vs a search or saved-view miss.
 * Call only when the visible queue is empty.
 */
export function emptyQueueCopy({
  connected,
  view,
  q,
}: {
  connected: boolean;
  view: string;
  q: string;
}): EmptyQueueCopy {
  const filterMiss = q.trim() !== "" || view !== "all-open";
  if (!connected || !filterMiss) {
    return { title: FIRST_RUN_QUEUE_TITLE, clearSearch: false };
  }
  return { title: FILTER_MISS_QUEUE_TITLE, clearSearch: true };
}
