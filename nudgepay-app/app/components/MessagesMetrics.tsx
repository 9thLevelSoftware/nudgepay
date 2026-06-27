// app/components/MessagesMetrics.tsx
import { Link } from "react-router";
import type { MessageMetrics } from "../lib/message-inbox";

type Accent = "copper" | "hot" | "ink" | "cool";
const ACCENT_TEXT: Record<Accent, string> = { copper: "text-copper", hot: "text-hot", ink: "text-text", cool: "text-cool" };
const ACCENT_DOT: Record<Accent, string> = { copper: "bg-copper", hot: "bg-hot", ink: "bg-ink", cool: "bg-cool" };

function Tile({ to, label, value, sub, accent }: { to: string; label: string; value: string; sub: string; accent: Accent }) {
  return (
    <Link
      to={to}
      className="relative flex flex-col p-4 rounded-tile overflow-hidden min-w-0 bg-paper border border-border hover:border-copper/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
    >
      <span aria-hidden="true" className={`absolute top-0 inset-x-0 h-0.5 ${ACCENT_DOT[accent]}`} />
      <span className="flex items-center gap-1.5 mb-2">
        <span aria-hidden="true" className={`w-2 h-2 rounded-full shrink-0 ${ACCENT_DOT[accent]}`} />
        <span className="font-mono text-[10px] font-semibold uppercase tracking-wide text-muted truncate">{label}</span>
      </span>
      <span className="font-display text-2xl font-semibold leading-none tracking-tight tabular-nums text-text">{value}</span>
      <span className={`mt-1.5 text-xs ${ACCENT_TEXT[accent]}`}>{sub}</span>
    </Link>
  );
}

export function MessagesMetrics({ metrics }: { metrics: MessageMetrics }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-6 sm:grid-cols-4" aria-label="Messages summary metrics">
      <Tile to="?tab=needs-reply"     label="Needs reply"     value={String(metrics.needsReply)}     sub="customer waiting on us" accent="copper" />
      <Tile to="?tab=needs-attention" label="Needs attention" value={String(metrics.needsAttention)} sub="delivery failed"        accent="hot" />
      <Tile to="?tab=active"          label="Active threads"  value={String(metrics.active)}         sub="open collection case"   accent="ink" />
      <Tile to="?tab=all"             label="Unanswered"      value={String(metrics.unanswered)}     sub="threads with replies"   accent="cool" />
    </div>
  );
}
