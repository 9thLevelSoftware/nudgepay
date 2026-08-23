import { useCallback, useEffect, useRef, useState } from "react";
import { Form, Link, useLocation, useNavigate, useNavigation } from "react-router";
import type { ViewId, SortId } from "../lib/worklist";
import type { CaseItem } from "../lib/cases";
import type { Collision } from "../lib/collision";
import type { MessageTemplateRow } from "../lib/message-templates";
import { formatDate, formatInstant } from "../lib/dates";
import { STATUS_LABEL, formatUSD } from "../lib/format";
import { exceptionLabel } from "../lib/exceptions";
import { partitionEligibility, clampBatch } from "../lib/bulk";
import { plural } from "../lib/labels";
import { emptyQueueCopy } from "../lib/empty-queue-copy";
import {
  visibleWindow,
  queueRowHeight,
  QUEUE_OVERSCAN,
} from "../lib/virtual-window";
import { useSearchShortcut } from "../lib/use-search-shortcut";
import {
  dashboardHref,
  dashboardSearchParams,
  parseDensity,
  withDensityParam,
  DENSITY_IDS,
  DENSITY_STORAGE_KEY,
  ENTITY_MODES,
  type DensityId,
  type EntityMode,
} from "../lib/queue-chrome";
import { clampInvoiceBatch, type InvoiceQueueItem } from "../lib/invoice-queue";
import {
  PAYER_BAND_HINT,
  PAYER_BAND_LABEL,
  type PayerBand,
} from "../lib/payer-behavior";
import { BulkActionBar } from "./BulkActionBar";
import { useQueueKeys, type QueueKey } from "../lib/use-queue-keys";
import { BulkSmsDrawer } from "./BulkSmsDrawer";
import { ThermalBand } from "./ThermalBand";
import { Icon } from "./Icons";
import { Skeleton } from "./ui";
import { statusChipTone, type ChipTone } from "../lib/status-style";
import type { ComingDueGroup } from "../lib/coming-due";
import { ComingDueList } from "./ComingDueList";

// Shared grid templates — header row and queue rows must use the same string
// so column widths can't drift. Literal Tailwind classes for the v4 scanner.
const QUEUE_GRID_CUST_GENERAL = [
  "grid-cols-[auto_minmax(180px,2fr)_minmax(96px,0.9fr)_minmax(56px,0.5fr)]",
  "lg:grid-cols-[auto_minmax(180px,2fr)_minmax(96px,0.7fr)_minmax(56px,0.5fr)_minmax(96px,0.7fr)_minmax(230px,2fr)]",
  "xl:grid-cols-[auto_minmax(150px,1.5fr)_minmax(96px,0.7fr)_minmax(72px,0.4fr)_minmax(84px,0.6fr)_minmax(120px,1.1fr)_minmax(104px,0.6fr)]",
].join(" ");
const QUEUE_GRID = QUEUE_GRID_CUST_GENERAL;

const QUEUE_GRID_CUST_DETAILED = [
  "grid-cols-[auto_minmax(160px,1.6fr)_minmax(88px,0.7fr)_minmax(56px,0.4fr)]",
  "lg:grid-cols-[auto_minmax(160px,1.6fr)_minmax(88px,0.7fr)_minmax(56px,0.4fr)_minmax(220px,2fr)_minmax(200px,1.5fr)]",
  "xl:grid-cols-[auto_minmax(140px,1.4fr)_minmax(80px,0.7fr)_minmax(64px,0.4fr)_minmax(130px,1.2fr)_minmax(130px,1.1fr)_minmax(104px,0.6fr)]",
].join(" ");

const QUEUE_GRID_CUST_RISK = [
  "grid-cols-[auto_minmax(140px,1.4fr)_minmax(88px,0.7fr)_minmax(48px,0.4fr)]",
  "lg:grid-cols-[auto_minmax(140px,1.4fr)_minmax(88px,0.7fr)_minmax(48px,0.4fr)_minmax(64px,0.5fr)_minmax(64px,0.5fr)_minmax(56px,0.4fr)]",
  "xl:grid-cols-[auto_minmax(130px,1.3fr)_minmax(80px,0.7fr)_minmax(64px,0.4fr)_minmax(56px,0.5fr)_minmax(56px,0.5fr)_minmax(48px,0.4fr)_minmax(88px,0.7fr)_minmax(104px,0.6fr)]",
].join(" ");

const QUEUE_GRID_INV_GENERAL = [
  "grid-cols-[auto_minmax(88px,0.7fr)_minmax(160px,1.6fr)_minmax(88px,0.7fr)]",
  "lg:grid-cols-[auto_minmax(88px,0.7fr)_minmax(160px,1.6fr)_minmax(88px,0.7fr)_minmax(88px,0.7fr)_minmax(48px,0.4fr)]",
  "xl:grid-cols-[auto_minmax(80px,0.7fr)_minmax(140px,1.4fr)_minmax(80px,0.7fr)_minmax(80px,0.7fr)_minmax(44px,0.4fr)_minmax(104px,0.6fr)]",
].join(" ");

const QUEUE_GRID_INV_DETAILED = [
  "grid-cols-[auto_minmax(80px,0.6fr)_minmax(140px,1.4fr)_minmax(80px,0.6fr)]",
  "lg:grid-cols-[auto_minmax(80px,0.6fr)_minmax(140px,1.4fr)_minmax(80px,0.6fr)_minmax(80px,0.6fr)_minmax(48px,0.4fr)_minmax(200px,2fr)]",
  "xl:grid-cols-[auto_minmax(72px,0.6fr)_minmax(120px,1.2fr)_minmax(72px,0.6fr)_minmax(72px,0.6fr)_minmax(44px,0.4fr)_minmax(140px,1.4fr)_minmax(104px,0.6fr)]",
].join(" ");

const QUEUE_GRID_INV_RISK = [
  "grid-cols-[auto_minmax(80px,0.6fr)_minmax(140px,1.4fr)_minmax(80px,0.6fr)]",
  "lg:grid-cols-[auto_minmax(80px,0.6fr)_minmax(140px,1.4fr)_minmax(80px,0.6fr)_minmax(48px,0.4fr)_minmax(64px,0.5fr)_minmax(64px,0.5fr)_minmax(56px,0.4fr)]",
  "xl:grid-cols-[auto_minmax(72px,0.6fr)_minmax(120px,1.2fr)_minmax(72px,0.6fr)_minmax(64px,0.4fr)_minmax(56px,0.5fr)_minmax(56px,0.5fr)_minmax(48px,0.4fr)_minmax(104px,0.6fr)]",
].join(" ");

function queueGrid(density: DensityId, entity: EntityMode = "customers"): string {
  if (entity === "invoices") {
    if (density === "detailed") return QUEUE_GRID_INV_DETAILED;
    if (density === "risk") return QUEUE_GRID_INV_RISK;
    return QUEUE_GRID_INV_GENERAL;
  }
  if (density === "detailed") return QUEUE_GRID_CUST_DETAILED;
  if (density === "risk") return QUEUE_GRID_CUST_RISK;
  return QUEUE_GRID;
}

const DENSITY_LABEL: Record<DensityId, string> = {
  general: "General",
  detailed: "Detailed",
  risk: "Risk",
};

const ENTITY_LABEL: Record<EntityMode, string> = {
  customers: "Customers",
  invoices: "Invoices",
};

const PAYER_CHIP: Record<PayerBand, string> = {
  good: "bg-cool/10 text-cool",
  fair: "bg-warm/10 text-warm",
  risk: "bg-hot/10 text-hot",
  unknown: "bg-muted/10 text-muted",
};

function persistDensity(id: DensityId) {
  try { localStorage.setItem(DENSITY_STORAGE_KEY, id); } catch { /* private mode */ }
}

function formatDtp(days: number | null | undefined): string {
  return days == null || !Number.isFinite(days) ? "—" : `${Math.round(days)}d`;
}

function formatReplyPct(rate: number | null | undefined): string {
  return rate == null || !Number.isFinite(rate) ? "—" : `${Math.round(rate * 100)}%`;
}

function PayerChip({ band }: { band: PayerBand }) {
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-sans font-semibold ${PAYER_CHIP[band]}`}
      title={PAYER_BAND_HINT}
    >
      {PAYER_BAND_LABEL[band]}
    </span>
  );
}

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
  if (prefs.doNotCall) badges.push({ key: "nc", label: "No call", cls: "bg-warm/15 text-warm" }); // warm
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
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-sans font-medium text-warm bg-warm/10 border border-warm/30"
      title={text}
      aria-label={text}
    >
      <Icon name="alert" size={11} aria-hidden="true" />
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

const SORT_OPTIONS_CUSTOMERS: { id: SortId; label: string }[] = [
  { id: "recommended",    label: "Recommended" },
  { id: "most-overdue",   label: "Most overdue" },
  { id: "highest-balance", label: "Highest balance" },
  { id: "customer",       label: "Customer" },
];
const SORT_OPTIONS_INVOICES: { id: SortId; label: string }[] = [
  ...SORT_OPTIONS_CUSTOMERS,
  { id: "due-date", label: "Due date" },
];

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface WorkQueueProps {
  items: CaseItem[];
  invoiceItems: InvoiceQueueItem[];
  entity: EntityMode;
  view: ViewId;
  sort: SortId;
  search: string;
  density: DensityId;
  densityFromUrl: boolean;
  tab?: "overview" | "activity" | "messages" | "email";
  invoice?: string | null;
  selectedCaseId: string | null;
  selectedInvoiceId: string | null;
  totalCount: number;
  viewCounts: Record<ViewId, number>;
  roster: { userId: string; label: string }[];
  returnTo: string;
  collisions: Record<string, Collision>;
  smsEnabled: boolean;
  smsQuietNow: boolean;
  quietHoursLabel: string;
  comingDueGroups: ComingDueGroup[];
  comingDueDays: number;
  smsTemplates: MessageTemplateRow[];
  orgCompany: string;
  orgPhone: string;
  orgPaymentLink: string;
  /** Org-configured max cases per bulk action (assign / SMS). */
  maxBatch: number;
  /** QBO connection — empty-state copy branches on first-run vs filter-miss. */
  connected: boolean;
  timeZone?: string | null;
}

// ---------------------------------------------------------------------------
// Row — checkbox + QUEUE_GRID cells; name Link lives in the Customer cell.
// Pointer clicks on the row open the case; checkbox and action links stop that.
// ---------------------------------------------------------------------------

function QueueRow({
  item,
  selected,
  view,
  sort,
  search,
  entity,
  density,
  hrefDensity,
  checked,
  onToggle,
  disabled,
  collision,
  timeZone,
}: {
  item: CaseItem;
  selected: boolean;
  view: ViewId;
  sort: SortId;
  search: string;
  entity: EntityMode;
  density: DensityId;
  hrefDensity?: DensityId;
  checked: boolean;
  onToggle: (id: string) => void;
  disabled: boolean;
  collision?: Collision;
  timeZone?: string | null;
}) {
  const navigate = useNavigate();
  const chrome = { view, sort, q: search || undefined, entity, density: hrefDensity, case: item.caseId };
  const href = dashboardHref(chrome);
  const msgHref = dashboardHref({ ...chrome, tab: "messages" });
  const logParams = dashboardSearchParams(chrome);
  logParams.set("log", "1");
  logParams.set("method", "call");
  const logHref = `?${logParams.toString()}`;
  const band: PayerBand = item.payer?.band ?? "unknown";

  return (
    <div
      role="row"
      onClick={() => navigate(href)}
      className={[
        "group relative flex items-center border-b border-border cursor-pointer transition-colors duration-100 hover:bg-paper",
        selected ? "bg-copper/10 ring-1 ring-inset ring-copper/30" : "",
      ].join(" ")}
    >
      <span aria-hidden="true" className={`absolute left-0 inset-y-0 w-1 ${HEAT_BAR[item.heat.band] ?? "bg-muted"}`} />
      {selected ? <span aria-hidden="true" className="absolute left-1 inset-y-0 w-0.5 bg-copper" /> : null}
      <label role="cell" className="flex items-center pl-4 pr-1 cursor-pointer" onClick={(e) => e.stopPropagation()}>
        <span className="sr-only">Select {item.customerName}</span>
        <input
          type="checkbox"
          checked={checked}
          onChange={() => onToggle(item.caseId)}
          disabled={disabled}
          className="h-4 w-4 rounded border-border text-copper focus-visible:ring-2 focus-visible:ring-copper"
        />
      </label>
      {/* role=presentation flattens this grid wrapper so cells are owned by the row. */}
      <div
        role="presentation"
        className={`flex-1 grid items-center gap-x-6 gap-y-0 ${queueGrid(density, entity)} px-4 py-2 text-sm`}
      >
        {/* Heat */}
        <span role="cell" data-label="Heat" className="hidden md:flex">
          <ThermalBand heat={item.heat} />
        </span>

        {/* Customer */}
        <span role="cell" data-label="Customer" className="min-w-0">
          <Link
            to={href}
            aria-current={selected ? "true" : undefined}
            onClick={(e) => e.stopPropagation()}
            className="block font-sans text-text truncate focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper focus-visible:ring-inset rounded"
          >
            {item.customerName}
          </Link>
          <span className="flex items-center gap-1.5">
            <span className="font-mono text-xs text-muted">{plural(item.invoiceCount, "invoice")}</span>
            <span className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-sans font-semibold ${LEVEL_BADGE[item.effectiveLevel] ?? "text-muted"}`}>
              {item.override ? <Icon name="pin" size={11} aria-hidden="true" /> : null}
              {item.effectiveLevel}
            </span>
          </span>
          <CommPrefBadges prefs={item.commPrefs} />
        </span>

        {/* Total overdue */}
        <span role="cell" data-label="Total overdue" className="font-mono text-text tabular-nums text-right hidden md:block">
          {formatUSD(item.totalOverdue)}
        </span>

        {/* Oldest age + aging bar */}
        <span role="cell" data-label="Oldest age" className="hidden md:flex flex-col gap-1 min-w-[56px]">
          <span className="font-mono text-sm text-muted tabular-nums whitespace-nowrap">
            {item.oldestAgeDays > 0 ? `${item.oldestAgeDays}d` : "Due"}
          </span>
          {item.oldestAgeDays > 0 && (
            <span className="h-[3px] w-full rounded-full bg-border/50 overflow-hidden">
              <span
                className={`block h-full rounded-full ${HEAT_BAR[item.heat.band] ?? "bg-muted"}`}
                style={{ width: `${Math.min(100, (item.oldestAgeDays / 90) * 100)}%` }}
              />
            </span>
          )}
        </span>

        {density === "detailed" ? (
          <span role="cell" data-label="Peek" className="hidden lg:flex flex-col min-w-0 gap-0.5">
            {item.peeks.slice(0, 2).map((p, i) => (
              <span key={`${p.at}-${p.kind}-${i}`} className="block truncate text-xs text-muted">{p.summary}</span>
            ))}
          </span>
        ) : null}

        {density === "risk" ? (
          <>
            <span role="cell" data-label="Payer" className="hidden lg:flex">
              <PayerChip band={band} />
            </span>
            <span role="cell" data-label="Days-to-pay" className="hidden lg:block font-mono text-xs text-muted tabular-nums">
              {formatDtp(item.payer?.daysToPay)}
            </span>
            <span role="cell" data-label="Reply" className="hidden lg:block font-mono text-xs text-muted tabular-nums">
              {formatReplyPct(item.payer?.replyRate)}
            </span>
          </>
        ) : null}

        {density !== "detailed" ? (
          <span role="cell" data-label="Last contact" className={density === "risk" ? "hidden xl:block min-w-0" : "hidden lg:block min-w-0"}>
            {item.lastContactUnknown ? (
              <span className="text-muted text-xs">Unknown</span>
            ) : item.lastContact ? (
              <>
                <span className="block text-text text-xs">{formatInstant(item.lastContact.date, timeZone)}</span>
                <span className="block text-muted text-xs capitalize">{item.lastContact.channel}</span>
              </>
            ) : (
              <span className="text-muted text-xs">Never contacted</span>
            )}
            <CollisionMarker collision={collision} />
          </span>
        ) : null}

        {density !== "risk" ? (
          <span role="cell" data-label="Status" className="hidden lg:flex flex-col items-start gap-0.5 min-w-0">
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
        ) : null}

        {/* Owner chip */}
        <span role="cell" data-label="Owner" className="hidden xl:inline-flex items-center gap-1 rounded-full bg-panel border border-border px-2 py-0.5 text-xs text-muted font-sans whitespace-nowrap">
          <Icon name="user" size={12} aria-hidden />
          {item.owner}
        </span>
      </div>
      {/* Quick-action buttons — visible on row hover */}
      <span role="cell" className="hidden md:flex items-center gap-1 pr-3 opacity-0 group-hover:opacity-100 focus-within:opacity-100 pointer-events-none group-hover:pointer-events-auto focus-within:pointer-events-auto transition-opacity">
        <Link
          to={msgHref}
          aria-label={`Send text to ${item.customerName}`}
          onClick={(e) => e.stopPropagation()}
          className="flex items-center justify-center w-7 h-7 rounded border border-border bg-panel text-muted hover:text-copper hover:border-copper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper transition-colors"
        >
          <Icon name="message" size={14} aria-hidden />
        </Link>
        <Link
          to={logHref}
          aria-label={`Log call for ${item.customerName}`}
          onClick={(e) => e.stopPropagation()}
          className="flex items-center justify-center w-7 h-7 rounded border border-border bg-panel text-muted hover:text-copper hover:border-copper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper transition-colors"
        >
          <Icon name="phone" size={14} aria-hidden />
        </Link>
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mobile card — rendered under md breakpoint via CSS
// ---------------------------------------------------------------------------

function MobileCard({
  item, selected, view, sort, search, entity, density, hrefDensity, checked, onToggle, disabled, collision, timeZone,
}: {
  item: CaseItem; selected: boolean; view: ViewId; sort: SortId; search: string;
  entity: EntityMode; density: DensityId; hrefDensity?: DensityId;
  checked: boolean; onToggle: (id: string) => void; disabled: boolean; collision?: Collision;
  timeZone?: string | null;
}) {
  const href = dashboardHref({ view, sort, q: search || undefined, entity, density: hrefDensity, case: item.caseId });
  const band: PayerBand = item.payer?.band ?? "unknown";
  // Mobile quick actions — hover-only desktop actions have no touch path, so
  // the card exposes compact message/log shortcuts directly.
  const cardMsgHref = dashboardHref({ view, sort, q: search || undefined, entity, density: hrefDensity, case: item.caseId, tab: "messages" });
  const cardLogParams = dashboardSearchParams({ view, sort, q: search || undefined, entity, density: hrefDensity, case: item.caseId });
  cardLogParams.set("log", "1");
  const cardLogHref = `?${cardLogParams.toString()}`;
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
                  {item.override ? <Icon name="pin" size={11} aria-hidden="true" /> : null}
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
              <span className="ml-1.5 inline-flex items-center rounded-sm bg-warm/15 px-1.5 py-0.5 text-[11px] font-medium text-warm">
                {exceptionLabel(item.exceptionReason)}
              </span>
            ) : null}
            {item.nextActionAt ? <span className="text-muted"> · {formatDate(item.nextActionAt)}</span> : null}
            {item.promiseStatus === "broken" ? <span className="text-hot"> · Promise broken</span> : null}
          </span>
        </div>
        <div className="mt-1 text-xs">
          {item.lastContactUnknown ? (
            <span className="text-muted">Unknown</span>
          ) : item.lastContact ? (
            <span className="text-muted">{formatInstant(item.lastContact.date, timeZone)} · {item.lastContact.channel}</span>
          ) : (
            <span className="text-muted">Never contacted</span>
          )}
          <CollisionMarker collision={collision} />
        </div>
        {density === "detailed" && item.peeks[0] ? (
          <p className="mt-1 text-xs text-muted truncate">{item.peeks[0].summary}</p>
        ) : null}
        {density === "risk" ? (
          <p className="mt-1 text-xs text-muted truncate">
            {PAYER_BAND_LABEL[band]} · {formatDtp(item.payer?.daysToPay)} · {formatReplyPct(item.payer?.replyRate)}
          </p>
        ) : null}
      </Link>
      {/* Mobile quick actions (touch) — desktop uses hover-revealed icons */}
      <div className="flex items-center gap-2 pl-1" onClick={(e) => e.stopPropagation()}>
        <Link
          to={cardMsgHref}
          aria-label={`Message ${item.customerName}`}
          className="flex h-7 w-7 items-center justify-center rounded border border-border bg-panel text-muted hover:border-copper hover:text-copper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
        >
          <Icon name="message" size={14} />
        </Link>
        <Link
          to={cardLogHref}
          aria-label={`Log contact for ${item.customerName}`}
          className="flex h-7 w-7 items-center justify-center rounded border border-border bg-panel text-muted hover:border-copper hover:text-copper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
        >
          <Icon name="phone" size={14} />
        </Link>
      </div>
    </div>
  );
}

function invoiceRowHref(
  item: InvoiceQueueItem,
  chrome: { view: ViewId; sort: SortId; q?: string; entity: EntityMode; density?: DensityId },
): string {
  if (item.caseId) {
    return dashboardHref({ ...chrome, case: item.caseId, invoice: item.invoiceId });
  }
  return item.customerId ? `/accounts/${item.customerId}` : "#";
}

function InvoiceQueueRow({
  item,
  selected,
  view,
  sort,
  search,
  entity,
  density,
  hrefDensity,
  checked,
  onToggle,
  disabled,
  collision,
}: {
  item: InvoiceQueueItem;
  selected: boolean;
  view: ViewId;
  sort: SortId;
  search: string;
  entity: EntityMode;
  density: DensityId;
  hrefDensity?: DensityId;
  checked: boolean;
  onToggle: (id: string) => void;
  disabled: boolean;
  collision?: Collision;
}) {
  const navigate = useNavigate();
  const chrome = { view, sort, q: search || undefined, entity, density: hrefDensity };
  const href = invoiceRowHref(item, chrome);
  const cased = item.caseId != null;
  const msgHref = cased ? dashboardHref({ ...chrome, case: item.caseId, invoice: item.invoiceId, tab: "messages" }) : href;
  const logParams = dashboardSearchParams({ ...chrome, case: item.caseId, invoice: item.invoiceId });
  logParams.set("log", "1");
  logParams.set("method", "call");
  const logHref = cased ? `?${logParams.toString()}` : href;
  const band: PayerBand = item.payer?.band ?? "unknown";
  const label = item.docNumber ? `${item.docNumber} · ${item.customerName}` : item.customerName;

  return (
    <div
      role="row"
      onClick={() => { if (href !== "#") navigate(href); }}
      className={[
        "group relative flex items-center border-b border-border cursor-pointer transition-colors duration-100 hover:bg-paper",
        selected ? "bg-copper/10 ring-1 ring-inset ring-copper/30" : "",
      ].join(" ")}
    >
      <span aria-hidden="true" className={`absolute left-0 inset-y-0 w-1 ${HEAT_BAR[item.heat.band] ?? "bg-muted"}`} />
      {selected ? <span aria-hidden="true" className="absolute left-1 inset-y-0 w-0.5 bg-copper" /> : null}
      <label role="cell" className="flex items-center pl-4 pr-1 cursor-pointer" onClick={(e) => e.stopPropagation()}>
        <span className="sr-only">Select {label}</span>
        <input
          type="checkbox"
          checked={checked}
          onChange={() => onToggle(item.invoiceId)}
          disabled={disabled}
          className="h-4 w-4 rounded border-border text-copper focus-visible:ring-2 focus-visible:ring-copper"
        />
      </label>
      <div
        role="presentation"
        className={`flex-1 grid items-center gap-x-6 gap-y-0 ${queueGrid(density, "invoices")} px-4 py-2 text-sm`}
      >
        <span role="cell" data-label="Heat" className="hidden md:flex">
          <ThermalBand heat={item.heat} />
        </span>
        <span role="cell" data-label="Doc #" className="font-mono text-xs text-muted truncate">
          {item.docNumber ?? "—"}
        </span>
        <span role="cell" data-label="Customer" className="min-w-0">
          <Link
            to={href}
            aria-current={selected ? "true" : undefined}
            onClick={(e) => e.stopPropagation()}
            className="block font-sans text-text truncate focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper focus-visible:ring-inset rounded"
          >
            {item.customerName}
          </Link>
          <CollisionMarker collision={collision} />
        </span>
        <span role="cell" data-label="Balance" className="font-mono text-text tabular-nums text-right hidden md:block">
          {formatUSD(item.balance)}
        </span>
        {density !== "risk" ? (
          <span role="cell" data-label="Due" className="hidden lg:block font-mono text-xs text-muted tabular-nums">
            {item.dueDate ? formatDate(item.dueDate) : "—"}
          </span>
        ) : null}
        <span role="cell" data-label="Age" className="hidden lg:flex flex-col gap-1 min-w-[48px]">
          <span className="font-mono text-sm text-muted tabular-nums whitespace-nowrap">
            {item.ageDays > 0 ? `${item.ageDays}d` : "Due"}
          </span>
          {item.ageDays > 0 && (
            <span className="h-[3px] w-full rounded-full bg-border/50 overflow-hidden">
              <span
                className={`block h-full rounded-full ${HEAT_BAR[item.heat.band] ?? "bg-muted"}`}
                style={{ width: `${Math.min(100, (item.ageDays / 90) * 100)}%` }}
              />
            </span>
          )}
        </span>
        {density === "detailed" ? (
          <span role="cell" data-label="Peek" className="hidden lg:flex flex-col min-w-0 gap-0.5">
            {item.peeks.slice(0, 2).map((p, i) => (
              <span key={`${p.at}-${p.kind}-${i}`} className="block truncate text-xs text-muted">{p.summary}</span>
            ))}
          </span>
        ) : null}
        {density === "risk" ? (
          <>
            <span role="cell" data-label="Payer" className="hidden lg:flex">
              <PayerChip band={band} />
            </span>
            <span role="cell" data-label="Days-to-pay" className="hidden lg:block font-mono text-xs text-muted tabular-nums">
              {formatDtp(item.payer?.daysToPay)}
            </span>
            <span role="cell" data-label="Reply" className="hidden lg:block font-mono text-xs text-muted tabular-nums">
              {formatReplyPct(item.payer?.replyRate)}
            </span>
          </>
        ) : null}
        <span role="cell" data-label="Owner" className="hidden xl:inline-flex items-center gap-1 rounded-full bg-panel border border-border px-2 py-0.5 text-xs text-muted font-sans whitespace-nowrap">
          <Icon name="user" size={12} aria-hidden />
          {item.owner}
        </span>
      </div>
      <span role="cell" className="hidden md:flex items-center gap-1 pr-3 opacity-0 group-hover:opacity-100 focus-within:opacity-100 pointer-events-none group-hover:pointer-events-auto focus-within:pointer-events-auto transition-opacity">
        {cased ? (
          <>
            <Link
              to={msgHref}
              aria-label={`Send text to ${item.customerName}`}
              onClick={(e) => e.stopPropagation()}
              className="flex items-center justify-center w-7 h-7 rounded border border-border bg-panel text-muted hover:text-copper hover:border-copper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper transition-colors"
            >
              <Icon name="message" size={14} aria-hidden />
            </Link>
            <Link
              to={logHref}
              aria-label={`Log call for ${item.customerName}`}
              onClick={(e) => e.stopPropagation()}
              className="flex items-center justify-center w-7 h-7 rounded border border-border bg-panel text-muted hover:text-copper hover:border-copper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper transition-colors"
            >
              <Icon name="phone" size={14} aria-hidden />
            </Link>
          </>
        ) : null}
      </span>
    </div>
  );
}

function InvoiceMobileCard({
  item, selected, view, sort, search, entity, density, hrefDensity, checked, onToggle, disabled, collision,
}: {
  item: InvoiceQueueItem; selected: boolean; view: ViewId; sort: SortId; search: string;
  entity: EntityMode; density: DensityId; hrefDensity?: DensityId;
  checked: boolean; onToggle: (id: string) => void; disabled: boolean; collision?: Collision;
}) {
  const chrome = { view, sort, q: search || undefined, entity, density: hrefDensity };
  const href = invoiceRowHref(item, chrome);
  const band: PayerBand = item.payer?.band ?? "unknown";
  const label = item.docNumber ? `${item.docNumber} · ${item.customerName}` : item.customerName;
  return (
    <div className={["flex gap-2 items-start bg-surface border rounded-lg p-3 mb-2", selected ? "border-copper ring-2 ring-copper bg-copper/5" : "border-border"].join(" ")}>
      <label className="pt-1 cursor-pointer" onClick={(e) => e.stopPropagation()}>
        <span className="sr-only">Select {label}</span>
        <input type="checkbox" checked={checked} onChange={() => onToggle(item.invoiceId)} disabled={disabled} className="h-4 w-4 rounded border-border text-copper focus-visible:ring-2 focus-visible:ring-copper" />
      </label>
      <Link to={href} aria-label={`Open ${label}`} aria-current={selected ? "true" : undefined} className="flex-1 min-w-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper rounded">
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="flex items-center gap-2 min-w-0">
            <ThermalBand heat={item.heat} />
            <div className="min-w-0">
              <p className="font-sans text-text font-medium truncate">{item.customerName}</p>
              <p className="font-mono text-xs text-muted truncate">{item.docNumber ?? "—"}</p>
            </div>
          </div>
          <span className="font-mono text-text tabular-nums text-right shrink-0 text-sm">{formatUSD(item.balance)}</span>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="font-mono text-muted tabular-nums">{item.dueDate ? formatDate(item.dueDate) : "—"}</span>
          <span className="font-mono text-muted tabular-nums">{item.ageDays > 0 ? `${item.ageDays}d` : "Due"}</span>
        </div>
        {collision ? <CollisionMarker collision={collision} /> : null}
        {density === "detailed" && item.peeks[0] ? (
          <p className="mt-1 text-xs text-muted truncate">{item.peeks[0].summary}</p>
        ) : null}
        {density === "risk" ? (
          <p className="mt-1 text-xs text-muted truncate">
            {PAYER_BAND_LABEL[band]} · {formatDtp(item.payer?.daysToPay)} · {formatReplyPct(item.payer?.replyRate)}
          </p>
        ) : null}
      </Link>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scroll window — measure the overflow container; render a pad + slice.
// ---------------------------------------------------------------------------

const FALLBACK_VIEWPORT_H = 960;
const MD_MIN = "(min-width: 768px)";

function useQueueScroller() {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(FALLBACK_VIEWPORT_H);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    let frame = 0;
    const readScroll = () => {
      frame = 0;
      setScrollTop(el.scrollTop);
    };
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(readScroll);
    };
    const onResize = () => {
      setViewportH(el.clientHeight || FALLBACK_VIEWPORT_H);
    };
    onResize();
    setScrollTop(el.scrollTop);
    el.addEventListener("scroll", onScroll, { passive: true });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(onResize) : null;
    ro?.observe(el);
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
      ro?.disconnect();
    };
  }, []);

  return { scrollerRef, scrollTop, viewportH };
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
  invoiceItems,
  entity,
  view,
  sort,
  search,
  density,
  densityFromUrl,
  tab,
  invoice,
  selectedCaseId,
  selectedInvoiceId,
  totalCount,
  viewCounts,
  roster,
  returnTo,
  collisions,
  smsEnabled,
  smsQuietNow,
  quietHoursLabel,
  comingDueGroups,
  comingDueDays,
  smsTemplates,
  orgCompany,
  orgPhone,
  orgPaymentLink,
  maxBatch,
  connected,
  timeZone,
}: WorkQueueProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [smsOpen, setSmsOpen] = useState(false);
  const nav = useNavigation();
  const searchRef = useSearchShortcut(selectedCaseId == null && selectedInvoiceId == null);
  // True only while a queue param change (view/sort/search/density) re-runs the
  // loader via GET navigation — bulk forms POST, so they don't trip this. We
  // overlay skeleton rows instead of letting the stale list sit visibly.
  const queueLoading = nav.state === "loading" && nav.formMethod !== "POST";
  const { scrollerRef, scrollTop, viewportH } = useQueueScroller();
  const hrefDensity = densityFromUrl ? density : undefined;
  const invoiceMode = entity === "invoices" && view !== "coming-due";
  const sortSelectValue = !invoiceMode && sort === "due-date" ? "most-overdue" : sort;
  const listCount = invoiceMode ? invoiceItems.length : items.length;
  const desk = visibleWindow({
    scrollTop,
    viewportH,
    rowH: queueRowHeight(density, false),
    count: listCount,
    overscan: QUEUE_OVERSCAN,
  });
  const mobile = visibleWindow({
    scrollTop,
    viewportH,
    rowH: queueRowHeight(density, true),
    count: listCount,
    overscan: QUEUE_OVERSCAN,
  });

  // Selection is per-view: clear it whenever the filter/sort/search changes
  // (the queue re-renders with a different item set on navigation).
  useEffect(() => {
    setSelected(new Set());
    setSmsOpen(false);
  }, [view, sort, search, entity]);

  // After a bulk action the loader revalidates without remounting (same filter
  // params), so items can change while `selected` keeps IDs that left the view.
  // Prune selection to currently-visible cases. (View/sort/search changes are
  // handled by the full-clear effect above.)
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const visible = new Set(
        invoiceMode ? invoiceItems.map((i) => i.invoiceId) : items.map((i) => i.caseId),
      );
      const next = new Set<string>();
      for (const id of prev) if (visible.has(id)) next.add(id);
      return next.size === prev.size ? prev : next; // subset-only: equal size ⇒ nothing pruned ⇒ no re-render
    });
  }, [items, invoiceItems, invoiceMode]);

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
      if (next.has(id)) {
        next.delete(id);
        return next;
      }
      if (!invoiceMode) {
        if (next.size < maxBatch) next.add(id);
        return next;
      }
      const row = invoiceItems.find((i) => i.invoiceId === id);
      const existing = new Set(
        invoiceItems.filter((i) => next.has(i.invoiceId) && i.caseId).map((i) => i.caseId as string),
      );
      if (row?.caseId && !existing.has(row.caseId) && existing.size >= maxBatch) return prev;
      next.add(id);
      return next;
    });

  const allVisibleIds = invoiceMode
    ? clampInvoiceBatch(invoiceItems, maxBatch)
    : clampBatch(items.map((i) => i.caseId), maxBatch);
  const allSelected = allVisibleIds.length > 0 && allVisibleIds.every((id) => selected.has(id));
  const toggleAll = () =>
    setSelected((prev) => (allSelected ? new Set() : new Set(allVisibleIds)));

  const headerRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (headerRef.current) {
      headerRef.current.indeterminate = !allSelected && allVisibleIds.some((id) => selected.has(id));
    }
  }, [allSelected, allVisibleIds, selected]);

  const selectedInvoiceRows = invoiceMode ? invoiceItems.filter((i) => selected.has(i.invoiceId)) : [];
  const selectedCaseIds = invoiceMode
    ? [...new Set(selectedInvoiceRows.map((i) => i.caseId).filter((id): id is string => id != null))]
    : [...selected];
  const capReached = invoiceMode
    ? selectedCaseIds.length >= maxBatch
    : selected.size >= maxBatch;
  const caselessSelected = invoiceMode ? selectedInvoiceRows.filter((i) => i.caseId == null).length : 0;
  const selectedCases = items.filter((i) => selectedCaseIds.includes(i.caseId));
  const eligibleCount = partitionEligibility(selectedCases).eligible.length;

  // j/k/x keyboard navigation
  const navigate = useNavigate();
  const location = useLocation();
  const handleQueueKey = useCallback((key: QueueKey) => {
    if (invoiceMode) {
      if (key === "x") {
        if (selectedInvoiceId) toggle(selectedInvoiceId);
        return;
      }
      const currentIdx = selectedInvoiceId
        ? invoiceItems.findIndex((i) => i.invoiceId === selectedInvoiceId)
        : -1;
      const nextIdx = key === "j"
        ? Math.min(currentIdx + 1, invoiceItems.length - 1)
        : currentIdx - 1;
      const target = invoiceItems[nextIdx];
      if (!target) return;
      if (target.caseId) {
        navigate(dashboardHref({
          view, sort, q: search || undefined, entity, density: hrefDensity,
          case: target.caseId, invoice: target.invoiceId,
        }));
      } else if (target.customerId) {
        navigate(`/accounts/${target.customerId}`);
      }
      return;
    }
    if (key === "x") {
      if (selectedCaseId) toggle(selectedCaseId);
      return;
    }
    const currentIdx = selectedCaseId
      ? items.findIndex((i) => i.caseId === selectedCaseId)
      : -1;
    const nextIdx = key === "j"
      ? Math.min(currentIdx + 1, items.length - 1)  // no selection → 0 (first), at end → stays
      : currentIdx - 1;                              // k: move up
    const target = items[nextIdx];
    if (target) {
      navigate(dashboardHref({ view, sort, q: search || undefined, entity, density: hrefDensity, case: target.caseId }));
    }
  }, [invoiceMode, invoiceItems, items, selectedCaseId, selectedInvoiceId, view, sort, search, entity, hrefDensity, navigate, toggle]);

  useQueueKeys({ enabled: true, onAction: handleQueueKey });

  // First landing: restore density from localStorage once when the URL has no param.
  useEffect(() => {
    if (densityFromUrl) return;
    let stored: string | null = null;
    try { stored = localStorage.getItem(DENSITY_STORAGE_KEY); } catch { return; }
    const next = parseDensity(stored);
    if (stored !== "general" && stored !== "detailed" && stored !== "risk") return;
    persistDensity(next);
    navigate(withDensityParam(location.search, next), { replace: true });
  // First landing only — URL is source of truth after a density click.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the selected row in the scrollport so j/k (and deep-links) still land
  // on a mounted row after windowing.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const idx = invoiceMode
      ? (selectedInvoiceId ? invoiceItems.findIndex((i) => i.invoiceId === selectedInvoiceId) : -1)
      : (selectedCaseId ? items.findIndex((i) => i.caseId === selectedCaseId) : -1);
    if (idx < 0) return;
    const desktop = typeof window !== "undefined" && window.matchMedia(MD_MIN).matches;
    const rowH = queueRowHeight(density, !desktop);
    const rowTop = idx * rowH;
    const rowBottom = rowTop + rowH;
    const viewTop = el.scrollTop;
    const viewBottom = el.scrollTop + el.clientHeight;
    if (rowTop < viewTop) el.scrollTop = rowTop;
    else if (rowBottom > viewBottom) el.scrollTop = Math.max(0, rowBottom - el.clientHeight);
  }, [selectedCaseId, selectedInvoiceId, items, invoiceItems, invoiceMode, scrollerRef, density]);

  const emptyCopy = emptyQueueCopy({ connected, view, q: search });

  return (
    <section className="flex flex-col min-h-0" aria-labelledby="work-queue-title">
      {/* Header + toolbar (single band) */}
      <div className="flex min-w-0 flex-wrap items-center gap-3 px-6 py-3 border-b border-border bg-paper">
        <div className="min-w-0 shrink-0">
          <h2
            id="work-queue-title"
            className="font-display text-lg font-semibold text-text leading-tight"
          >
            Work queue
          </h2>
          <p className="font-sans text-xs text-muted">
            {invoiceMode
              ? `${invoiceItems.length} matching invoices · ${totalCount} open invoices`
              : `${items.length} matching · ${totalCount} open`}
          </p>
          <p className="hidden md:block font-mono text-[10px] text-muted/60">
            <kbd className="px-0.5">j</kbd>/<kbd className="px-0.5">k</kbd> move · <kbd className="px-0.5">x</kbd> select
          </p>
        </div>

        {view === "coming-due" ? (
          <p className="font-sans text-xs text-muted max-w-xs">
            Coming due is invoice-grouped. Switch to All open to use Customers vs Invoices.
          </p>
        ) : (
          <div className="flex shrink-0 items-center rounded-md border border-border bg-panel p-0.5" aria-label="Queue entity">
            {ENTITY_MODES.map((id) => (
              <Link
                key={id}
                to={dashboardHref({
                  view,
                  sort: id === "customers" && sort === "due-date" ? "most-overdue" : sort,
                  q: search || undefined,
                  entity: id,
                  density: hrefDensity,
                  case: selectedCaseId,
                  tab,
                  invoice,
                })}
                aria-pressed={entity === id}
                className={[
                  "px-2.5 h-8 inline-flex items-center rounded text-xs font-sans font-medium transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper",
                  entity === id ? "bg-ink text-surface" : "text-muted hover:text-text",
                ].join(" ")}
              >
                {ENTITY_LABEL[id]}
              </Link>
            ))}
          </div>
        )}

        <div className="flex shrink-0 items-center rounded-md border border-border bg-panel p-0.5" aria-label="Queue density">
          {DENSITY_IDS.map((id) => (
            <Link
              key={id}
              to={dashboardHref({ view, sort, q: search || undefined, entity, density: id, case: selectedCaseId, tab, invoice })}
              aria-pressed={density === id}
              onClick={() => persistDensity(id)}
              className={[
                "px-2.5 h-8 inline-flex items-center rounded text-xs font-sans font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper",
                density === id ? "bg-ink text-surface" : "text-muted hover:text-text",
              ].join(" ")}
            >
              {DENSITY_LABEL[id]}
            </Link>
          ))}
        </div>

        {/* GET form; submit preserves view + entity + density via hidden inputs (not sort). */}
        <Form method="get" className="flex min-w-0 flex-[1_1_420px] flex-wrap items-center justify-end gap-2">
          <input type="hidden" name="view" value={view} />
          {entity !== "customers" ? <input type="hidden" name="entity" value={entity} /> : null}
          {hrefDensity ? <input type="hidden" name="density" value={hrefDensity} /> : null}

          {/* Search input */}
          <label className="flex min-w-[12rem] flex-[1_1_14rem] items-center gap-1.5 rounded-md border border-border bg-panel px-2.5 h-9 text-sm text-text focus-within:ring-2 focus-within:ring-copper focus-within:border-transparent transition-shadow">
            <Icon name="search" size={15} className="text-muted shrink-0" />
            <span className="sr-only">Search queue</span>
            <input
              ref={searchRef}
              name="q"
              type="search"
              defaultValue={search}
              placeholder="Search…"
              className="flex-1 min-w-0 bg-transparent border-none outline-none font-sans text-sm text-text placeholder:text-muted"
            />
          </label>

          {/* Sort select */}
          <label className="flex min-w-0 max-w-full items-center gap-1.5 rounded-md border border-border bg-panel px-2.5 h-9 text-sm text-text focus-within:ring-2 focus-within:ring-copper focus-within:border-transparent transition-shadow cursor-pointer">
            <Icon name="arrowDownUp" size={15} className="text-muted shrink-0" />
            <span className="sr-only">Sort work queue</span>
            <select
              key={invoiceMode ? "invoices" : "customers"}
              name="sort"
              value={sortSelectValue}
              onChange={(e) => e.currentTarget.form?.requestSubmit()}
              className="min-w-0 max-w-full bg-transparent border-none outline-none font-sans text-sm text-text cursor-pointer"
            >
              {(invoiceMode ? SORT_OPTIONS_INVOICES : SORT_OPTIONS_CUSTOMERS).map((opt) => (
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
          <a
            href={`/queue.csv${dashboardHref({ view, sort, q: search || undefined, entity, density: hrefDensity })}`}
            className="rounded-md border border-border bg-panel px-3 h-9 inline-flex items-center text-xs font-sans text-muted hover:text-text hover:border-copper transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
          >
            Export CSV
          </a>
        </Form>
      </div>

      {/* Saved-view tabs — scroll-fade on the right hints that more views exist */}
      <div className="relative border-b border-border bg-paper">
        <nav
          aria-label="Saved queue views"
          className="flex gap-1 overflow-x-auto px-3.5 py-2 scrollbar-none"
        >
        {SAVED_VIEWS.map((sv) => {
          const isActive = view === sv.id;
          return (
            <Link
              key={sv.id}
              to={dashboardHref({ view: sv.id, sort, q: search || undefined, entity, density: hrefDensity })}
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
        {/* Right-edge scroll-fade — signals more saved views beyond the visible area */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-paper to-transparent"
        />
      </div>

      {/* Column header stays static above the scroller (not virtualized). Hidden < md. */}
      {view !== "coming-due" && listCount > 0 ? (
        <div className="hidden md:block shrink-0">
          <div className="flex items-center px-4 py-2 border-b border-border bg-paper">
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
            <div className={`flex-1 grid items-center gap-x-6 ${queueGrid(density, invoiceMode ? "invoices" : "customers")}`} aria-hidden="true">
              {invoiceMode ? (
                <>
                  <span className="font-sans text-xs text-muted uppercase tracking-wide">Heat</span>
                  <span className="font-sans text-xs text-muted uppercase tracking-wide">Doc #</span>
                  <span className="font-sans text-xs text-muted uppercase tracking-wide">Customer</span>
                  <span className="font-sans text-xs text-muted uppercase tracking-wide text-right">Balance</span>
                  {density !== "risk" ? (
                    <span className="font-sans text-xs text-muted uppercase tracking-wide hidden lg:block">Due</span>
                  ) : null}
                  <span className="font-sans text-xs text-muted uppercase tracking-wide hidden lg:block">Age</span>
                  {density === "detailed" ? (
                    <span className="font-sans text-xs text-muted uppercase tracking-wide hidden lg:block">Peek</span>
                  ) : null}
                  {density === "risk" ? (
                    <>
                      <span className="font-sans text-xs text-muted uppercase tracking-wide hidden lg:block">Payer</span>
                      <span className="font-sans text-xs text-muted uppercase tracking-wide hidden lg:block">DTP</span>
                      <span className="font-sans text-xs text-muted uppercase tracking-wide hidden lg:block">Reply</span>
                    </>
                  ) : null}
                  <span className="font-sans text-xs text-muted uppercase tracking-wide hidden xl:block">Owner</span>
                </>
              ) : (
                <>
                  <span className="font-sans text-xs text-muted uppercase tracking-wide">Heat</span>
                  <span className="font-sans text-xs text-muted uppercase tracking-wide">Customer</span>
                  <span className="font-sans text-xs text-muted uppercase tracking-wide text-right">Total overdue</span>
                  <span className="font-sans text-xs text-muted uppercase tracking-wide">Oldest age</span>
                  {density === "detailed" ? (
                    <span className="font-sans text-xs text-muted uppercase tracking-wide hidden lg:block">Peek</span>
                  ) : null}
                  {density === "risk" ? (
                    <>
                      <span className="font-sans text-xs text-muted uppercase tracking-wide hidden lg:block">Payer</span>
                      <span className="font-sans text-xs text-muted uppercase tracking-wide hidden lg:block">DTP</span>
                      <span className="font-sans text-xs text-muted uppercase tracking-wide hidden lg:block">Reply</span>
                    </>
                  ) : null}
                  {density !== "detailed" ? (
                    <span className={`font-sans text-xs text-muted uppercase tracking-wide ${density === "risk" ? "hidden xl:block" : "hidden lg:block"}`}>Last contact</span>
                  ) : null}
                  {density !== "risk" ? (
                    <span className="font-sans text-xs text-muted uppercase tracking-wide hidden lg:block">Status</span>
                  ) : null}
                  <span className="font-sans text-xs text-muted uppercase tracking-wide hidden xl:block">Owner</span>
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {/* Table / cards content */}
      <div ref={scrollerRef} className="relative flex-1 overflow-auto bg-surface">
        {/* Skeleton overlay while a queue filter/sort/search GET re-runs the loader */}
        {queueLoading && view !== "coming-due" && listCount > 0 ? (
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-10 bg-surface/60 animate-[fade-in_150ms_ease-in]">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 border-b border-border px-8 py-3">
                <Skeleton className="h-4 w-4 rounded" />
                <Skeleton className="h-3.5 w-40" />
                <Skeleton className="ml-auto h-3.5 w-20" />
                <Skeleton className="h-3.5 w-14 hidden md:block" />
                <Skeleton className="h-3.5 w-24 hidden lg:block" />
              </div>
            ))}
          </div>
        ) : null}
        {view === "coming-due" ? (
          <ComingDueList groups={comingDueGroups} comingDueDays={comingDueDays} />
        ) : listCount === 0 ? (
          /* Empty state */
          <div className="flex flex-col items-center justify-center gap-3 py-16 px-6 text-center">
            <div className="w-10 h-10 rounded-full bg-paper flex items-center justify-center">
              <Icon name="filter" size={20} className="text-muted" />
            </div>
            <p className="font-sans text-text font-medium">{emptyCopy.title}</p>
            {emptyCopy.clearSearch ? (
              <p className="font-sans text-sm text-muted max-w-xs">
                <Link to={dashboardHref({ view: "all-open", sort, entity, density: hrefDensity })} className="text-copper hover:underline font-medium">Clear the search</Link>{" "}
                or pick another view.
              </p>
            ) : null}
          </div>
        ) : (
          <>
            {/* ── Desktop table (md+) ─────────────────────────────────── */}
            <div className="hidden md:block" role="table" aria-label="Work queue">
              <div role="row" className="sr-only">
                <span role="columnheader">Select</span>
                <span role="columnheader">Heat</span>
                {invoiceMode ? <span role="columnheader">Doc #</span> : null}
                <span role="columnheader">Customer</span>
                {invoiceMode ? (
                  <>
                    <span role="columnheader">Balance</span>
                    {density !== "risk" ? <span role="columnheader">Due</span> : null}
                    <span role="columnheader">Age</span>
                  </>
                ) : (
                  <>
                    <span role="columnheader">Total overdue</span>
                    <span role="columnheader">Oldest age</span>
                  </>
                )}
                {density === "detailed" ? <span role="columnheader">Peek</span> : null}
                {density === "risk" ? (
                  <>
                    <span role="columnheader">Payer</span>
                    <span role="columnheader">Days-to-pay</span>
                    <span role="columnheader">Reply</span>
                  </>
                ) : null}
                {!invoiceMode && density !== "detailed" ? <span role="columnheader">Last contact</span> : null}
                {!invoiceMode && density !== "risk" ? <span role="columnheader">Status</span> : null}
                <span role="columnheader">Owner</span>
                <span role="columnheader">Actions</span>
              </div>
              {/* Rows — only the visible window (+ overscan) is mounted. */}
              <div
                role="rowgroup"
                style={{ paddingTop: desk.padTop, paddingBottom: desk.padBottom, overflowAnchor: "none" }}
              >
                {invoiceMode
                  ? invoiceItems.slice(desk.start, desk.end).map((item) => (
                    <InvoiceQueueRow
                      key={item.invoiceId}
                      item={item}
                      selected={selectedInvoiceId === item.invoiceId}
                      view={view}
                      sort={sort}
                      search={search}
                      entity={entity}
                      density={density}
                      hrefDensity={hrefDensity}
                      checked={selected.has(item.invoiceId)}
                      onToggle={toggle}
                       disabled={!selected.has(item.invoiceId) && capReached && item.caseId != null && !selectedCaseIds.includes(item.caseId)}
                      collision={item.caseId ? collisions[item.caseId] : undefined}
                    />
                  ))
                  : items.slice(desk.start, desk.end).map((item) => (
                    <QueueRow
                      key={item.caseId}
                      item={item}
                      selected={selectedCaseId === item.caseId}
                      view={view}
                      sort={sort}
                      search={search}
                      entity={entity}
                      density={density}
                      hrefDensity={hrefDensity}
                      checked={selected.has(item.caseId)}
                      onToggle={toggle}
                      disabled={!selected.has(item.caseId) && capReached}
                      collision={collisions[item.caseId]}
                      timeZone={timeZone}
                    />
                  ))}
              </div>
            </div>

            {/* ── Mobile cards (< md) ─────────────────────────────────── */}
            <div
              className="md:hidden p-3"
              role="list"
              aria-label="Work queue items"
              style={{ paddingTop: 12 + mobile.padTop, paddingBottom: 12 + mobile.padBottom, overflowAnchor: "none" }}
            >
              {invoiceMode
                ? invoiceItems.slice(mobile.start, mobile.end).map((item) => (
                  <div key={item.invoiceId} role="listitem">
                    <InvoiceMobileCard
                      item={item}
                      selected={selectedInvoiceId === item.invoiceId}
                      view={view}
                      sort={sort}
                      search={search}
                      entity={entity}
                      density={density}
                      hrefDensity={hrefDensity}
                      checked={selected.has(item.invoiceId)}
                      onToggle={toggle}
                       disabled={!selected.has(item.invoiceId) && capReached && item.caseId != null && !selectedCaseIds.includes(item.caseId)}
                      collision={item.caseId ? collisions[item.caseId] : undefined}
                    />
                  </div>
                ))
                : items.slice(mobile.start, mobile.end).map((item) => (
                  <div key={item.caseId} role="listitem">
                    <MobileCard
                      item={item}
                      selected={selectedCaseId === item.caseId}
                      view={view}
                      sort={sort}
                      search={search}
                      entity={entity}
                      density={density}
                      hrefDensity={hrefDensity}
                      checked={selected.has(item.caseId)}
                      onToggle={toggle}
                      disabled={!selected.has(item.caseId) && capReached}
                      collision={collisions[item.caseId]}
                      timeZone={timeZone}
                    />
                  </div>
                ))}
            </div>
          </>
        )}
      </div>

      {selected.size > 0 ? (
        <BulkActionBar
          selectedCaseIds={selectedCaseIds}
          eligibleCount={eligibleCount}
          roster={roster}
          returnTo={returnTo}
          onClear={() => setSelected(new Set())}
          onOpenSms={() => setSmsOpen(true)}
          maxBatch={maxBatch}
          statusLabel={invoiceMode ? `${selected.size} invoices · ${selectedCaseIds.length} accounts` : undefined}
          skipReason={caselessSelected > 0 ? "Invoices without an open case skipped." : undefined}
        />
      ) : null}
      <BulkSmsDrawer
        open={smsOpen}
        onClose={() => setSmsOpen(false)}
        cases={selectedCases}
        returnTo={returnTo}
        smsEnabled={smsEnabled}
        smsQuietNow={smsQuietNow}
        quietHoursLabel={quietHoursLabel}
        smsTemplates={smsTemplates}
        orgCompany={orgCompany}
        orgPhone={orgPhone}
        orgPaymentLink={orgPaymentLink}
        maxBatch={maxBatch}
      />
    </section>
  );
}
