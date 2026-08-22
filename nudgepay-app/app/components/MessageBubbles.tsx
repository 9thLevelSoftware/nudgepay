// app/components/MessageBubbles.tsx
// Shared ascending SMS-thread bubble renderer. Extracted from DetailPanel so the
// dashboard detail panel and the Messages-tab quick-view render identically.
// Callers handle their own empty state; this renders the bubble list only.
//
// Presentation rules:
//  - Day separators are inserted when the calendar day (org zone) changes.
//  - Meta lines use FRIENDLY status labels (twilio statuses are jargon), with
//    the raw status/error code preserved on the bubble's title for detail.

import { useEffect, useRef } from "react";
import { formatInstant } from "../lib/dates";

// Static direction → bubble alignment/color. Literal strings for the Tailwind v4 scanner.
const BUBBLE: Record<string, { wrap: string; bubble: string }> = {
  outbound: { wrap: "items-end", bubble: "bg-ink text-surface border border-ink" },
  inbound: { wrap: "items-start", bubble: "bg-paper text-text border border-border" },
};

export type ThreadBubble = {
  id: string;
  direction: string;
  body: string | null;
  status: string | null;
  errorCode: string | null;
  createdAt?: string | null;
};

/** Timestamp shown on a bubble, or null when there is nothing to render. */
export function bubbleTimeLabel(createdAt: string | null | undefined, timeZone?: string | null): string | null {
  if (!createdAt) return null;
  const label = formatInstant(createdAt, timeZone);
  return label === "—" ? null : label;
}

/** Id of the last bubble (scroll target). Empty threads have none. */
export function lastBubbleId(messages: ReadonlyArray<{ id: string }>): string | null {
  return messages.length === 0 ? null : messages[messages.length - 1]!.id;
}

// Friendly delivery-status labels — never show raw "undelivered · 30007" jargon.
const STATUS_LABEL: Record<string, string> = {
  queued: "Sending…",
  sending: "Sending…",
  sent: "Sent",
  delivered: "Delivered",
  undelivered: "Not delivered",
  failed: "Failed",
  received: "",
};
const friendlyStatus = (status: string | null): string =>
  status ? (STATUS_LABEL[status] ?? status) : "";

/** Calendar-day key for an instant in the org zone (default UTC for SSR). */
function dayKey(iso: string, timeZone?: string | null): string {
  try {
    return new Date(iso).toLocaleDateString("en-CA", { timeZone: timeZone ?? "UTC" });
  } catch {
    return iso.slice(0, 10);
  }
}

/** "Aug 22, 2026" separator label for an instant in the org zone. */
function dayLabel(iso: string, timeZone?: string | null): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short", day: "numeric", year: "numeric", timeZone: timeZone ?? "UTC",
    });
  } catch {
    return iso.slice(0, 10);
  }
}

export function MessageBubbles({
  messages,
  timeZone,
}: {
  messages: ThreadBubble[];
  timeZone?: string | null;
}) {
  const lastRef = useRef<HTMLLIElement | null>(null);
  const lastId = lastBubbleId(messages);

  // Newest bubble into view when the thread or last message changes.
  useEffect(() => {
    lastRef.current?.scrollIntoView({ block: "end" });
  }, [lastId, messages.length]);

  let prevDay: string | null = null;

  return (
    <ol className="flex flex-col gap-3">
      {messages.map((m, i) => {
        const side = BUBBLE[m.direction] ?? BUBBLE.inbound;
        const isLast = i === messages.length - 1;
        const when = bubbleTimeLabel(m.createdAt, timeZone);
        const day = m.createdAt ? dayKey(m.createdAt, timeZone) : null;
        const showDaySep = day != null && day !== prevDay;
        if (day) prevDay = day;
        const status = m.direction === "outbound" ? friendlyStatus(m.status) : "";
        const detail = [m.status, m.errorCode].filter(Boolean).join(" · ");
        return (
          <li
            key={m.id}
            ref={isLast ? lastRef : undefined}
            className="flex flex-col gap-3"
          >
            {showDaySep && m.createdAt ? (
              <div className="flex items-center gap-3 pt-1" aria-hidden="true">
                <span className="h-px flex-1 bg-border" />
                <span className="font-mono text-[10px] uppercase tracking-wide text-muted">
                  {dayLabel(m.createdAt, timeZone)}
                </span>
                <span className="h-px flex-1 bg-border" />
              </div>
            ) : null}
            <div className={`flex flex-col gap-0.5 ${side.wrap}`} title={detail || undefined}>
              <span className={`inline-block max-w-[85%] rounded-lg px-3 py-2 text-sm font-sans whitespace-pre-wrap ${side.bubble}`}>
                {m.body}
              </span>
              <span className="font-mono text-[11px] text-muted tabular-nums">
                <span className="sr-only">{m.direction}</span>
                {status ? <span>{status}</span> : null}
                {status && when ? " · " : ""}
                {when ?? ""}
              </span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
