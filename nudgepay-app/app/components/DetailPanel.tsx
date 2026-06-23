import { Link } from "react-router";
import { type WorkItem } from "~/lib/worklist";
import { Icon } from "~/components/Icons";
import type { ActivityEntry } from "~/routes/dashboard";

// Static tone-to-text-color map — priority.tone and nextAction.tone → Tailwind class.
// Must be literal strings so Tailwind can tree-shake them; no dynamic construction.
const TONE_CLASS: Record<string, string> = {
  hot: "text-hot",
  warm: "text-warm",
  cool: "text-cool",
  neutral: "text-muted",
};

function formatDueDate(dueDate: string | null): string {
  if (!dueDate) return "—";
  try {
    return new Date(dueDate).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return "—";
  }
}

function formatUSD(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(amount);
}

const METHOD_ICON: Record<string, "phone" | "mail" | "message" | "note"> = {
  call: "phone", email: "mail", text: "message", note: "note",
};
const OUTCOME_TEXT: Record<string, string> = {
  "promise-to-pay": "Promise to pay",
  dispute: "Dispute",
  "no-commitment": "No commitment",
  "left-voicemail": "Left voicemail",
  "no-answer": "No answer",
  other: "Logged",
};
function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch { return "—"; }
}
function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function InfoRow({ label, value, tone }: { label: string; value: string; tone?: string }) {
  const toneClass = tone ? (TONE_CLASS[tone] ?? "text-text") : "text-text";
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-sans font-medium uppercase tracking-wider text-muted">
        {label}
      </span>
      <span className={`text-sm font-sans font-semibold ${toneClass}`}>{value}</span>
    </div>
  );
}

function PlaceholderTab({
  heading,
  description,
  panelId,
  tabId,
}: {
  heading: string;
  description: string;
  panelId: string;
  tabId: string;
}) {
  return (
    <section
      id={panelId}
      role="tabpanel"
      aria-labelledby={tabId}
      className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-12 text-center"
    >
      <p className="text-sm font-sans font-semibold text-text">{heading}</p>
      <p className="text-xs text-muted max-w-xs">Coming in the next update.</p>
      <p className="text-xs text-muted max-w-xs">{description}</p>
    </section>
  );
}

// ─── Tabs definition ───────────────────────────────────────────────────────────

const TABS = [
  { id: "overview" as const, label: "Overview" },
  { id: "activity" as const, label: "Activity" },
  { id: "messages" as const, label: "Messages" },
];

// ─── Main export ───────────────────────────────────────────────────────────────

export function DetailPanel({
  selected,
  activeTab,
  activity,
  view,
  sort,
  q,
}: {
  selected: WorkItem | null;
  activeTab: "overview" | "activity" | "messages";
  activity: ActivityEntry[];
  view: string;
  sort: string;
  q: string;
}) {
  // ── Empty state ────────────────────────────────────────────────────────────
  if (selected === null) {
    return (
      <aside
        aria-label="Selected account"
        className="flex flex-col items-center justify-center gap-3 bg-surface border-l border-border px-8 py-16 text-center h-full"
      >
        <Icon name="bookmark" size={32} className="text-border" aria-hidden />
        <p className="text-sm font-sans font-semibold text-text">
          Select an account from the work queue.
        </p>
        <p className="text-xs text-muted max-w-xs">
          The account overview, activity history, and messages will appear here
          once you select an account.
        </p>
      </aside>
    );
  }

  // ── Derived values ─────────────────────────────────────────────────────────
  const dueDateFormatted = formatDueDate(selected.dueDate);
  const docLabel = selected.docNumber ?? selected.invoiceId;
  const logHref = `?${new URLSearchParams({ invoice: selected.invoiceId, tab: "activity", view, sort, ...(q ? { q } : {}), log: "1" }).toString()}`;

  return (
    <aside
      aria-label={`Selected account ${selected.customerName}`}
      className="flex flex-col bg-surface border-l border-border h-full overflow-y-auto"
    >
      {/* Mobile: back to queue */}
      <div className="md:hidden px-4 pt-3 pb-1">
        <Link
          to="?"
          className="inline-flex items-center gap-1 text-xs text-muted hover:text-copper focus:outline-none focus-visible:ring-2 focus-visible:ring-copper rounded"
        >
          <Icon name="chevronRight" size={13} className="rotate-180" aria-hidden />
          Back to queue
        </Link>
      </div>

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="px-5 pt-4 pb-3 border-b border-border">
        {/* Kicker */}
        <p className="text-xs font-sans font-medium uppercase tracking-wider text-muted mb-1">
          Selected account
        </p>

        {/* Customer name */}
        <h2 className="font-display text-xl font-semibold text-text leading-tight mb-1">
          {selected.customerName}
        </h2>

        {/* Invoice · due · age */}
        <p className="text-sm text-muted font-sans mb-3">
          {docLabel}
          <span className="mx-1.5 text-border select-none">·</span>
          Due {dueDateFormatted}
          <span className="mx-1.5 text-border select-none">·</span>
          <span className="font-mono text-text">{selected.ageDays}</span>
          <span className="font-mono text-text">d overdue</span>
        </p>

        {/* Dual balance grid */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="flex flex-col gap-0.5 bg-panel rounded-md px-3 py-2">
            <span className="text-xs font-sans text-muted uppercase tracking-wider font-medium">
              Invoice balance
            </span>
            <span className="font-mono text-base font-semibold text-text tabular-nums">
              {formatUSD(selected.balance)}
            </span>
          </div>
          <div className="flex flex-col gap-0.5 bg-panel rounded-md px-3 py-2">
            <span className="text-xs font-sans text-muted uppercase tracking-wider font-medium">
              Customer open balance
            </span>
            <span className="font-mono text-base font-semibold text-text tabular-nums">
              {formatUSD(selected.customerBalance)}
            </span>
          </div>
        </div>

        {/* Action row */}
        <div
          role="group"
          aria-label="Account actions"
          className="flex flex-wrap gap-2"
        >
          {/* Call — omit if no phone */}
          {selected.phone ? (
            <a
              href={`tel:${selected.phone}`}
              className="inline-flex items-center gap-1.5 text-xs font-sans font-medium text-copper border border-copper/40 rounded-md px-3 py-1.5 hover:bg-copper/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-copper transition-colors"
            >
              <Icon name="phone" size={14} aria-hidden />
              Call
            </a>
          ) : null}

          {/* Text → /invoices/:invoiceId */}
          <Link
            to={`/invoices/${selected.invoiceId}`}
            className="inline-flex items-center gap-1.5 text-xs font-sans font-medium text-copper border border-copper/40 rounded-md px-3 py-1.5 hover:bg-copper/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-copper transition-colors"
          >
            <Icon name="message" size={14} aria-hidden />
            Text
          </Link>

          {/* Email — omit if no email */}
          {selected.email ? (
            <a
              href={`mailto:${selected.email}`}
              className="inline-flex items-center gap-1.5 text-xs font-sans font-medium text-copper border border-copper/40 rounded-md px-3 py-1.5 hover:bg-copper/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-copper transition-colors"
            >
              <Icon name="mail" size={14} aria-hidden />
              Email
            </a>
          ) : null}

          {/* Log — opens the log-contact drawer */}
          <Link
            to={logHref}
            className="inline-flex items-center gap-1.5 text-xs font-sans font-medium text-copper border border-copper/40 rounded-md px-3 py-1.5 hover:bg-copper/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-copper transition-colors"
          >
            <Icon name="note" size={14} aria-hidden />
            Log
          </Link>
        </div>
      </div>

      {/* ── Tab bar ─────────────────────────────────────────────────────────── */}
      <div
        role="tablist"
        aria-label="Selected account sections"
        className="flex border-b border-border shrink-0"
      >
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <Link
              key={tab.id}
              to={`?${new URLSearchParams({ invoice: selected.invoiceId, tab: tab.id, view, sort, ...(q ? { q } : {}) }).toString()}`}
              id={`${tab.id}-tab`}
              role="tab"
              aria-selected={isActive ? "true" : "false"}
              aria-controls={`${tab.id}-panel`}
              className={[
                "px-4 py-2.5 text-xs font-sans font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-copper rounded-t transition-colors",
                isActive
                  ? "border-b-2 border-copper text-copper -mb-px"
                  : "text-muted hover:text-text",
              ].join(" ")}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>

      {/* ── Tab panels ──────────────────────────────────────────────────────── */}

      {activeTab === "overview" ? (
        <section
          id="overview-panel"
          role="tabpanel"
          aria-labelledby="overview-tab"
          className="flex-1 px-5 py-4"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <InfoRow
              label="Priority reason"
              value={selected.priority.reason}
              tone={selected.priority.tone}
            />
            <InfoRow
              label="Next action"
              value={selected.nextAction.label}
              tone={selected.nextAction.tone}
            />
            <InfoRow label="Owner" value={selected.owner || "Unassigned"} />
            <InfoRow label="Phone" value={selected.phone ?? "—"} />
            <InfoRow label="Email" value={selected.email ?? "—"} />
            <InfoRow label="Open invoices" value={String(selected.invoiceCount)} />
          </div>
        </section>
      ) : null}

      {activeTab === "activity" ? (
        <section id="activity-panel" role="tabpanel" aria-labelledby="activity-tab" className="flex-1 px-5 py-4">
          {activity.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
              <Icon name="note" size={24} className="text-border" aria-hidden />
              <p className="text-sm font-sans font-semibold text-text">No contact logged yet.</p>
              <p className="text-xs text-muted max-w-xs">Use Log to record a call or note.</p>
            </div>
          ) : (
            <ol className="flex flex-col gap-3">
              {(() => {
                const today = todayISO();
                return activity.map((a) => {
                const broken = a.promisedDate != null && a.promisedDate < today;
                return (
                  <li key={a.id} className="flex gap-3 border-b border-border pb-3 last:border-0">
                    <span className="mt-0.5 text-muted shrink-0">
                      <Icon name={METHOD_ICON[a.method] ?? "note"} size={15} aria-hidden />
                    </span>
                    <div className="min-w-0 flex flex-col gap-0.5">
                      <span className="text-sm font-sans font-semibold text-text">
                        {OUTCOME_TEXT[a.outcome ?? "other"] ?? "Logged"}
                      </span>
                      <span className="font-mono text-xs text-muted">{formatDateTime(a.createdAt)}</span>
                      {a.promisedAmount != null && a.promisedDate != null && (
                        <span className={`text-xs font-sans font-medium ${broken ? "text-hot" : "text-text"}`}>
                          Promised {formatUSD(a.promisedAmount)} by {formatDateTime(a.promisedDate)}
                          {broken ? " · broken" : ""}
                        </span>
                      )}
                      {a.followUpAt && (
                        <span className="text-xs font-sans text-muted">Follow up {formatDateTime(a.followUpAt)}</span>
                      )}
                      {a.notes && <span className="text-xs text-muted whitespace-pre-wrap">{a.notes}</span>}
                    </div>
                  </li>
                );
              });
              })()}
            </ol>
          )}
        </section>
      ) : null}

      {activeTab === "messages" ? (
        <PlaceholderTab
          panelId="messages-panel"
          tabId="messages-tab"
          heading="Message thread"
          description="The full SMS conversation with this customer, plus message templates, will appear here once the Messages feature ships."
        />
      ) : null}
    </aside>
  );
}
