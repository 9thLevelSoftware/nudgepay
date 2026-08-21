// app/components/MessageBubbles.tsx
// Shared ascending SMS-thread bubble renderer. Extracted from DetailPanel so the
// dashboard detail panel and the Messages-tab quick-view render identically.
// Callers handle their own empty state; this renders the bubble list only.

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

  return (
    <ol className="flex flex-col gap-3">
      {messages.map((m, i) => {
        const side = BUBBLE[m.direction] ?? BUBBLE.inbound;
        const isLast = i === messages.length - 1;
        const when = bubbleTimeLabel(m.createdAt, timeZone);
        return (
          <li
            key={m.id}
            ref={isLast ? lastRef : undefined}
            className={`flex flex-col gap-0.5 ${side.wrap}`}
          >
            <span className={`inline-block max-w-[85%] rounded-lg px-3 py-2 text-sm font-sans whitespace-pre-wrap ${side.bubble}`}>
              {m.body}
            </span>
            <span className="font-mono text-[11px] text-muted">
              {m.direction}
              {m.status ? ` · ${m.status}` : ""}
              {m.errorCode ? ` · ${m.errorCode}` : ""}
              {when ? ` · ${when}` : ""}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
