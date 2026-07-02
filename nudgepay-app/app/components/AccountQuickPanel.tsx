// app/components/AccountQuickPanel.tsx
import { Link } from "react-router";
import type { AccountRow } from "../lib/accounts";
import { formatUSD } from "../lib/format";
import { STANDING_LABEL, STANDING_CHIP } from "./AccountsDirectory";
import { Icon } from "./Icons";

export function AccountQuickPanel({ account }: { account: AccountRow | null }) {
  if (!account) {
    return (
      <aside className="hidden lg:flex flex-col items-center justify-center bg-surface border border-border rounded-card p-8 text-center text-muted">
        <Icon name="user" size={28} className="mb-2 text-muted/60" />
        <p className="text-sm">Select an account to preview it here.</p>
      </aside>
    );
  }
  return (
    <aside className="flex flex-col bg-surface border border-border rounded-card overflow-hidden">
      <header className="bg-ink text-surface px-4 py-3">
        <p className="font-mono text-[10px] uppercase tracking-wide text-surface/50">Account</p>
        <h2 className="font-display text-lg font-semibold leading-tight">{account.name}</h2>
        <span className={`mt-1 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STANDING_CHIP[account.standing]}`}>
          {STANDING_LABEL[account.standing]}
        </span>
      </header>
      <div className="grid grid-cols-2 gap-3 p-4 bg-paper border-b border-border">
        <div><p className="font-mono text-[11px] uppercase text-muted">Open balance</p><p className="font-display text-lg text-text tabular-nums">{formatUSD(account.openBalance)}</p></div>
        <div><p className="font-mono text-[11px] uppercase text-muted">Open invoices</p><p className="font-display text-lg text-text tabular-nums">{account.openInvoiceCount}</p></div>
      </div>
      <dl className="p-4 space-y-2 text-sm">
        <div className="flex justify-between"><dt className="text-muted">Owner</dt><dd className="text-text">{account.owner}</dd></div>
        <div className="flex justify-between"><dt className="text-muted">Phone</dt><dd className="text-text">{account.phone ?? "—"}</dd></div>
        <div className="flex justify-between"><dt className="text-muted">Email</dt><dd className="text-text truncate max-w-[60%]">{account.email ?? "—"}</dd></div>
      </dl>
      <div className="p-4 border-t border-border">
        <Link
          to={`/accounts/${account.customerId}`}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded bg-copper text-ink text-sm font-medium hover:bg-copper/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
        >
          Open full profile <Icon name="chevronRight" size={16} />
        </Link>
      </div>
    </aside>
  );
}
