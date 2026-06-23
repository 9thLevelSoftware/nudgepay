import { useState } from "react";
import { Link } from "react-router";
import { type WorkItem } from "~/lib/worklist";
import { Icon } from "~/components/Icons";
import { SMS_TEMPLATES, applyTemplate, type TemplateVars } from "~/lib/sms-templates";
import type { ActivityEntry, MessageEntry, RosterMember } from "~/routes/dashboard";

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

// Static direction → bubble alignment/color. Literal strings for Tailwind.
const BUBBLE: Record<string, { wrap: string; bubble: string }> = {
  outbound: { wrap: "items-end", bubble: "bg-copper/10 text-text border border-copper/30" },
  inbound: { wrap: "items-start", bubble: "bg-panel text-text border border-border" },
};
const SMS_BANNER: Record<string, { text: string; tone: string }> = {
  sent: { text: "Text sent.", tone: "text-cool" },
  noconsent: { text: "Not sent — customer has not consented to SMS.", tone: "text-hot" },
  error: { text: "Could not send the text.", tone: "text-hot" },
};

function MessagesTab({
  selected, messages, consent, phone, sms, view, sort, q,
}: {
  selected: WorkItem;
  messages: MessageEntry[];
  consent: boolean;
  phone: string | null;
  sms: string | null;
  view: string;
  sort: string;
  q: string;
}) {
  const returnTo = `/dashboard?${new URLSearchParams({
    invoice: selected.invoiceId, tab: "messages", view, sort, ...(q ? { q } : {}),
  }).toString()}`;

  const vars: TemplateVars = {
    customer: selected.customerName,
    invoice: selected.docNumber ?? selected.invoiceId,
    balance: formatUSD(selected.balance),
    dueDate: formatDueDate(selected.dueDate),
  };

  const [body, setBody] = useState("");
  const banner = sms ? SMS_BANNER[sms] : null;

  return (
    <section
      id="messages-panel"
      role="tabpanel"
      aria-labelledby="messages-tab"
      className="flex flex-1 flex-col min-h-0"
    >
      {/* Consent row */}
      <div className="flex items-center justify-between gap-2 px-5 py-3 border-b border-border">
        <span className="text-xs font-sans text-muted">
          SMS consent:{" "}
          <span className={consent ? "font-semibold text-cool" : "font-semibold text-hot"}>
            {consent ? "yes" : "no"}
          </span>
          {phone ? <span className="text-muted"> · {phone}</span> : null}
        </span>
        <form method="post" action="/api/sms-consent">
          <input type="hidden" name="invoiceId" value={selected.invoiceId} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <input type="hidden" name="consent" value={consent ? "false" : "true"} />
          <button
            type="submit"
            className="text-xs font-sans font-medium text-copper hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-copper rounded"
          >
            {consent ? "Revoke consent" : "Mark consented"}
          </button>
        </form>
      </div>

      {/* Banner */}
      {banner ? (
        <p className={`px-5 py-2 text-xs font-sans font-medium ${banner.tone}`}>{banner.text}</p>
      ) : null}

      {/* Thread */}
      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
            <Icon name="message" size={24} className="text-border" aria-hidden />
            <p className="text-sm font-sans font-semibold text-text">No messages yet.</p>
            <p className="text-xs text-muted max-w-xs">Pick a template or write a message below.</p>
          </div>
        ) : (
          <ol className="flex flex-col gap-3">
            {messages.map((m) => {
              const side = BUBBLE[m.direction] ?? BUBBLE.inbound;
              return (
                <li key={m.id} className={`flex flex-col gap-0.5 ${side.wrap}`}>
                  <span className={`inline-block max-w-[85%] rounded-lg px-3 py-2 text-sm font-sans whitespace-pre-wrap ${side.bubble}`}>
                    {m.body}
                  </span>
                  <span className="font-mono text-[11px] text-muted">
                    {m.direction}
                    {m.status ? ` · ${m.status}` : ""}
                    {m.errorCode ? ` · ${m.errorCode}` : ""}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      {/* Templates + composer */}
      <div className="border-t border-border px-5 py-3 shrink-0">
        <div className="flex flex-wrap gap-1.5 mb-2" role="group" aria-label="Message templates">
          {SMS_TEMPLATES.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setBody(applyTemplate(t.body, vars))}
              className="text-xs font-sans text-muted border border-border rounded-md px-2 py-1 hover:text-copper hover:border-copper focus:outline-none focus-visible:ring-2 focus-visible:ring-copper transition-colors"
            >
              {t.label}
            </button>
          ))}
        </div>
        <form method="post" action="/api/text/send" className="flex flex-col gap-2">
          <input type="hidden" name="invoiceId" value={selected.invoiceId} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <textarea
            name="body"
            rows={3}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Type a message…"
            required
            className="w-full resize-none rounded-md border border-border bg-panel px-3 py-2 text-sm font-sans text-text placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-copper"
          />
          <div className="flex items-center justify-between gap-2">
            {!consent ? (
              <span className="text-xs text-muted">Mark consent to enable sending.</span>
            ) : <span />}
            <button
              type="submit"
              disabled={!consent}
              className="inline-flex items-center gap-1.5 rounded-md bg-copper px-3 py-1.5 text-xs font-sans font-semibold text-surface hover:bg-copper/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-copper disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Icon name="message" size={14} aria-hidden />
              Send text
            </button>
          </div>
        </form>
      </div>
    </section>
  );
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
  messages,
  consent,
  phone,
  sms,
  roster,
  view,
  sort,
  q,
}: {
  selected: WorkItem | null;
  activeTab: "overview" | "activity" | "messages";
  activity: ActivityEntry[];
  messages: MessageEntry[];
  consent: boolean;
  phone: string | null;
  sms: string | null;
  roster: RosterMember[];
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

          {/* Text → Messages tab */}
          <Link
            to={`?${new URLSearchParams({ invoice: selected.invoiceId, tab: "messages", view, sort, ...(q ? { q } : {}) }).toString()}`}
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
            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-sans font-medium uppercase tracking-wider text-muted">
                Owner
              </span>
              <form method="post" action="/api/assign">
                <input type="hidden" name="customerId" value={selected.customerId ?? ""} />
                <input
                  type="hidden"
                  name="returnTo"
                  value={`/dashboard?${new URLSearchParams({ invoice: selected.invoiceId, tab: "overview", view, sort, ...(q ? { q } : {}) }).toString()}`}
                />
                <select
                  name="ownerId"
                  defaultValue={selected.ownerId ?? ""}
                  onChange={(e) => e.currentTarget.form?.requestSubmit()}
                  aria-label="Assign owner"
                  className="w-full rounded-md border border-border bg-panel px-2 py-1 text-sm font-sans text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-copper"
                >
                  <option value="">Unassigned</option>
                  {roster.map((m) => (
                    <option key={m.userId} value={m.userId}>{m.label}</option>
                  ))}
                </select>
              </form>
            </div>
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
        <MessagesTab
          selected={selected}
          messages={messages}
          consent={consent}
          phone={phone}
          sms={sms}
          view={view}
          sort={sort}
          q={q}
        />
      ) : null}
    </aside>
  );
}
