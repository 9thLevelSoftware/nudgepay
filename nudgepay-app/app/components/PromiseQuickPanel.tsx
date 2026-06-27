// app/components/PromiseQuickPanel.tsx
import { Link } from "react-router";
import type { PromiseRow, PromiseLinkedInvoice } from "../lib/promise-ledger";
import { formatUSD } from "../lib/format";
import { formatDate } from "../lib/dates";
import { PROMISE_STATUS_LABEL, PROMISE_STATUS_CHIP } from "./PromisesLedger";
import { Icon } from "./Icons";

interface Props {
  promise: PromiseRow | null;
  invoices: PromiseLinkedInvoice[];
  note: string | null;
}

export function PromiseQuickPanel({ promise, invoices, note }: Props) {
  if (!promise) {
    return (
      <aside className="hidden lg:flex flex-col items-center justify-center bg-surface border border-border rounded-card p-8 text-center text-muted">
        <Icon name="check" size={28} className="mb-2 text-muted/60" />
        <p className="text-sm">Select a promise to preview it here.</p>
      </aside>
    );
  }
  return (
    <aside className="flex flex-col bg-surface border border-border rounded-card overflow-hidden">
      <header className="bg-ink text-surface px-4 py-3">
        <p className="font-mono text-[10px] uppercase tracking-wide text-surface/50">Promise</p>
        <h2 className="font-display text-lg font-semibold leading-tight">{promise.customerName}</h2>
        <span className={`mt-1 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${PROMISE_STATUS_CHIP[promise.status]}`}>
          {PROMISE_STATUS_LABEL[promise.status]}
        </span>
        {promise.awaitingEvaluation ? (
          <p className="mt-1.5 text-[11px] text-warm">Past grace — awaiting the next sync to settle.</p>
        ) : null}
      </header>

      <div className="grid grid-cols-2 gap-3 p-4 bg-paper border-b border-border">
        <div><p className="font-mono text-[10px] uppercase text-muted">Promised</p><p className="font-display text-lg text-text tabular-nums">{formatUSD(promise.promisedAmount)}</p></div>
        <div><p className="font-mono text-[10px] uppercase text-muted">Received</p><p className="font-display text-lg text-text tabular-nums">{formatUSD(promise.amountReceived)}</p></div>
      </div>

      <dl className="p-4 space-y-2 text-sm border-b border-border">
        <div className="flex justify-between"><dt className="text-muted">Promised date</dt><dd className="text-text">{formatDate(promise.promisedDate)}</dd></div>
        <div className="flex justify-between"><dt className="text-muted">Grace until</dt><dd className="text-text">{formatDate(promise.graceUntil)}</dd></div>
        <div className="flex justify-between"><dt className="text-muted">Baseline balance</dt><dd className="text-text tabular-nums">{formatUSD(promise.baselineBalance)}</dd></div>
        <div className="flex justify-between"><dt className="text-muted">Outstanding</dt><dd className="text-text tabular-nums">{formatUSD(promise.outstanding)}</dd></div>
        <div className="flex justify-between"><dt className="text-muted">Owner</dt><dd className="text-text">{promise.owner}</dd></div>
      </dl>

      <div className="p-4 border-b border-border">
        <p className="font-mono text-[10px] uppercase text-muted mb-2">Linked invoices</p>
        {invoices.length === 0 ? (
          <p className="text-sm text-muted">No linked invoices.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {invoices.map((inv) => (
              <li key={inv.invoiceId} className="flex justify-between">
                <span className="text-text">#{inv.docNumber ?? inv.invoiceId.slice(0, 8)}</span>
                <span className="text-muted tabular-nums">{formatUSD(inv.balance)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {note ? (
        <div className="p-4 border-b border-border">
          <p className="font-mono text-[10px] uppercase text-muted mb-1">Originating note</p>
          <p className="text-sm text-text whitespace-pre-wrap">{note}</p>
        </div>
      ) : null}

      <div className="p-4 flex flex-wrap gap-2">
        {promise.caseOpen ? (
          <Link
            to={`/dashboard?case=${promise.caseId}`}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded bg-copper text-surface text-sm font-medium hover:bg-copper/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
          >
            Open in Collections <Icon name="chevronRight" size={16} />
          </Link>
        ) : (
          <span className="inline-flex items-center h-9 px-3 rounded border border-border text-muted text-sm">
            Case closed — history in account
          </span>
        )}
        <Link
          to={`/accounts/${promise.customerId}`}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded border border-border text-text text-sm font-medium hover:border-copper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
        >
          View account
        </Link>
      </div>
    </aside>
  );
}
