// app/components/MessagesMetrics.tsx
import type { MessageMetrics } from "../lib/message-inbox";
import { MetricTile } from "./MetricTile";

export function MessagesMetrics({ metrics }: { metrics: MessageMetrics }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-6 sm:grid-cols-4" aria-label="Messages summary metrics">
      <MetricTile href="?tab=needs-reply"     label="Needs reply"     value={String(metrics.needsReply)}     sub="customer waiting on us" accent="copper" />
      <MetricTile href="?tab=needs-attention" label="Needs attention" value={String(metrics.needsAttention)} sub="delivery failed"        accent="hot" />
      <MetricTile href="?tab=active"          label="Active threads"  value={String(metrics.active)}         sub="open collection case"   accent="ink" />
      <MetricTile href="?tab=needs-reply"     label="Unanswered"      value={String(metrics.unanswered)}     sub="customer awaiting reply" accent="cool" />
    </div>
  );
}
