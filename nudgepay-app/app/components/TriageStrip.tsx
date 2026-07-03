// TriageStrip — "Start here" top-3 triage cards above the work queue.
// Shows the highest-leverage actionable cases from pickTriage, with a
// Why-now summary and heat accent. Clicking a card opens the case in
// the detail panel. Hidden when there are no actionable cases.

import { Link } from "react-router";
import type { CaseItem } from "../lib/cases";
import type { ViewId, SortId } from "../lib/worklist";
import { pickTriage } from "../lib/next-best-action";
import { whyNow } from "../lib/next-best-action";
import { formatUSD } from "../lib/format";

// Heat band → left border. Tailwind v4 scanner requires literal strings.
const BORDER: Record<string, string> = {
  hot: "border-l-hot",
  warm: "border-l-warm",
  cool: "border-l-cool",
};

interface TriageStripProps {
  items: CaseItem[];
  view: ViewId;
  sort: SortId;
  search: string;
}

export function TriageStrip({ items, view, sort, search }: TriageStripProps) {
  const top = pickTriage(items, 3);
  if (top.length === 0) return null;

  return (
    <div className="px-6 py-3 border-b border-border bg-paper">
      <p className="text-[10px] font-mono font-semibold uppercase tracking-wider text-muted mb-2">
        Start here
      </p>
      <div className="flex gap-3 overflow-x-auto snap-x snap-mandatory scrollbar-none">
        {top.map((item) => {
          const nba = whyNow(item);
          const params = new URLSearchParams({
            case: item.caseId,
            view,
            sort,
            ...(search ? { q: search } : {}),
          });
          const border = BORDER[item.heat.band] ?? "border-l-muted";
          return (
            <Link
              key={item.caseId}
              to={`?${params.toString()}`}
              className={[
                "snap-start shrink-0 flex flex-col gap-1 rounded-lg border border-l-[3px] bg-surface px-4 py-3 min-w-[200px] max-w-[280px]",
                "hover:border-copper/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper transition-colors",
                border,
              ].join(" ")}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="font-sans text-sm font-semibold text-text truncate">
                  {item.customerName}
                </span>
                <span className="font-mono text-xs text-copper font-semibold tabular-nums shrink-0">
                  {formatUSD(item.totalOverdue)}
                </span>
              </span>
              <span className="text-xs font-sans font-medium text-text leading-snug line-clamp-1">
                {nba.headline}
              </span>
              {nba.reason && (
                <span className="text-[11px] text-muted leading-relaxed line-clamp-1">
                  {nba.reason}
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
