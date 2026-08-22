// Collections workspace split (NP-AUD-2026-110).
// Below md, an open case hides the queue so detail is full-width. md+ stays two-pane.
// The queue stays mounted (CSS hidden) so keyboard nav, bulk selection, and
// coming-due remain intact.

/** True when a selected case should occupy the full workspace below md. */
export function isMobileCaseOpen(selected: unknown): boolean {
  return selected != null;
}

export function queuePaneClass(caseOpen: boolean): string {
  return caseOpen
    ? "hidden md:flex flex-col min-w-0 flex-1 overflow-hidden"
    : "flex flex-col min-w-0 flex-1 overflow-hidden";
}

export function detailPaneClass(): string {
  return [
    "min-h-0 min-w-0 flex-1 overflow-hidden",
    "md:flex-none md:w-[28rem] lg:w-[36rem] xl:w-[48rem]",
    "md:border-l border-border shadow-panel",
  ].join(" ");
}
