// app/components/PromisesLedger.tsx
import { Form, Link } from "react-router";
import type { PromiseRow, PromiseTab, PromiseSort, PromiseDbStatus } from "../lib/promise-ledger";
import { formatUSD } from "../lib/format";
import { formatDate } from "../lib/dates";

export const PROMISE_STATUS_LABEL: Record<PromiseDbStatus, string> = {
  pending: "Pending", kept: "Kept", partially_kept: "Partial",
  broken: "Broken", renegotiated: "Renegotiated", cancelled: "Cancelled",
};
// Literal class strings for the Tailwind v4 scanner.
export const PROMISE_STATUS_CHIP: Record<PromiseDbStatus, string> = {
  pending: "bg-copper/10 text-copper",
  kept: "bg-cool/10 text-cool",
  partially_kept: "bg-copper/10 text-copper",
  broken: "bg-hot/10 text-hot",
  renegotiated: "bg-muted/10 text-muted",
  cancelled: "bg-muted/10 text-muted",
};

const TABS: { id: PromiseTab; label: string }[] = [
  { id: "active", label: "Active" },
  { id: "due-soon", label: "Due soon" },
  { id: "broken", label: "Broken" },
  { id: "kept", label: "Kept" },
  { id: "all", label: "All" },
];
const SORTS: { id: PromiseSort; label: string }[] = [
  { id: "due-date", label: "Due date" },
  { id: "amount", label: "Amount" },
  { id: "customer", label: "Customer (A–Z)" },
];

interface Props {
  rows: PromiseRow[];
  tab: PromiseTab;
  sort: PromiseSort;
  counts: Record<PromiseTab, number>;
  selectedId: string | null;
}

export function PromisesLedger({ rows, tab, sort, counts, selectedId }: Props) {
  const link = (promiseId: string) => `?${new URLSearchParams({ tab, sort, promiseId }).toString()}`;
  const tabHref = (id: PromiseTab) => `?${new URLSearchParams({ tab: id, sort }).toString()}`;

  return (
    <section className="flex flex-col bg-surface border border-border rounded-card overflow-hidden">
      <header className="flex flex-wrap items-center gap-3 px-4 py-3 bg-paper border-b border-border">
        <h2 className="font-display text-sm font-semibold text-text">Promises</h2>
        <span className="text-xs text-muted">{rows.length} matching</span>
        <Form method="get" className="ml-auto flex items-center gap-2">
          <input type="hidden" name="tab" value={tab} />
          {selectedId ? <input type="hidden" name="promiseId" value={selectedId} /> : null}
          <label className="sr-only" htmlFor="promise-sort">Sort</label>
          <select
            id="promise-sort" name="sort" defaultValue={sort}
            onChange={(e) => e.currentTarget.form?.requestSubmit()}
            className="h-8 px-2 rounded border border-border bg-surface text-sm"
          >
            {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </Form>
      </header>

      <nav className="flex flex-wrap gap-2 px-4 py-2 border-b border-border" aria-label="Promise lifecycle filters">
        {TABS.map((t) => {
          const active = t.id === tab;
          return (
            <Link
              key={t.id} to={tabHref(t.id)} aria-current={active ? "page" : undefined}
              className={[
                "inline-flex items-center gap-1.5 h-7 px-3 rounded-full text-xs font-medium border",
                active ? "bg-ink text-surface border-ink" : "bg-paper text-muted border-border hover:border-copper/50",
              ].join(" ")}
            >
              {t.label}
              <span className={active ? "text-surface/70" : "text-muted/70"}>{counts[t.id]}</span>
            </Link>
          );
        })}
      </nav>

      <div className="hidden md:grid grid-cols-[2fr_1fr_1fr_1.2fr_1fr] gap-3 px-4 py-2 bg-paper border-b border-border font-mono text-[10px] uppercase tracking-wide text-muted">
        <span>Customer</span><span className="text-right">Promised</span><span>Due</span><span>Received</span><span>Status</span>
      </div>

      {rows.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-muted">No promises in this view.</p>
      ) : (
        <ul role="list" className="divide-y divide-border">
          {rows.map((r) => {
            const selected = r.promiseId === selectedId;
            return (
              <li key={r.promiseId} className={selected ? "bg-copper/5" : ""}>
                <Link
                  to={link(r.promiseId)}
                  className={[
                    "relative grid grid-cols-1 md:grid-cols-[2fr_1fr_1fr_1.2fr_1fr] gap-1 md:gap-3 px-4 py-3 items-center",
                    "hover:bg-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper focus-visible:ring-inset",
                    r.superseded ? "opacity-60" : "",
                  ].join(" ")}
                  aria-current={selected ? "true" : undefined}
                >
                  {selected ? <span className="absolute left-0 inset-y-0 w-0.5 bg-copper" aria-hidden="true" /> : null}
                  <span className="font-medium text-text truncate">{r.customerName}</span>
                  <span className="text-sm text-text text-right tabular-nums">{formatUSD(r.promisedAmount)}</span>
                  <span className="text-sm text-muted">
                    {formatDate(r.promisedDate)}
                    {r.awaitingEvaluation ? <span className="ml-1 text-warm" title="Past grace — awaiting next sync">⏳</span> : null}
                  </span>
                  <span className="text-sm text-muted tabular-nums">{formatUSD(r.amountReceived)} / {formatUSD(r.promisedAmount)}</span>
                  <span>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${PROMISE_STATUS_CHIP[r.status]}`}>
                      {PROMISE_STATUS_LABEL[r.status]}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
