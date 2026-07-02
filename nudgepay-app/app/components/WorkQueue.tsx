import { useEffect, useRef, useState } from "react";
import { Form, Link, useNavigation } from "react-router";
import type { ViewId, SortId } from "../lib/worklist";
import type { CaseItem } from "../lib/cases";
import type { Collision } from "../lib/collision";
import { formatDate } from "../lib/dates";
import { STATUS_LABEL, formatUSD } from "../lib/format";
import { exceptionLabel } from "../lib/exceptions";
import { partitionEligibility, clampBatch, MAX_BATCH } from "../lib/bulk";
import { plural } from "../lib/labels";
import { BulkActionBar } from "./BulkActionBar";

// Shared grid template — used by both the header row and queue rows so
// column widths can't drift apart.
const QUEUE_GRID = [
  "grid-cols-[auto_minmax(180px,2fr)_minmax(96px,0.9fr)_minmax(56px,0.5fr)]",
  "lg:grid-cols-[auto_minmax(180px,2fr)_minmax(96px,0.7fr)_minmax(56px,0.5fr)_minmax(96px,0.7fr)_minmax(230px,2fr)]",
  "xl:grid-cols-[auto_minmax(180px,2fr)_minmax(96px,0.7fr)_minmax(56px,0.5fr)_minmax(96px,0.7fr)_minmax(230px,2fr)_minmax(104px,0.7fr)]",
].join(" ");
import { BulkSmsDrawer } from "./BulkSmsDrawer";
import { ThermalBand } from "./ThermalBand";
import { Icon } from "./Icons";
import { statusChipTone, type ChipTone } from "../lib/status-style";
import type { ComingDueGroup } from "../lib/coming-due";
import { ComingDueList } from "./ComingDueList";

// ---------------------------------------------------------------------------
// Static maps — Tailwind v4 scanner requires literal class strings; no template
// interpolation like `text-${tone}` is allowed.
// ---------------------------------------------------------------------------

// Static effective-level → badge classes (Tailwind v4 needs literal strings).
const LEVEL_BADGE: Record<string, string> = {
  Critical: "bg-hot/10 text-hot",
  High: "bg-warm/10 text-warm",
  Medium: "bg-warm/5 text-warm",
  Low: "bg-cool/10 text-cool",
};

// Status chip — literal class strings for the Tailwind v4 scanner.
const CHIP: Record<ChipTone, string> = {
  cool: "bg-cool/10 text-cool",
  copper: "bg-copper/10 text-copper",
  neutral: "bg-muted/10 text-muted",
};
const CHIP_DOT: Record<ChipTone, string> = {
  cool: "bg-cool",
  copper: "bg-copper",
  neutral: "bg-muted",
};
// Heat → left-rail fill.
const HEAT_BAR: Record<string, string> = {
  cool: "bg-cool",
  warm: "bg-warm",
  hot: "bg-hot",
};


// ---------------------------------------------------------------------------
// Communication-preference badges — compact inline cluster on each row
// ---------------------------------------------------------------------------

const PREF_CHANNEL_LABEL: Record<string, string> = { call: "Prefers call", text: "Prefers text" };

function CommPrefBadges({ prefs }: { prefs: { preferredChannel: string | null; doNotCall: boolean; doNotText: boolean } }) {
  const badges: { key: string; label: string; cls: string }[] = [];
  if (prefs.preferredChannel && PREF_CHANNEL_LABEL[prefs.preferredChannel]) {
    badges.push({ key: "pref", label: PREF_CHANNEL_LABEL[prefs.preferredChannel], cls: "bg-cool/15 text-cool" });
  }
  if (prefs.doNotText) badges.push({ key: "nt", label: "No text", cls: "bg-hot/15 text-hot" });   // enforced
  if (prefs.doNotCall) badges.push({ key: "nc", label: "No call", cls: "bg-advisory/15 text-advisory" }); // advisory
  if (badges.length === 0) return null;
  return (
    <span className="flex flex-wrap items-center gap-1">
      {badges.map((b) => (
        <span key={b.key} className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-sans font-semibold ${b.cls}`}>{b.label}</span>
      ))}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Collision marker — shown when another agent is viewing or recently contacted
// ---------------------------------------------------------------------------

function CollisionMarker({ collision }: { collision?: Collision }) {
  if (!collision || collision.level === "none") return null;
  const text =
    collision.level === "live"
      ? `${collision.byUser ?? "A teammate"} viewing now`
      : `Contacted by ${collision.byUser ?? "a teammate"} recently`;
  return (
    <span
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-sans font-medium text-advisory bg-advisory/10 border border-advisory/30"
      title={text}
      aria-label={text}
    >
      <span aria-hidden="true">⚠</span>
      {collision.level === "live" ? "Viewing" : "Recent"}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Saved-view tab definitions
// ---------------------------------------------------------------------------

const SAVED_VIEWS: { id: ViewId; label: string }[] = [
  { id: "all-open",         label: "All open" },
  { id: "coming-due",       label: "Coming due" },
  { id: "30-plus",          label: "30+ days" },
  { id: "high-value",       label: "High value" },
  { id: "never-contacted",  label: "Never contacted" },
  { id: "follow-ups-due",   label: "Follow-ups due" },
  { id: "broken-promises",  label: "Broken promises" },
  { id: "waiting",          label: "Waiting" },
  { id: "on-hold",          label: "On hold" },
  { id: "my-work",          label: "My work" },
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
  items: CaseItem[];
  view: ViewId;
  sort: SortId;
  search: string;
  selectedCaseId: string | null;
  totalCount: number;
  viewCounts: Record<ViewId, number>;
  roster: { userId: string; label: string }[];
  returnTo: string;
  collisions: Record<string, Collision>;
  smsEnabled: boolean;
  comingDueGroups: ComingDueGroup[];
}

// ---------------------------------------------------------------------------
// Row — flex wrapper with a sibling checkbox + flex-1 Link; keyboard-focusable.
// ---------------------------------------------------------------------------

function QueueRow({
  item,
  selected,
  view,
  sort,
  search,
  checked,
  onToggle,
  disabled,
  collision,
}: {
  item: CaseItem;
  selected: boolean;
  view: ViewId;
  sort: SortId;
  search: string;
  checked: boolean;
  onToggle: (id: string) => void;
  disabled: boolean;
  collision?: Collision;
}) {
  const params = new URLSearchParams({ case: item.caseId, view, sort, ...(search ? { q: search } : {}) });
  const href = `?${params.toString()}`;

  return (
    <div
      className={[
        "relative flex items-center border-b border-border transition-colors duration-100 hover:bg-paper",
        selected ? "bg-copper/5" : "",
      ].join(" ")}
    >
      <span aria-hidden="true" className={`absolute left-0 inset-y-0 w-1 ${HEAT_BAR[item.heat.band] ?? "bg-muted"}`} />
      {selected ? <span aria-hidden="true" className="absolute left-1 inset-y-0 w-0.5 bg-copper" /> : null}
      <label className="flex items-center pl-4 pr-1 cursor-pointer" onClick={(e) => e.stopPropagation()}>
        <span className="sr-only">Select {item.customerName}</span>
        <input
          type="checkbox"
          checked={checked}
          onChange={() => onToggle(item.caseId)}
          disabled={disabled}
          className="h-4 w-4 rounded border-border text-copper focus-visible:ring-2 focus-visible:ring-copper"
        />
      </label>
      <Link
        to={href}
        aria-label={`Open ${item.customerName}`}
        aria-current={selected ? "true" : undefined}
        className={[
          "group flex-1 grid items-center gap-x-6 gap-y-0",
          QUEUE_GRID,
          "px-4 py-2.5 text-sm",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper focus-visible:ring-inset",
        ].join(" ")}
      >
        {/* Heat */}
        <span data-label="Heat" className="hidden md:flex">
          <ThermalBand heat={item.heat} />
        </span>

        {/* Customer */}
        <span data-label="Customer" className="min-w-0">
          <span className="block font-sans text-text truncate">{item.customerName}</span>
          <span className="flex items-center gap-1.5">
            <span className="font-mono text-xs text-muted">{plural(item.invoiceCount, "invoice")}</span>
            <span className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-sans font-semibold ${LEVEL_BADGE[item.effectiveLevel] ?? "text-muted"}`}>
              {item.override ? <span aria-hidden>📌</span> : null}
              {item.effectiveLevel}
            </span>
          </span>
          <CommPrefBadges prefs={item.commPrefs} />
        </span>

        {/* Total overdue */}
        <span data-label="Total overdue" className="font-mono text-text tabular-nums text-right hidden md:block">
          {formatUSD(item.totalOverdue)}
        </span>

        {/* Oldest age */}
        <span data-label="Oldest age" className="font-mono text-sm text-muted tabular-nums hidden md:block whitespace-nowrap">
          {item.oldestAgeDays > 0 ? `${item.oldestAgeDays}d` : "Due"}
        </span>

        {/* Last contact */}
        <span data-label="Last contact" className="hidden lg:block min-w-0">
          {item.lastContact ? (
            <>
              <span className="block text-text text-xs">{formatDate(item.lastContact.date)}</span>
              <span className="block text-muted text-xs capitalize">{item.lastContact.channel}</span>
            </>
          ) : (
            <span className="text-muted text-xs">Never contacted</span>
          )}
          <CollisionMarker collision={collision} />
        </span>

        {/* Status + next action date */}
        <span data-label="Status" className="hidden lg:flex flex-col items-start gap-0.5 min-w-0">
          {(() => {
            const tone = statusChipTone(item.status);
            return (
              <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11.5px] font-sans font-semibold ${CHIP[tone]}`}>
                <span aria-hidden="true" className={`w-1.5 h-1.5 rounded-full ${CHIP_DOT[tone]}`} />
                {STATUS_LABEL[item.status] ?? item.status}
                {item.nextActionAt ? <span className="font-normal opacity-80"> · {formatDate(item.nextActionAt)}</span> : null}
              </span>
            );
          })()}
          {item.promiseStatus === "broken" ? (
            <span className="text-[11px] text-hot pl-0.5">Promise broken</span>
          ) : item.status === "on_hold" && item.exceptionReason ? (
            <span className="text-[11px] text-muted pl-0.5">{exceptionLabel(item.exceptionReason)}</span>
          ) : null}
        </span>

        {/* Owner chip */}
        <span data-label="Owner" className="hidden xl:inline-flex items-center gap-1 rounded-full bg-panel border border-border px-2 py-0.5 text-xs text-muted font-sans whitespace-nowrap">
          <Icon name="user" size={12} aria-hidden />
          {item.owner}
        </span>
      </Link>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mobile card — rendered under md breakpoint via CSS
// ---------------------------------------------------------------------------

function MobileCard({
  item, selected, view, sort, search, checked, onToggle, disabled, collision,
}: {
  item: CaseItem; selected: boolean; view: ViewId; sort: SortId; search: string;
  checked: boolean; onToggle: (id: string) => void; disabled: boolean; collision?: Collision;
}) {
  const params = new URLSearchParams({ case: item.caseId, view, sort, ...(search ? { q: search } : {}) });
  const href = `?${params.toString()}`;
  return (
    <div className={["flex gap-2 items-start bg-surface border rounded-lg p-3 mb-2", selected ? "border-copper ring-2 ring-copper bg-copper/5" : "border-border"].join(" ")}>
      <label className="pt-1 cursor-pointer" onClick={(e) => e.stopPropagation()}>
        <span className="sr-only">Select {item.customerName}</span>
        <input type="checkbox" checked={checked} onChange={() => onToggle(item.caseId)} disabled={disabled} className="h-4 w-4 rounded border-border text-copper focus-visible:ring-2 focus-visible:ring-copper" />
      </label>
      <Link to={href} aria-label={`Open ${item.customerName}`} aria-current={selected ? "true" : undefined} className="flex-1 min-w-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper rounded">
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="flex items-center gap-2 min-w-0">
            <ThermalBand heat={item.heat} />
            <div className="min-w-0">
              <p className="font-sans text-text font-medium truncate">{item.customerName}</p>
              <p className="flex items-center gap-1.5">
                <span className="font-mono text-xs text-muted">{plural(item.invoiceCount, "invoice")}</span>
                <span className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-sans font-semibold ${LEVEL_BADGE[item.effectiveLevel] ?? "text-muted"}`}>
                  {item.override ? <span aria-hidden>📌</span> : null}
                  {item.effectiveLevel}
                </span>
              </p>
              <CommPrefBadges prefs={item.commPrefs} />
            </div>
          </div>
          <span className="font-mono text-text tabular-nums text-right shrink-0 text-sm">{formatUSD(item.totalOverdue)}</span>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="font-mono text-muted tabular-nums">{item.oldestAgeDays > 0 ? `${item.oldestAgeDays}d` : "Due"}</span>
          <span className="font-sans font-medium text-text">
            {STATUS_LABEL[item.status] ?? item.status}
            {item.status === "on_hold" && item.exceptionReason ? (
              <span className="ml-1.5 inline-flex items-center rounded-sm bg-advisory/15 px-1.5 py-0.5 text-[11px] font-medium text-advisory">
                {exceptionLabel(item.exceptionReason)}
              </span>
            ) : null}
            {item.nextActionAt ? <span className="text-muted"> · {formatDate(item.nextActionAt)}</span> : null}
            {item.promiseStatus === "broken" ? <span className="text-hot"> · Promise broken</span> : null}
          </span>
        </div>
        <div className="mt-1 text-xs">
          {item.lastContact ? (
            <span className="text-muted">{formatDate(item.lastContact.date)} · {item.lastContact.channel}</span>
          ) : (
            <span className="text-muted">Never contacted</span>
          )}
          <CollisionMarker collision={collision} />
        </div>
      </Link>
    </div>
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
 * At md+: a dense table with Heat | Customer | Total overdue | Oldest age | Last contact | Status | Owner.
 */
export function WorkQueue({
  items,
  view,
  sort,
  search,
  selectedCaseId,
  totalCount,
  viewCounts,
  roster,
  returnTo,
  collisions,
  smsEnabled,
  comingDueGroups,
}: WorkQueueProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [smsOpen, setSmsOpen] = useState(false);
  const nav = useNavigation();

  // Selection is per-view: clear it whenever the filter/sort/search changes
  // (the queue re-renders with a different item set on navigation).
  useEffect(() => {
    setSelected(new Set());
    setSmsOpen(false);
  }, [view, sort, search]);

  // After a bulk action the loader revalidates without remounting (same filter
  // params), so items can change while `selected` keeps IDs that left the view.
  // Prune selection to currently-visible cases. (View/sort/search changes are
  // handled by the full-clear effect above.)
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const visible = new Set(items.map((i) => i.caseId));
      const next = new Set<string>();
      for (const id of prev) if (visible.has(id)) next.add(id);
      return next.size === prev.size ? prev : next; // subset-only: equal size ⇒ nothing pruned ⇒ no re-render
    });
  }, [items]);

  // A bulk assign/SMS submits via <Form> (a navigation). When that navigation
  // settles back to idle, the action has completed + the loader revalidated, so
  // clear the selection and close the drawer. Without this, a redirect back to
  // the same view (only result params added) leaves the drawer open on its
  // confirm step with the Send button re-enabling on the same caseIds/body —
  // a one-click accidental re-send of an irreversible batch.
  const bulkSubmitInFlight = useRef(false);
  useEffect(() => {
    const action = nav.formAction ?? "";
    const isBulk = action.includes("/api/bulk-sms") || action.includes("/api/bulk-assign");
    if (nav.state !== "idle" && isBulk) {
      bulkSubmitInFlight.current = true;
    } else if (nav.state === "idle" && bulkSubmitInFlight.current) {
      bulkSubmitInFlight.current = false;
      setSelected(new Set());
      setSmsOpen(false);
    }
  }, [nav.state, nav.formAction]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < MAX_BATCH) next.add(id);
      return next;
    });

  const allVisibleIds = clampBatch(items.map((i) => i.caseId));
  const allSelected = allVisibleIds.length > 0 && allVisibleIds.every((id) => selected.has(id));
  const toggleAll = () =>
    setSelected((prev) => (allSelected ? new Set() : new Set(allVisibleIds)));

  const headerRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (headerRef.current) {
      headerRef.current.indeterminate = !allSelected && allVisibleIds.some((id) => selected.has(id));
    }
  }, [allSelected, allVisibleIds, selected]);

  const capReached = selected.size >= MAX_BATCH;
  const selectedCases = items.filter((i) => selected.has(i.caseId));
  const eligibleCount = partitionEligibility(selectedCases).eligible.length;

  return (
    <section className="flex flex-col min-h-0" aria-labelledby="work-queue-title">
      {/* Header + toolbar (single band) */}
      <div className="flex flex-wrap items-center gap-3 px-6 py-3 border-b border-border bg-paper">
        <div className="min-w-0">
          <h2
            id="work-queue-title"
            className="font-display text-lg font-semibold text-text leading-tight"
          >
            Work queue
          </h2>
          <p className="font-sans text-xs text-muted">
            {items.length} matching · {totalCount} open
          </p>
        </div>

        {/* GET form; submit preserves view via hidden input */}
        <Form method="get" className="flex items-center gap-2 ml-auto">
          <input type="hidden" name="view" value={view} />

          {/* Search input */}
          <label className="flex items-center gap-1.5 w-56 rounded-md border border-border bg-panel px-2.5 h-9 text-sm text-text focus-within:ring-2 focus-within:ring-copper focus-within:border-transparent transition-shadow">
            <Icon name="search" size={15} className="text-muted shrink-0" />
            <span className="sr-only">Search queue</span>
            <input
              name="q"
              type="search"
              defaultValue={search}
              placeholder="Search…"
              className="flex-1 min-w-0 bg-transparent border-none outline-none font-sans text-sm text-text placeholder:text-muted"
            />
          </label>

          {/* Sort select */}
          <label className="flex items-center gap-1.5 rounded-md border border-border bg-panel px-2.5 h-9 text-sm text-text focus-within:ring-2 focus-within:ring-copper focus-within:border-transparent transition-shadow cursor-pointer">
            <Icon name="arrowDownUp" size={15} className="text-muted shrink-0" />
            <span className="sr-only">Sort work queue</span>
            <select
              name="sort"
              defaultValue={sort}
              onChange={(e) => e.currentTarget.form?.requestSubmit()}
              className="bg-transparent border-none outline-none font-sans text-sm text-text cursor-pointer"
            >
              {SORT_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>

          <button
            type="submit"
            className="rounded-md border border-border bg-panel px-3 h-9 text-xs font-sans text-muted hover:text-text hover:border-copper transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
          >
            Apply
          </button>
        </Form>
      </div>

      {/* Saved-view tabs */}
      <nav
        aria-label="Saved queue views"
        className="flex gap-1 overflow-x-auto border-b border-border bg-paper px-3.5 py-2 scrollbar-none"
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
              aria-current={isActive ? "page" : undefined}
              className={[
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[12.5px] whitespace-nowrap transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper",
                isActive
                  ? "bg-ink border-ink text-surface font-semibold"
                  : "bg-surface border-border text-muted font-medium hover:border-copper/50 hover:text-text",
              ].join(" ")}
            >
              {sv.label}
              <span
                className={`inline-grid place-items-center min-w-[18px] h-[18px] px-1 rounded-full font-mono text-[10.5px] font-semibold ${
                  isActive ? "bg-surface/20 text-surface" : "bg-panel text-muted"
                }`}
              >
                {viewCounts[sv.id] ?? 0}
              </span>
            </Link>
          );
        })}
      </nav>

      {/* Table / cards content */}
      <div className="flex-1 overflow-auto bg-surface">
        {view === "coming-due" ? (
          <ComingDueList groups={comingDueGroups} />
        ) : items.length === 0 ? (
          /* Empty state */
          <div className="flex flex-col items-center justify-center gap-3 py-16 px-6 text-center">
            <div className="w-10 h-10 rounded-full bg-paper flex items-center justify-center">
              <Icon name="filter" size={20} className="text-muted" />
            </div>
            <p className="font-sans text-text font-medium">No accounts match this view.</p>
            <p className="font-sans text-sm text-muted max-w-xs">
              <Link to={`?view=all-open&sort=${sort}`} className="text-copper hover:underline font-medium">Clear the search</Link>{" "}
              or pick another view.
            </p>
          </div>
        ) : (
          <>
            {/* ── Desktop table (md+) ─────────────────────────────────── */}
            <div className="hidden md:block" aria-label="Work queue table">
              {/* Column header */}
              <div
                className="flex items-center px-4 py-2 border-b border-border bg-paper"
                aria-hidden="false"
              >
                <label className="flex items-center pl-4 pr-1 cursor-pointer">
                  <span className="sr-only">Select all matching</span>
                  <input
                    ref={headerRef}
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    className="h-4 w-4 rounded border-border text-copper focus-visible:ring-2 focus-visible:ring-copper"
                  />
                </label>
                <div className={`flex-1 grid items-center gap-x-6 ${QUEUE_GRID}`}>
                  <span className="font-sans text-xs text-muted uppercase tracking-wide">Heat</span>
                  <span className="font-sans text-xs text-muted uppercase tracking-wide">Customer</span>
                  <span className="font-sans text-xs text-muted uppercase tracking-wide text-right">Total overdue</span>
                  <span className="font-sans text-xs text-muted uppercase tracking-wide">Oldest age</span>
                  <span className="font-sans text-xs text-muted uppercase tracking-wide hidden lg:block">Last contact</span>
                  <span className="font-sans text-xs text-muted uppercase tracking-wide hidden lg:block">Status</span>
                  <span className="font-sans text-xs text-muted uppercase tracking-wide hidden xl:block">Owner</span>
                </div>
              </div>

              {/* Rows */}
              <div role="list" aria-label="Work queue items">
                {items.map((item) => (
                  <div key={item.caseId} role="listitem">
                    <QueueRow
                      item={item}
                      selected={selectedCaseId === item.caseId}
                      view={view}
                      sort={sort}
                      search={search}
                      checked={selected.has(item.caseId)}
                      onToggle={toggle}
                      disabled={!selected.has(item.caseId) && capReached}
                      collision={collisions[item.caseId]}
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* ── Mobile cards (< md) ─────────────────────────────────── */}
            <div className="md:hidden p-3" aria-label="Work queue items">
              {items.map((item) => (
                <MobileCard
                  key={item.caseId}
                  item={item}
                  selected={selectedCaseId === item.caseId}
                  view={view}
                  sort={sort}
                  search={search}
                  checked={selected.has(item.caseId)}
                  onToggle={toggle}
                  disabled={!selected.has(item.caseId) && capReached}
                  collision={collisions[item.caseId]}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {selected.size > 0 ? (
        <BulkActionBar
          selectedCaseIds={[...selected]}
          eligibleCount={eligibleCount}
          roster={roster}
          returnTo={returnTo}
          onClear={() => setSelected(new Set())}
          onOpenSms={() => setSmsOpen(true)}
        />
      ) : null}
      <BulkSmsDrawer
        open={smsOpen}
        onClose={() => setSmsOpen(false)}
        cases={selectedCases}
        returnTo={returnTo}
        smsEnabled={smsEnabled}
      />
    </section>
  );
}
