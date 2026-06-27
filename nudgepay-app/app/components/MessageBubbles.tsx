// app/components/MessageBubbles.tsx
// Shared ascending SMS-thread bubble renderer. Extracted from DetailPanel so the
// dashboard detail panel and the Messages-tab quick-view render identically.
// Callers handle their own empty state; this renders the bubble list only.

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
};

export function MessageBubbles({ messages }: { messages: ThreadBubble[] }) {
  return (
    <ol className="flex flex-col gap-3">
      {messages.map((m) => {
        const side = BUBBLE[m.direction] ?? BUBBLE.inbound;
        return (
          <li key={m.id} className={`flex flex-col gap-0.5 ${side.wrap}`}>
            <span className={`inline-block max-w-[85%] rounded-lg px-3 py-2 text-sm font-sans whitespace-pre-wrap ${side.bubble}`}>
              {m.body}
            </span>
            <span className="font-mono text-[11px] text-muted">
              {m.direction}
              {m.status ? ` · ${m.status}` : ""}
              {m.errorCode ? ` · ${m.errorCode}` : ""}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
