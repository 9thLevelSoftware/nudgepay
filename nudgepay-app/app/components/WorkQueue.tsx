import { Form, Link } from "react-router";
import type { WorkItem, ViewId, SortId, NextAction } from "../lib/worklist";
import { ThermalBand } from "./ThermalBand";
import { Icon } from "./Icons";

// ---------------------------------------------------------------------------
// Static maps — Tailwind v4 scanner requires literal class strings; no template
// interpolation like `text-${tone}` is allowed.
// ---------------------------------------------------------------------------

/** NextAction.tone → text-color class */
const nextActionToneClass: Record<NextAction["tone"], string> = {
  hot:     "text-hot",
  warm:    "text-warm",
  cool:    "text-cool",
  neutral: "text-muted",
};

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

function fmtDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ---------------------------------------------------------------------------
// Saved-view tab definitions (5a set)
// ---------------------------------------------------------------------------

const SAVED_VIEWS: { id: ViewId; label: string }[] = [
  { id: "all-open",         label: "All open" },
  { id: "30-plus",          label: "30+ days" },
  { id: "high-value",       label: "High value" },
  { id: "never-contacted",  label: "Never contacted" },
  { id: "follow-ups-due",   label: "Follow-ups due" },
  { id: "broken-promises",  label: "Broken promises" },
];

const SORT_OPTIONS: { id: SortId; label: string }[] = [
  { id: "recommended",    label: "Recommended" },
  { id: "most-overdue",   label: "Most overdue" },
  { id: "highest-balance", label: "Highest balance" },
  { id: "customer",       label: "Customer" },
];

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface WorkQueueProps {
  items: WorkItem[];
  view: ViewId;
  sort: SortId;
  search: string;
  selectedInvoiceId: string | null;
  totalCount: number;
  viewCounts: Record<ViewId, number>;
}

// ---------------------------------------------------------------------------
// Row — <Link> styled as a table row; keyboard-focusable, copper focus ring.
// ---------------------------------------------------------------------------

function QueueRow({
  item,
  selected,
  view,
  sort,
  search,
}: {
  item: WorkItem;
  selected: boolean;
  view: ViewId;
  sort: SortId;
  search: string;
}) {
  const params = new URLSearchParams({
    invoice: item.invoiceId,
    view,
    sort,
    ...(search ? { q: search } : {}),
  });
  const href = `?${params.toString()}`;

  const toneClass = nextActionToneClass[item.nextAction.tone];

  return (
    <Link
      to={href}
      aria-label={`Open ${item.customerName} invoice ${item.docNumber ?? item.invoiceId}`}
      aria-current={selected ? "true" : undefined}
      className={[
        // Base row layout
        "group grid grid-cols-[auto_1fr_auto_auto_auto_auto_auto] items-center gap-x-4 gap-y-0",
        "border-b border-border px-4 py-3 text-sm",
        "transition-colors duration-100",
        // Focus ring
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper focus-visible:ring-inset",
        // Hover
        "hover:bg-panel",
        // Selected: copper left border + tint
        selected
          ? "border-l-2 border-l-copper bg-copper/5"
          : "border-l-2 border-l-transparent",
      ].join(" ")}
    >
      {/* Heat */}
      <span data-label="Heat" className="hidden md:flex">
        <ThermalBand heat={item.heat} />
      </span>

      {/* Customer / invoice */}
      <span data-label="Customer / invoice" className="min-w-0">
        <span className="block font-sans text-text truncate">{item.customerName}</span>
        {item.docNumber && (
          <span className="block font-mono text-xs text-muted">{item.docNumber}</span>
        )}
      </span>

      {/* Balance */}
      <span
        data-label="Balance"
        className="font-mono text-text tabular-nums text-right hidden md:block"
      >
        {usd.format(item.balance)}
      </span>

      {/* Age */}
      <span
        data-label="Age"
        className="font-mono text-sm text-muted tabular-nums hidden md:block whitespace-nowrap"
      >
        {item.ageDays > 0 ? `${item.ageDays}d` : "Due"}
      </span>

      {/* Last contact */}
      <span data-label="Last contact" className="hidden lg:block min-w-0">
        {item.lastContact ? (
          <>
            <span className="block text-text text-xs">{fmtDate(item.lastContact.date)}</span>
            <span className="block text-muted text-xs capitalize">{item.lastContact.channel}</span>
          </>
        ) : (
          <span className="text-muted text-xs">Never contacted</span>
        )}
      </span>

      {/* Next action */}
      <span
        data-label="Next action"
        className={`hidden lg:block text-xs font-sans font-medium whitespace-nowrap ${toneClass}`}
      >
        {item.nextAction.label}
      </span>

      {/* Owner chip */}
      <span
        data-label="Owner"
        className="hidden xl:inline-flex items-center gap-1 rounded-full bg-panel border border-border px-2 py-0.5 text-xs text-muted font-sans whitespace-nowrap"
      >
        <Icon name="user" size={12} aria-hidden />
        {item.owner}
      </span>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Mobile card — rendered under md breakpoint via CSS
// ---------------------------------------------------------------------------

function MobileCard({
  item,
  selected,
  view,
  sort,
  search,
}: {
  item: WorkItem;
  selected: boolean;
  view: ViewId;
  sort: SortId;
  search: string;
}) {
  const params = new URLSearchParams({
    invoice: item.invoiceId,
    view,
    sort,
    ...(search ? { q: search } : {}),
  });
  const href = `?${params.toString()}`;
  const toneClass = nextActionToneClass[item.nextAction.tone];

  return (
    <Link
      to={href}
      aria-label={`Open ${item.customerName} invoice ${item.docNumber ?? item.invoiceId}`}
      aria-current={selected ? "true" : undefined}
      className={[
        "block bg-surface border border-border rounded-lg p-4 mb-2",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper",
        selected ? "border-copper ring-1 ring-copper bg-copper/5" : "",
      ].join(" ")}
    >
      {/* Row 1: ThermalBand + customer name + balance */}
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <ThermalBand heat={item.heat} />
          <div className="min-w-0">
            <p className="font-sans text-text font-medium truncate">{item.customerName}</p>
            {item.docNumber && (
              <p className="font-mono text-xs text-muted">{item.docNumber}</p>
            )}
          </div>
        </div>
        <span className="font-mono text-text tabular-nums text-right shrink-0 text-sm">
          {usd.format(item.balance)}
        </span>
      </div>

      {/* Row 2: Age + next action */}
      <div className="flex items-center gap-3 text-xs">
        <span className="font-mono text-muted tabular-nums">
          {item.ageDays > 0 ? `${item.ageDays}d` : "Due"}
        </span>
        <span className={`font-sans font-medium ${toneClass}`}>{item.nextAction.label}</span>
      </div>

      {/* Row 3: Last contact */}
      <div className="mt-1 text-xs">
        {item.lastContact ? (
          <span className="text-muted">
            {fmtDate(item.lastContact.date)} · {item.lastContact.channel}
          </span>
        ) : (
          <span className="text-muted">Never contacted</span>
        )}
      </div>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// WorkQueue
// ---------------------------------------------------------------------------

/**
 * WorkQueue — toolbar + responsive thermal table for the collections workspace.
 *
 * Navigation is entirely GET-form + Link based (no client state for data).
 * Under md breakpoint: stacked cards with all fields visible.
 * At md+: a dense table with Heat | Customer/Invoice | Balance | Age | Last contact | Next action | Owner.
 */
export function WorkQueue({
  items,
  view,
  sort,
  search,
  selectedInvoiceId,
  totalCount,
  viewCounts,
}: WorkQueueProps) {
  return (
    <section className="flex flex-col min-h-0" aria-labelledby="work-queue-title">
      {/* Header */}
      <div className="flex flex-col gap-0.5 px-4 pt-4 pb-2 border-b border-border bg-surface">
        <h2
          id="work-queue-title"
          className="font-display text-xl font-semibold text-text leading-tight"
        >
          Work queue
        </h2>
        <p className="font-sans text-xs text-muted">
          {items.length} matching · {totalCount} open
        </p>
      </div>

      {/* Toolbar — GET form; submit preserves view via hidden input */}
      <Form
        method="get"
        className="flex flex-wrap items-center gap-2 px-4 py-2.5 border-b border-border bg-surface"
      >
        {/* Preserve active view when submitting search/sort */}
        <input type="hidden" name="view" value={view} />

        {/* Search input */}
        <label className="flex items-center gap-1.5 flex-1 min-w-48 rounded-md border border-border bg-panel px-2.5 py-1.5 text-sm text-text focus-within:ring-2 focus-within:ring-copper focus-within:border-transparent transition-shadow">
          <Icon name="search" size={15} className="text-muted shrink-0" />
          <span className="sr-only">Search queue</span>
          <input
            name="q"
            type="search"
            defaultValue={search}
            placeholder="Search customers, invoices…"
            className="flex-1 bg-transparent border-none outline-none font-sans text-sm text-text placeholder:text-muted"
          />
        </label>

        {/* Sort select */}
        <label className="flex items-center gap-1.5 rounded-md border border-border bg-panel px-2.5 py-1.5 text-sm text-text focus-within:ring-2 focus-within:ring-copper focus-within:border-transparent transition-shadow cursor-pointer">
          <Icon name="arrowDownUp" size={15} className="text-muted shrink-0" />
          <span className="sr-only">Sort work queue</span>
          <select
            name="sort"
            defaultValue={sort}
            className="bg-transparent border-none outline-none font-sans text-sm text-text cursor-pointer"
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        {/* Submit (visible for no-JS; hidden from sighted users via sr-only is too aggressive — keep small) */}
        <button
          type="submit"
          className="rounded-md border border-border bg-panel px-3 py-1.5 text-xs font-sans text-muted hover:text-text hover:border-copper transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
        >
          Apply
        </button>
      </Form>

      {/* Saved-view tabs */}
      <div
        role="tablist"
        aria-label="Saved queue views"
        className="flex overflow-x-auto gap-0 border-b border-border bg-surface px-4 scrollbar-none"
      >
        {SAVED_VIEWS.map((sv) => {
          const isActive = view === sv.id;
          const params = new URLSearchParams({
            view: sv.id,
            sort,
            ...(search ? { q: search } : {}),
          });
          return (
            <Link
              key={sv.id}
              to={`?${params.toString()}`}
              role="tab"
              aria-selected={isActive ? "true" : "false"}
              className={[
                "flex items-center gap-1.5 px-3 py-2.5 text-sm font-sans whitespace-nowrap border-b-2 -mb-px transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper focus-visible:ring-inset",
                isActive
                  ? "border-copper text-copper font-medium"
                  : "border-transparent text-muted hover:text-text hover:border-border",
              ].join(" ")}
            >
              {sv.label}
              <span
                className={`font-mono text-xs rounded-full px-1.5 py-0.5 tabular-nums ${
                  isActive ? "bg-copper/10 text-copper" : "bg-panel text-muted"
                }`}
              >
                {viewCounts[sv.id] ?? 0}
              </span>
            </Link>
          );
        })}
      </div>

      {/* Table / cards content */}
      <div className="flex-1 overflow-auto bg-surface">
        {items.length === 0 ? (
          /* Empty state */
          <div className="flex flex-col items-center justify-center gap-3 py-16 px-6 text-center">
            <div className="w-10 h-10 rounded-full bg-panel flex items-center justify-center">
              <Icon name="filter" size={20} className="text-muted" />
            </div>
            <p className="font-sans text-text font-medium">No accounts match this view.</p>
            <p className="font-sans text-sm text-muted max-w-xs">
              Clear the search or pick another view.
            </p>
          </div>
        ) : (
          <>
            {/* ── Desktop table (md+) ─────────────────────────────────── */}
            <div className="hidden md:block" aria-label="Work queue table">
              {/* Column header */}
              <div
                className="grid grid-cols-[auto_1fr_auto_auto_auto_auto_auto] items-center gap-x-4 px-4 py-2 border-b border-border bg-panel"
                aria-hidden="true"
              >
                <span className="font-sans text-xs text-muted uppercase tracking-wide">Heat</span>
                <span className="font-sans text-xs text-muted uppercase tracking-wide">Customer / invoice</span>
                <span className="font-sans text-xs text-muted uppercase tracking-wide text-right">Balance</span>
                <span className="font-sans text-xs text-muted uppercase tracking-wide">Age</span>
                <span className="font-sans text-xs text-muted uppercase tracking-wide hidden lg:block">Last contact</span>
                <span className="font-sans text-xs text-muted uppercase tracking-wide hidden lg:block">Next action</span>
                <span className="font-sans text-xs text-muted uppercase tracking-wide hidden xl:block">Owner</span>
              </div>

              {/* Rows */}
              <div role="list" aria-label="Work queue items">
                {items.map((item) => (
                  <div key={item.invoiceId} role="listitem">
                    <QueueRow
                      item={item}
                      selected={selectedInvoiceId === item.invoiceId}
                      view={view}
                      sort={sort}
                      search={search}
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* ── Mobile cards (< md) ─────────────────────────────────── */}
            <div className="md:hidden p-3" aria-label="Work queue items">
              {items.map((item) => (
                <MobileCard
                  key={item.invoiceId}
                  item={item}
                  selected={selectedInvoiceId === item.invoiceId}
                  view={view}
                  sort={sort}
                  search={search}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
