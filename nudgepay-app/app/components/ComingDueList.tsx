// Read-only "Coming Due" list — rendered inside WorkQueue when the coming-due
// view is active. No checkboxes, no bulk bar, no case selection. Grouped by
// customer with invoice sub-rows showing due-date proximity.

import { Link } from "react-router";
import type { ComingDueGroup } from "../lib/coming-due";
import { formatUSD } from "../lib/format";
import { Icon } from "./Icons";

function dueLabel(daysUntilDue: number): string {
  if (daysUntilDue === 0) return "Due today";
  if (daysUntilDue === 1) return "Due tomorrow";
  return `Due in ${daysUntilDue}d`;
}

function dueTone(daysUntilDue: number): string {
  if (daysUntilDue === 0) return "text-hot";
  if (daysUntilDue <= 2) return "text-amber-600";
  return "text-muted";
}

export function ComingDueList({ groups }: { groups: ComingDueGroup[] }) {
  if (groups.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 px-6 text-center">
        <div className="w-10 h-10 rounded-full bg-paper flex items-center justify-center">
          <Icon name="check" size={20} className="text-emerald-600" />
        </div>
        <p className="font-sans text-text font-medium">No invoices coming due in the next 7 days.</p>
        <p className="font-sans text-sm text-muted max-w-xs">
          Check back later, or switch to another view.
        </p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-border">
      {/* Awareness banner */}
      <div className="px-4 py-2.5 bg-sky-50 border-b border-sky-100 text-xs text-sky-800 font-sans">
        <Icon name="alert" size={14} className="inline-block mr-1.5 align-[-2px]" />
        Awareness only — these accounts are not in the collections queue.
      </div>

      {groups.map((g) => (
        <div key={g.customerId} className="px-4 py-3 hover:bg-paper transition-colors">
          {/* Customer header */}
          <div className="flex items-baseline justify-between gap-4">
            <Link
              to={`/accounts/${g.customerId}`}
              className="font-sans text-sm font-semibold text-text hover:text-copper truncate"
            >
              {g.customerName}
            </Link>
            <span className="font-mono text-sm text-text whitespace-nowrap">
              {formatUSD(g.totalBalance)}
            </span>
          </div>

          {/* Invoice sub-rows */}
          <div className="mt-1.5 space-y-0.5">
            {g.invoices.map((inv) => (
              <div
                key={inv.invoiceId}
                className="flex items-center justify-between gap-4 pl-3 text-xs font-sans"
              >
                <span className="text-muted truncate">
                  {inv.docNumber ? `#${inv.docNumber}` : "(no invoice #)"}
                </span>
                <div className="flex items-center gap-3">
                  <span className="font-mono text-text">
                    {formatUSD(inv.balance)}
                  </span>
                  <span className={`font-medium whitespace-nowrap ${dueTone(inv.daysUntilDue)}`}>
                    {dueLabel(inv.daysUntilDue)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
