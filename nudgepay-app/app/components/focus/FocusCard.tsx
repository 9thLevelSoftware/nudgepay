// Focus Mode — single case card. Dark theme (parent is bg-ink). Shows heat,
// priority badge, "Why now" callout, contact/invoices grid, and action row
// with keyboard hints.

import type { CaseItem, CaseInvoice } from "../../lib/cases";
import type { WhyNow } from "../../lib/next-best-action";
import { formatUSD } from "../../lib/format";
import { formatDate } from "../../lib/dates";
import { ThermalBand } from "../ThermalBand";

// Static effective-level → badge classes (Tailwind v4 needs literal strings).
const LEVEL_BADGE: Record<string, string> = {
  Critical: "bg-hot/10 text-hot",
  High: "bg-warm/10 text-warm",
  Medium: "bg-warm/5 text-warm",
  Low: "bg-cool/10 text-cool",
};

// Max invoices to show before collapsing with "+N more".
const MAX_INVOICES = 4;

interface FocusCardProps {
  item: CaseItem;
  whyNow: WhyNow;
  index: number;
  total: number;
  /** Which mini-form is open — dims action buttons. */
  openForm: "call" | "text" | null;
  onAction: (action: "call" | "text" | "snooze") => void;
  /** True when a fetcher is in-flight (disables action buttons). */
  busy: boolean;
  /** Whether SMS sending is available at the workspace level. */
  smsEnabled: boolean;
}

export function FocusCard({
  item, whyNow, index, total, openForm, onAction, busy, smsEnabled,
}: FocusCardProps) {
  const badge = LEVEL_BADGE[item.effectiveLevel] ?? "bg-muted/10 text-muted";
  const invoices = item.invoices;
  const shown = invoices.slice(0, MAX_INVOICES);
  const extra = invoices.length - MAX_INVOICES;

  return (
    <div className="mx-auto w-full max-w-2xl rounded-xl border border-white/10 bg-white/5 p-6 shadow-lg">
      {/* Header: position / heat / level badge */}
      <div className="flex items-center justify-between gap-3 mb-4">
        <span className="font-mono text-xs text-muted">
          {index + 1} of {total}
        </span>
        <div className="flex items-center gap-2">
          <ThermalBand heat={item.heat} />
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${badge}`}>
            {item.effectiveLevel}
          </span>
        </div>
      </div>

      {/* Customer name + total */}
      <h2 className="text-xl font-display font-bold text-surface leading-tight truncate">
        {item.customerName}
      </h2>
      <p className="mt-1 font-mono text-lg text-copper font-semibold">
        {formatUSD(item.totalOverdue)}
        <span className="ml-2 text-xs text-muted font-normal">
          {item.invoiceCount} {item.invoiceCount === 1 ? "invoice" : "invoices"}
        </span>
      </p>

      {/* Why now callout */}
      <div className="mt-4 rounded-lg border border-copper/20 bg-copper/5 px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-copper mb-1">
          Why now
        </p>
        <p className="text-sm font-sans font-semibold text-surface leading-snug">
          {whyNow.headline}
        </p>
        {whyNow.reason && (
          <p className="mt-1 text-xs text-muted leading-relaxed">{whyNow.reason}</p>
        )}
      </div>

      {/* Contact info */}
      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted">
        <div>
          <span className="text-muted/60">Phone</span>{" "}
          <span className="text-surface">{item.phone ?? "—"}</span>
        </div>
        <div>
          <span className="text-muted/60">Email</span>{" "}
          <span className="text-surface">{item.email ?? "—"}</span>
        </div>
        {item.lastContact && (
          <div className="col-span-2">
            <span className="text-muted/60">Last contact</span>{" "}
            <span className="text-surface">
              {item.lastContact.channel} · {formatDate(item.lastContact.date)}
            </span>
          </div>
        )}
        {item.owner && (
          <div className="col-span-2">
            <span className="text-muted/60">Owner</span>{" "}
            <span className="text-surface">{item.owner}</span>
          </div>
        )}
      </div>

      {/* Invoices grid */}
      {shown.length > 0 && (
        <div className="mt-4">
          <p className="text-[10px] uppercase tracking-wider text-muted/60 mb-1.5">Invoices</p>
          <div className="space-y-1">
            {shown.map((inv, i) => (
              <InvoiceRow key={inv.invoiceId} inv={inv} isOldest={i === 0} />
            ))}
            {extra > 0 && (
              <p className="text-xs text-muted">+{extra} more</p>
            )}
          </div>
        </div>
      )}

      {/* Action row */}
      <div className="mt-6 flex items-center gap-3">
        <ActionButton
          label="Log call"
          kbd="1"
          active={openForm === "call"}
          disabled={busy}
          onClick={() => onAction("call")}
        />
        <ActionButton
          label="Send text"
          kbd="2"
          active={openForm === "text"}
          disabled={busy || !smsEnabled}
          onClick={() => onAction("text")}
        />
        <ActionButton
          label="Snooze"
          kbd="3"
          disabled={busy}
          onClick={() => onAction("snooze")}
        />
        <div className="ml-auto text-xs text-muted/60">
          <kbd className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[10px]">
            space
          </kbd>{" "}
          skip
        </div>
      </div>
    </div>
  );
}

// ── Invoice row ─────────────────────────────────────────────────────────────

function InvoiceRow({ inv, isOldest }: { inv: CaseInvoice; isOldest: boolean }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="font-mono text-surface">
        #{inv.docNumber ?? "—"}
      </span>
      <span className="text-muted">
        {formatUSD(inv.balance)}
      </span>
      <span className="text-muted/60">
        due {formatDate(inv.dueDate)}
      </span>
      {isOldest && (
        <span className="rounded bg-hot/10 px-1 py-0.5 text-[9px] font-semibold uppercase text-hot">
          oldest
        </span>
      )}
    </div>
  );
}

// ── Action button ───────────────────────────────────────────────────────────

function ActionButton({
  label, kbd, active, disabled, onClick,
}: {
  label: string;
  kbd: string;
  active?: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={[
        "flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-sans font-semibold transition-colors",
        active
          ? "border-copper bg-copper/15 text-copper"
          : "border-white/10 bg-white/5 text-surface hover:bg-white/10",
        disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer",
      ].join(" ")}
    >
      <kbd className="rounded border border-white/10 bg-white/5 px-1 py-0.5 font-mono text-[10px] text-muted">
        {kbd}
      </kbd>
      {label}
    </button>
  );
}
