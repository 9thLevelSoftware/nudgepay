// app/components/PromisesLedger.tsx
import { Form, Link } from "react-router";
import { Icon } from "./Icons";
import type { PromiseRow, PromiseTab, PromiseSort, PromiseDbStatus } from "../lib/promise-ledger";
import { formatUSD } from "../lib/format";
import { formatDate } from "../lib/dates";
import { useSearchShortcut } from "../lib/use-search-shortcut";

export const PROMISE_STATUS_LABEL: Record<PromiseDbStatus, string> = {
  pending: "Pending", kept: "Kept", partially_kept: "Partial",
  broken: "Broken", renegotiated: "Renegotiated", cancelled: "Cancelled",
};
// Literal class strings for the Tailwind v4 scanner.
// copper = active commitment; cool = positive/outcome; warm = amber partial.
export const PROMISE_STATUS_CHIP: Record<PromiseDbStatus, string> = {
  pending: "bg-copper/10 text-copper",
  kept: "bg-cool/10 text-cool",
  partially_kept: "bg-warm/10 text-warm",
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
  search: string;
  counts: Record<PromiseTab, number>;
  selectedId: string | null;
  loadError?: string | null;
  truncated?: boolean;
}

/** Compact received-vs-promised progress: fill bar + % + amounts. */
function ReceivedProgress({ received, promised }: { received: number | null; promised: number }) {
  if (received == null) {
    return <span className="text-sm text-muted tabular-nums truncate">— received</span>;
  }
  if (promised <= 0) {
    return (
      <span className="flex min-w-0 flex-col gap-1">
        <span className="text-sm text-muted tabular-nums truncate">{formatUSD(received)} received</span>
        <span className="text-[11px] font-medium text-cool">No amount promised</span>
      </span>
    );
  }
  const pct = Math.min(100, Math.round((received / promised) * 100));
  return (
    <span className="flex flex-col gap-1 min-w-0">
      <span className="flex items-baseline justify-between gap-2">
        <span className="text-sm text-muted tabular-nums truncate">
          {formatUSD(received)} / {formatUSD(promised)}
        </span>
        <span className="font-mono text-[11px] font-semibold text-muted tabular-nums shrink-0">{pct}%</span>
      </span>
      <span
        role="progressbar"
        aria-label={`Received ${formatUSD(received)} of ${formatUSD(promised)}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        className="h-1 w-full rounded-full bg-border/60 overflow-hidden"
      >
        <span
          className={`block h-full rounded-full ${pct >= 100 ? "bg-cool" : "bg-copper"}`}
          style={{ width: `${pct}%` }}
        />
      </span>
    </span>
  );
}

export function PromisesLedger({ rows, tab, sort, search, counts, selectedId, loadError = null, truncated = false }: Props) {
  const searchRef = useSearchShortcut();
  const params = (over: Record<string, string>) => {
    const p = new URLSearchParams({ tab, sort, ...over });
    if (search) p.set("q", search);
    return `?${p.toString()}`;
  };
  const link = (promiseId: string) => params({ promiseId });
  const tabHref = (id: PromiseTab) => params({ tab: id });

  return (
    <section className="flex flex-col bg-surface border border-border rounded-card overflow-hidden">
      <header className="flex flex-wrap items-center gap-3 px-4 py-3 bg-paper border-b border-border">
        <h2 className="font-display text-sm font-semibold text-text">Promises</h2>
        <span className="text-xs text-muted">{rows.length} matching</span>
        <div className="ml-auto flex items-center gap-2">
          <Form method="get" className="flex items-center gap-2">
            <input type="hidden" name="tab" value={tab} />
            <input type="hidden" name="sort" value={sort} />
            {selectedId ? <input type="hidden" name="promiseId" value={selectedId} /> : null}
            <label className="flex items-center gap-1.5 rounded-md border border-border bg-panel px-2.5 h-9 text-sm text-text focus-within:ring-2 focus-within:ring-copper focus-within:border-transparent transition-shadow cursor-pointer">
              <Icon name="search" size={14} className="text-muted shrink-0" />
              <span className="sr-only">Search promises</span>
              <input
                ref={searchRef}
                type="search" name="q" defaultValue={search} placeholder="Search customer…"
                className="w-40 bg-transparent text-sm placeholder:text-muted focus-visible:outline-none"
              />
            </label>
            <button type="submit" className="h-9 px-3 rounded bg-ink text-surface text-xs font-medium">Search</button>
          </Form>
          <Form method="get" className="flex items-center gap-2">
            <input type="hidden" name="tab" value={tab} />
            {search ? <input type="hidden" name="q" value={search} /> : null}
            {selectedId ? <input type="hidden" name="promiseId" value={selectedId} /> : null}
            <label className="sr-only" htmlFor="promise-sort">Sort</label>
            <select
              id="promise-sort" name="sort" defaultValue={sort}
              onChange={(e) => e.currentTarget.form?.requestSubmit()}
              className="h-9 px-2 rounded border border-border bg-surface text-sm"
            >
              {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </Form>
        </div>
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

      <div className="hidden md:grid grid-cols-[2fr_1fr_1fr_1.2fr_1fr] gap-3 px-4 py-2 bg-paper border-b border-border font-mono text-[11px] uppercase tracking-wide text-muted">
        <span>Customer</span><span className="text-right">Promised</span><span>Due</span><span>Received</span><span>Status</span>
      </div>

      {rows.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-muted">
          {loadError
            ? loadError
            : truncated
              ? "Promise list may be incomplete."
              : search
                ? <>No promises match <span className="font-medium text-text">“{search}”</span> in this view.</>
                : "No promises in this view."}
        </p>
      ) : (
        <ul role="list" className="divide-y divide-border">
          {rows.map((r) => {
            const selected = r.promiseId === selectedId;
            return (
              <li key={r.promiseId} className={selected ? "bg-copper/10" : ""}>
                <Link
                  to={link(r.promiseId)}
                  className={[
                    "relative grid grid-cols-1 md:grid-cols-[2fr_1fr_1fr_1.2fr_1fr] gap-1 md:gap-3 px-4 py-3 items-center",
                    "hover:bg-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper focus-visible:ring-inset",
                    r.superseded ? "opacity-60" : "",
                    selected ? "ring-1 ring-inset ring-copper/30" : "",
                  ].join(" ")}
                  aria-current={selected ? "true" : undefined}
                >
                  {selected ? <span className="absolute left-0 inset-y-0 w-0.5 bg-copper" aria-hidden="true" /> : null}
                  <span className="font-medium text-text truncate">{r.customerName}</span>
                  <span className="text-sm text-text text-right tabular-nums">{formatUSD(r.promisedAmount)}</span>
                  <span className="text-sm text-muted">
                    {formatDate(r.promisedDate)}
                    {r.awaitingEvaluation ? (
                      <Icon name="clock" size={13} className="ml-1 inline text-warm" title="Past grace — awaiting next sync" />
                    ) : null}
                  </span>
                  <ReceivedProgress received={r.amountReceived} promised={r.promisedAmount} />
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
