// Pure next-best-action / "Why now" logic shared by Focus Mode (card callout)
// and Dashboard v2 (triage strip, NBA panel). No I/O, no .server suffix.

import type { CaseItem } from "./cases";
import { formatDate } from "./dates";

export type WhyNow = { headline: string; reason: string };

/**
 * Compose a "Why now" callout for a single case.
 *
 * Headline: the priority engine's one-line reason (e.g. "95 days overdue,
 * Broken promise"). Reason: a more conversational nudge stitched from case
 * facts, capped at ~one sentence.
 */
export function whyNow(item: CaseItem): WhyNow {
  const headline = item.priority.reason || `${item.effectiveLevel} priority`;

  const parts: string[] = [];

  if (item.brokenPromise && item.promise) {
    parts.push(`Promise broken on ${formatDate(item.promise.date)}`);
  } else if (item.followUpDue && item.nextActionAt) {
    parts.push(`Follow-up due ${formatDate(item.nextActionAt)}`);
  }

  if (item.lastContact == null) {
    parts.push("Never contacted");
  } else if (item.lastContact.date) {
    parts.push(`Last contact: ${item.lastContact.channel.toLowerCase()} · ${formatDate(item.lastContact.date)}`);
  }

  if (item.commPrefs.preferredChannel === "call") {
    parts.push("Prefers phone");
  } else if (item.commPrefs.preferredChannel === "text") {
    parts.push("Prefers text");
  }

  return { headline, reason: parts.join(" · ") || `${item.oldestAgeDays}d overdue` };
}

/**
 * Pick the top-N highest-leverage cases for the "Start here" triage strip.
 *
 * Filters out on_hold, waiting, and cases with a pending promise (no action
 * available), then sorts by score descending.
 */
export function pickTriage(items: CaseItem[], n = 3): CaseItem[] {
  return items
    .filter((c) =>
      c.status !== "on_hold" &&
      c.status !== "waiting" &&
      c.promiseStatus !== "pending" &&
      !c.suppressed,
    )
    .sort((a, b) => b.score - a.score)
    .slice(0, n);
}
