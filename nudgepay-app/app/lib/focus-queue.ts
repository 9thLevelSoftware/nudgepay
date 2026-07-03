// Pure helpers for building the Focus Mode queue. No I/O, no .server suffix.

import { applyCaseView, sortCaseItems, type CaseItem } from "./cases";
import type { ViewId, SortId } from "./worklist";

export type FocusScope = "my-work" | "all-open";

/**
 * Build the focus-mode queue from the full set of case items.
 *
 * 1. Try the "my-work" view (owner === currentUserId), excluding suppressed
 *    cases (my-work doesn't filter them — unlike all-open — so we add the
 *    filter explicitly here).
 * 2. If that yields zero cases, fall back to "all-open" (which already
 *    excludes suppressed).
 * 3. Sort by "recommended" (priority rank → score → priorAttempts → age → balance).
 */
export function buildFocusQueue(
  items: CaseItem[],
  today: string,
  currentUserId: string | null,
): { queue: CaseItem[]; scope: FocusScope } {
  const mine = applyCaseView(items, "my-work" as ViewId, today, currentUserId)
    .filter((i) => !i.suppressed);
  if (mine.length > 0) {
    return { queue: sortCaseItems(mine, "recommended" as SortId), scope: "my-work" };
  }
  const all = applyCaseView(items, "all-open" as ViewId, today, currentUserId);
  return { queue: sortCaseItems(all, "recommended" as SortId), scope: "all-open" };
}
