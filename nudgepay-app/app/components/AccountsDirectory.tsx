// app/components/AccountsDirectory.tsx
import { Form, Link } from "react-router";
import type { AccountRow, AccountStanding, AccountFilter, AccountSort } from "../lib/accounts";
import { formatUSD } from "../lib/format";
import { formatDate } from "../lib/dates";

export const STANDING_LABEL: Record<AccountStanding, string> = {
  current: "Current", overdue: "Overdue", in_collections: "In collections", on_hold: "On hold",
};
// Literal class strings for the Tailwind v4 scanner.
export const STANDING_CHIP: Record<AccountStanding, string> = {
  current: "bg-cool/10 text-cool",
  overdue: "bg-warm/10 text-warm",
  in_collections: "bg-copper/10 text-copper",
  on_hold: "bg-muted/10 text-muted",
};

const FILTER_TABS: { id: AccountFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "open-balance", label: "Open balance" },
  { id: "paid-up", label: "Paid up" },
  { id: "unassigned", label: "Unassigned" },
  { id: "on-hold", label: "On hold" },
];
const SORTS: { id: AccountSort; label: string }[] = [
  { id: "name", label: "Name (A–Z)" },
  { id: "balance", label: "Open balance" },
  { id: "last-contact", label: "Last contact" },
];

interface Props {
  rows: AccountRow[];
  filter: AccountFilter;
  sort: AccountSort;
  search: string;
  counts: Record<AccountFilter, number>;
  selectedId: string | null;
}

export function AccountsDirectory({ rows, filter, sort, search, counts, selectedId }: Props) {
  const link = (customerId: string) => {
    const p = new URLSearchParams({ filter, sort, ...(search ? { q: search } : {}) });
    p.set("customerId", customerId);
    return `?${p.toString()}`;
  };
  const tabHref = (id: AccountFilter) => {
    const p = new URLSearchParams({ filter: id, sort, ...(search ? { q: search } : {}) });
    return `?${p.toString()}`;
  };

  return (
    <section className="flex flex-col bg-surface border border-border rounded-card overflow-hidden">
      {/* Header band (paper) */}
      <header className="flex flex-wrap items-center gap-3 px-4 py-3 bg-paper border-b border-border">
        <h2 className="font-display text-sm font-semibold text-text">Accounts</h2>
        <span className="text-xs text-muted">{rows.length} matching</span>
        <Form method="get" className="ml-auto flex items-center gap-2">
          {/* Preserve filter+sort across a search submit */}
          <input type="hidden" name="filter" value={filter} />
          <input type="hidden" name="sort" value={sort} />
          <input
            type="search" name="q" defaultValue={search} placeholder="Search name, phone, email…"
            className="h-8 w-48 px-2 rounded border border-border bg-surface text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
          />
          <button type="submit" className="h-8 px-3 rounded bg-ink text-surface text-xs font-medium">Search</button>
        </Form>
        <Form method="get" className="flex items-center gap-2">
          <input type="hidden" name="filter" value={filter} />
          {search ? <input type="hidden" name="q" value={search} /> : null}
          <label className="sr-only" htmlFor="acct-sort">Sort</label>
          <select
            id="acct-sort" name="sort" defaultValue={sort}
            onChange={(e) => e.currentTarget.form?.requestSubmit()}
            className="h-8 px-2 rounded border border-border bg-surface text-sm"
          >
            {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </Form>
      </header>

      {/* Pill filter tabs with count badges */}
      <nav className="flex flex-wrap gap-2 px-4 py-2 border-b border-border" aria-label="Account filters">
        {FILTER_TABS.map((t) => {
          const active = t.id === filter;
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

      {/* Column header (paper, mono uppercase) */}
      <div className="hidden md:grid grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-3 px-4 py-2 bg-paper border-b border-border font-mono text-[10px] uppercase tracking-wide text-muted">
        <span>Customer</span><span>Standing</span><span>Owner</span><span className="text-right">Open balance</span><span>Last contact</span>
      </div>

      {/* Rows */}
      {rows.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-muted">No accounts match this filter.</p>
      ) : (
        <ul role="list" className="divide-y divide-border">
          {rows.map((r) => {
            const selected = r.customerId === selectedId;
            return (
              <li key={r.customerId} className={selected ? "bg-copper/5" : ""}>
                <Link
                  to={link(r.customerId)}
                  className="relative grid grid-cols-1 md:grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-1 md:gap-3 px-4 py-3 items-center hover:bg-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper focus-visible:ring-inset"
                  aria-current={selected ? "true" : undefined}
                >
                  {selected ? <span className="absolute left-0 inset-y-0 w-0.5 bg-copper" aria-hidden="true" /> : null}
                  <span className="font-medium text-text truncate">{r.name}</span>
                  <span><span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STANDING_CHIP[r.standing]}`}>{STANDING_LABEL[r.standing]}</span></span>
                  <span className="text-sm text-muted truncate">{r.owner}</span>
                  <span className="text-sm text-text text-right tabular-nums">{formatUSD(r.openBalance)}</span>
                  <span className="text-sm text-muted">{r.lastContact ? `${r.lastContact.channel} · ${formatDate(r.lastContact.date)}` : "—"}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
