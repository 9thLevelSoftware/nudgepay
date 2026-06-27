import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useRevalidator } from "react-router";
import { HEARTBEAT_INTERVAL_MS, type Collision } from "~/lib/collision";
import { type CaseItem } from "~/lib/cases";
import { Icon } from "~/components/Icons";
import { SMS_TEMPLATES, applyTemplate, type TemplateVars } from "~/lib/sms-templates";
import { formatDate } from "~/lib/dates";
import { STATUS_LABEL, EXCEPTION_REASON_LABEL, formatUSD } from "~/lib/format";
import { isContactBlocked, isTerminal, exceptionLabel } from "~/lib/exceptions";
import type { MessageEntry, RosterMember } from "~/routes/dashboard";
import type { TimelineEntry } from "~/lib/timeline";
import { canSendSms, type CommPrefs } from "~/lib/comm-prefs";
import { resolveCallAction } from "~/lib/channel-actions";
import { statusChipTone, type ChipTone } from "~/lib/status-style";

// Static tone-to-text-color map — heat.band → Tailwind class.
// Must be literal strings so Tailwind can tree-shake them; no dynamic construction.
const TONE_CLASS: Record<string, string> = {
  hot: "text-hot",
  warm: "text-warm",
  cool: "text-cool",
  neutral: "text-muted",
};

const CHIP_TEXT: Record<ChipTone, string> = {
  cool: "text-cool",
  copper: "text-copper",
  neutral: "text-muted",
};
const CHIP_DOT: Record<ChipTone, string> = {
  cool: "bg-cool",
  copper: "bg-copper",
  neutral: "bg-muted",
};
// Heat → text token on the dark header (legible on ink).
const HEAT_TEXT: Record<string, string> = {
  cool: "text-cool",
  warm: "text-warm",
  hot: "text-hot",
};

// Static effective-level → text tone (keeps the "Why this priority" header consistent
// with the queue badge, which colors by effective level — not age heat).
const LEVEL_TONE: Record<string, string> = {
  Critical: "text-hot", High: "text-warm", Medium: "text-warm", Low: "text-cool",
};

// Static promise status → label + tone. Literal class strings for Tailwind v4.
const PROMISE_STATUS: Record<string, { label: string; tone: string }> = {
  pending:        { label: "Promise pending",  tone: "text-cool" },
  kept:           { label: "Promise kept",     tone: "text-cool" },
  partially_kept: { label: "Partially kept",   tone: "text-warm" },
  broken:         { label: "Promise broken",   tone: "text-hot" },
  renegotiated:   { label: "Renegotiated",     tone: "text-muted" },
  cancelled:      { label: "Cancelled",        tone: "text-muted" },
};

// Footer/status accent cards — literal classes for the scanner.
const ACCENT_CARD: Record<string, string> = {
  cool: "bg-cool/5 border-cool/30 border-l-cool",
  hot: "bg-hot/5 border-hot/30 border-l-hot",
  warm: "bg-warm/5 border-warm/30 border-l-warm",
  neutral: "bg-panel border-border border-l-muted",
};
const ACCENT_TITLE: Record<string, string> = {
  cool: "text-cool", hot: "text-hot", warm: "text-warm", neutral: "text-muted",
};

// Timeline node tone by log method / sms direction. Literal classes for the scanner.
const TL_NODE: Record<string, { bg: string; color: string }> = {
  call:     { bg: "bg-copper/10", color: "text-copper" },
  email:    { bg: "bg-copper/10", color: "text-copper" },
  text:     { bg: "bg-muted/10",  color: "text-muted" },
  note:     { bg: "bg-muted/10",  color: "text-muted" },
  inbound:  { bg: "bg-cool/10",   color: "text-cool" },
  outbound: { bg: "bg-muted/10",  color: "text-muted" },
};

const METHOD_ICON: Record<string, "phone" | "mail" | "message" | "note"> = {
  call: "phone", email: "mail", text: "message", note: "note",
};
function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

// Static direction → bubble alignment/color. Literal strings for Tailwind.
const BUBBLE: Record<string, { wrap: string; bubble: string }> = {
  outbound: { wrap: "items-end",   bubble: "bg-ink text-surface border border-ink" },
  inbound:  { wrap: "items-start", bubble: "bg-paper text-text border border-border" },
};
const SMS_BANNER: Record<string, { text: string; tone: string }> = {
  sent:      { text: "Text sent.",                                                    tone: "text-cool" },
  noconsent: { text: "Not sent — customer has not consented to SMS.",                 tone: "text-hot" },
  optout:    { text: "Not sent — customer opted out of texts.",                       tone: "text-hot" },
  error:     { text: "Could not send the text.",                                      tone: "text-hot" },
  blocked:   { text: "Not sent — this case is marked do-not-contact / legal.",        tone: "text-hot" },
};

// Static promise-error code → copy. Literal strings for Tailwind v4.
const PROMISE_ERROR_TEXT: Record<string, string> = {
  "missing-promise": "Could not find that promise.",
  "cancel-failed":   "Could not cancel the promise.",
};

function MessagesTab({
  selected, repInvoiceId, messages, consent, prefs, phone, sms, view, sort, q, collision,
}: {
  selected: CaseItem;
  repInvoiceId: string | null;
  messages: MessageEntry[];
  consent: boolean;
  prefs: CommPrefs;
  phone: string | null;
  sms: string | null;
  view: string;
  sort: string;
  q: string;
  collision: Collision | null;
}) {
  const returnTo = `/dashboard?${new URLSearchParams({
    case: selected.caseId, tab: "messages", view, sort, ...(q ? { q } : {}),
  }).toString()}`;
  const prefsHref = `?${new URLSearchParams({ case: selected.caseId, tab: "messages", view, sort, ...(q ? { q } : {}), prefs: "1" }).toString()}`;

  const repInvoice = repInvoiceId
    ? selected.invoices.find((i) => i.invoiceId === repInvoiceId)
    : null;

  const vars: TemplateVars = {
    customer: selected.customerName,
    invoice:  repInvoice?.docNumber ?? selected.customerName,
    balance:  formatUSD(selected.totalOverdue),
    dueDate:  formatDate(repInvoice?.dueDate ?? null),
  };

  const [body, setBody] = useState("");
  const [confirmSend, setConfirmSend] = useState(false);
  const needsConfirm = !!collision && collision.level !== "none";
  const banner = sms ? SMS_BANNER[sms] : null;
  const noInvoice = repInvoiceId === null;
  const contactBlocked = isContactBlocked(selected.exceptionReason);

  // Reset confirmSend when the case changes
  useEffect(() => {
    setConfirmSend(false);
  }, [selected.caseId]);

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
        <div className="flex items-center gap-3">
          <Link
            to={prefsHref}
            className="text-xs font-medium text-copper hover:underline"
          >
            Communication preferences
          </Link>
          <form method="post" action="/api/sms-consent">
            <input type="hidden" name="invoiceId" value={repInvoiceId ?? ""} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <input type="hidden" name="consent" value={consent ? "false" : "true"} />
            <button
              type="submit"
              className="text-xs font-sans font-medium text-copper hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper rounded"
            >
              {consent ? "Revoke consent" : "Mark consented"}
            </button>
          </form>
        </div>
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
              className="text-xs font-sans text-muted border border-border rounded-md px-2 py-1 hover:text-copper hover:border-copper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper transition-colors"
            >
              {t.label}
            </button>
          ))}
        </div>
        <form
          method="post"
          action="/api/text/send"
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            if (needsConfirm && !confirmSend) {
              e.preventDefault();
              setConfirmSend(true);
            }
          }}
        >
          <input type="hidden" name="invoiceId" value={repInvoiceId ?? ""} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <textarea
            name="body"
            rows={3}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Type a message…"
            required
            className="w-full resize-none rounded-md border border-border bg-panel px-3 py-2 text-sm font-sans text-text placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
          />
          {confirmSend ? (
            <p className="text-xs font-sans text-amber-200" role="alert">
              {collision?.level === "live"
                ? `${collision.byUser} is viewing this customer now. Send anyway?`
                : `${collision?.byUser} contacted this customer recently. Send anyway?`}
            </p>
          ) : null}
          <div className="flex items-center justify-between gap-2">
            {contactBlocked ? (
              <span className="text-xs text-hot">Messaging blocked — {exceptionLabel(selected.exceptionReason)}.</span>
            ) : noInvoice ? (
              <span className="text-xs text-muted">No invoice to reference.</span>
            ) : !consent ? (
              <span className="text-xs text-muted">Mark consent to enable sending.</span>
            ) : prefs.doNotText ? (
              <span className="text-xs text-hot">Customer opted out of texts.</span>
            ) : !phone ? (
              <span className="text-xs text-muted">Customer has no phone number.</span>
            ) : <span />}
            <button
              type="submit"
              disabled={!canSendSms(prefs, consent) || noInvoice || contactBlocked || !phone}
              className="inline-flex items-center gap-1.5 rounded-md bg-copper px-3 py-1.5 text-xs font-sans font-semibold text-surface hover:bg-copper/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
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
  { id: "activity" as const, label: "Timeline" },
  { id: "messages" as const, label: "Messages" },
];

// ─── Main export ───────────────────────────────────────────────────────────────

export function DetailPanel({
  selected,
  repInvoiceId,
  activeTab,
  timeline,
  messages,
  consent,
  prefs,
  phone,
  sms,
  promiseError,
  roster,
  view,
  sort,
  q,
  selectedPromiseId,
  collision,
}: {
  selected: CaseItem | null;
  repInvoiceId: string | null;
  activeTab: "overview" | "activity" | "messages";
  timeline: TimelineEntry[];
  messages: MessageEntry[];
  consent: boolean;
  prefs: CommPrefs;
  phone: string | null;
  sms: string | null;
  promiseError?: string | null;
  roster: RosterMember[];
  view: string;
  sort: string;
  q: string;
  selectedPromiseId: string | null;
  collision: Collision | null;
}) {
  // ── Hooks (must be unconditional, before any early return) ─────────────────
  // Keep the latest revalidate fn in a ref so the heartbeat effect depends ONLY
  // on customerId. In RR7 the useRevalidator() object identity changes on every
  // revalidation (idle→loading→idle); depending on it would tear the effect down
  // and re-run it mid-cycle, firing extra heartbeats (~3 per cycle instead of 1).
  const { revalidate } = useRevalidator();
  const revalidateRef = useRef(revalidate);
  useEffect(() => { revalidateRef.current = revalidate; }, [revalidate]);
  const customerId = selected?.customerId ?? null;
  useEffect(() => {
    if (!customerId) return;
    let cancelled = false;
    const beat = () => {
      const body = new FormData();
      body.set("customerId", customerId);
      fetch("/api/presence/heartbeat", { method: "POST", body }).catch(() => {});
    };
    beat(); // immediate
    const id = setInterval(() => {
      if (cancelled) return;
      beat();
      revalidateRef.current();
    }, HEARTBEAT_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [customerId]);
  const navigate = useNavigate();

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
  const logHref = `?${new URLSearchParams({ case: selected.caseId, tab: "activity", view, sort, ...(q ? { q } : {}), log: "1" }).toString()}`;
  const overviewReturnTo = `/dashboard?${new URLSearchParams({ case: selected.caseId, tab: "overview", view, sort, ...(q ? { q } : {}) }).toString()}`;

  const callAction = resolveCallAction(prefs, selected.phone, selected.contactBlocked);
  const callLogHref = `?${new URLSearchParams({ case: selected.caseId, tab: "activity", view, sort, ...(q ? { q } : {}), log: "1", method: "call" }).toString()}`;

  return (
    <aside
      aria-label={`Selected account ${selected.customerName}`}
      className="flex flex-col bg-surface border-l border-border h-full overflow-y-auto"
    >
      {/* Mobile: back to queue */}
      <div className="md:hidden px-4 pt-3 pb-1">
        <Link
          to={`?${new URLSearchParams({ view, sort, ...(q ? { q } : {}) }).toString()}`}
          className="inline-flex items-center gap-1 text-xs text-muted hover:text-copper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper rounded"
        >
          <Icon name="chevronRight" size={13} className="rotate-180" aria-hidden />
          Back to queue
        </Link>
      </div>

      {/* ── Header — dark ink block ──────────────────────────────────────────── */}
      <div className="px-5 pt-4 pb-4 bg-ink text-surface">
        <div className="flex items-center justify-between">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-wide text-surface/50">
            Selected account
          </p>
          <Link
            to={`?${new URLSearchParams({ view, sort, ...(q ? { q } : {}) }).toString()}`}
            aria-label="Close detail panel"
            className="hidden md:flex items-center justify-center w-6 h-6 rounded text-surface/60 hover:text-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
          >
            <span aria-hidden="true" className="text-base leading-none">×</span>
          </Link>
        </div>
        <h2 className="mt-1.5 font-display text-xl font-semibold leading-tight text-surface">
          {selected.customerName}
        </h2>
        <p className="mt-1 text-xs text-surface/60">
          {selected.invoiceCount} open invoice(s)
          <span className="mx-1.5 text-surface/30 select-none">·</span>
          oldest{" "}
          <span className={`font-mono font-semibold ${HEAT_TEXT[selected.heat.band] ?? "text-surface"}`}>
            {selected.oldestAgeDays}d
          </span>{" "}
          overdue
        </p>
      </div>

      {/* ── Stat tiles band ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-2.5 px-4 py-3 bg-paper border-b border-border">
        <div className="flex flex-col gap-1 bg-surface rounded-card p-3 border border-border">
          <span className="font-mono text-[9.5px] font-semibold uppercase tracking-wide text-muted">
            Total overdue
          </span>
          <span className="font-display text-xl font-bold tracking-tight tabular-nums text-text">
            {formatUSD(selected.totalOverdue)}
          </span>
        </div>
        <div className="flex flex-col gap-1 bg-surface rounded-card p-3 border border-border">
          <span className="font-mono text-[9.5px] font-semibold uppercase tracking-wide text-muted">
            Status
          </span>
          <span className={`inline-flex items-center gap-1.5 font-display text-base font-semibold ${CHIP_TEXT[statusChipTone(selected.status)]}`}>
            <span
              aria-hidden="true"
              className={`w-1.5 h-1.5 rounded-full ${CHIP_DOT[statusChipTone(selected.status)]}`}
            />
            {STATUS_LABEL[selected.status] ?? selected.status}
          </span>
        </div>
      </div>

      {/* ── Action tiles band ───────────────────────────────────────────────── */}
      <div role="group" aria-label="Account actions" className="flex gap-2 px-4 py-3 border-b border-border bg-paper">
        {/* Call — hidden if no phone; disabled-with-reason if do_not_call; else tel: + capture */}
        {callAction.kind === "live" ? (
          <a
            href={`tel:${selected.phone}`}
            onClick={() => navigate(callLogHref)}
            className="flex-1 flex flex-col items-center gap-1.5 py-2.5 rounded-card bg-surface border border-border text-copper hover:border-copper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper transition-colors"
          >
            <Icon name="phone" size={16} aria-hidden />
            <span className="text-[11.5px] font-sans font-semibold text-text">Call</span>
          </a>
        ) : callAction.kind === "blocked" ? (
          <span
            aria-disabled="true"
            aria-label={`Call — ${callAction.reason}`}
            title={callAction.reason}
            className="flex-1 flex flex-col items-center gap-1.5 py-2.5 rounded-card bg-surface border border-border text-muted opacity-50 cursor-not-allowed"
          >
            <Icon name="phone" size={16} aria-hidden />
            <span className="text-[11.5px] font-sans font-semibold text-text">Call</span>
          </span>
        ) : null}

        {/* Text → Messages tab */}
        <Link
          to={`?${new URLSearchParams({ case: selected.caseId, tab: "messages", view, sort, ...(q ? { q } : {}) }).toString()}`}
          className="flex-1 flex flex-col items-center gap-1.5 py-2.5 rounded-card bg-surface border border-border text-copper hover:border-copper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper transition-colors"
        >
          <Icon name="message" size={16} aria-hidden />
          <span className="text-[11.5px] font-sans font-semibold text-text">Text</span>
        </Link>

        {/* Log — opens the log-contact drawer */}
        <Link
          to={logHref}
          className="flex-1 flex flex-col items-center gap-1.5 py-2.5 rounded-card bg-surface border border-border text-copper hover:border-copper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper transition-colors"
        >
          <Icon name="note" size={16} aria-hidden />
          <span className="text-[11.5px] font-sans font-semibold text-text">Log</span>
        </Link>
      </div>

      {/* ── Tab bar ─────────────────────────────────────────────────────────── */}
      <div
        role="tablist"
        aria-label="Selected account sections"
        className="flex border-b border-border shrink-0 bg-paper"
      >
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <Link
              key={tab.id}
              to={`?${new URLSearchParams({ case: selected.caseId, tab: tab.id, view, sort, ...(q ? { q } : {}) }).toString()}`}
              id={`${tab.id}-tab`}
              role="tab"
              aria-selected={isActive ? "true" : "false"}
              aria-controls={`${tab.id}-panel`}
              className={[
                "px-4 py-3 text-[13px] font-sans focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper transition-colors",
                isActive
                  ? "border-b-2 border-copper text-text font-semibold -mb-px"
                  : "border-b-2 border-transparent text-muted font-medium hover:text-text",
              ].join(" ")}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>

      {/* ── Collision banner ────────────────────────────────────────────────── */}
      {collision && (collision.level !== "none" || collision.byUser) ? (
        <div
          role="status"
          className={
            collision.level === "live"
              ? "mx-5 mt-3 rounded-md border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs font-sans text-amber-200"
              : "mx-5 mt-3 rounded-md border border-border bg-panel px-3 py-2 text-xs font-sans text-muted"
          }
        >
          {collision.level === "live"
            ? `⚠ ${collision.liveUsers.join(", ")} ${collision.liveUsers.length > 1 ? "are" : "is"} viewing this customer now`
            : `Last contacted by ${collision.byUser}`}
        </div>
      ) : null}

      {/* ── Tab panels ──────────────────────────────────────────────────────── */}

      {activeTab === "overview" ? (
        <section
          id="overview-panel"
          role="tabpanel"
          aria-labelledby="overview-tab"
          className="flex-1 px-5 py-4"
        >
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <InfoRow
              label="Status"
              value={STATUS_LABEL[selected.status] ?? selected.status}
              tone={selected.heat.band}
            />
            <InfoRow
              label="Next action"
              value={
                selected.nextActionType
                  ? `${selected.nextActionType}${selected.nextActionAt ? ` · ${formatDate(selected.nextActionAt)}` : ""}`
                  : "—"
              }
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
                  value={`/dashboard?${new URLSearchParams({ case: selected.caseId, tab: "overview", view, sort, ...(q ? { q } : {}) }).toString()}`}
                />
                <select
                  name="ownerId"
                  defaultValue={selected.ownerId ?? ""}
                  onChange={(e) => e.currentTarget.form?.requestSubmit()}
                  aria-label="Assign owner"
                  className="w-full rounded-md border border-border bg-panel px-2 py-1 text-sm font-sans text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
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
          </div>

          {/* Why this priority */}
          <div className="mt-4 rounded-card bg-panel p-4 shadow-tile">
            <div className="flex items-center justify-between">
              <span className="text-xs font-sans font-medium uppercase tracking-wider text-muted">
                Why this priority
              </span>
              <span className={`text-sm font-sans font-semibold ${LEVEL_TONE[selected.effectiveLevel] ?? "text-text"}`}>
                {selected.effectiveLevel}
                {selected.override ? <span aria-hidden> 📌</span> : null}
              </span>
            </div>

            <ul aria-label="Priority factors" className="mt-2 flex flex-col gap-1">
              {selected.factors.map((f) => (
                <li key={f.key} className="flex items-center justify-between text-xs">
                  <span className="text-text">{f.label}</span>
                  <span className="font-mono text-muted tabular-nums">+{f.points}</span>
                </li>
              ))}
              {selected.factors.length === 0 ? (
                <li className="text-xs text-muted">Not yet due</li>
              ) : null}
            </ul>

            <p className="mt-2 text-xs text-muted">
              Computed: {selected.priority.level} · score {selected.score}
              {selected.override ? (
                <> · pinned to {selected.override.level}
                  {selected.override.by
                    ? ` by ${roster.find((m) => m.userId === selected.override!.by)?.label ?? selected.override.by}`
                    : ""}
                </>
              ) : null}
            </p>
            {selected.override?.reason ? (
              <p className="mt-1 text-xs italic text-muted">"{selected.override.reason}"</p>
            ) : null}

            {/* Override control. key by caseId so the uncontrolled defaultValue
                inputs reset when switching accounts (DetailPanel is reused, not remounted). */}
            <form key={selected.caseId} method="post" action="/api/priority-override" className="mt-3 flex items-center gap-2">
              <input type="hidden" name="caseId" value={selected.caseId} />
              <input type="hidden" name="returnTo" value={overviewReturnTo} />
              <select
                name="level"
                defaultValue={selected.override ? selected.override.level.toLowerCase() : ""}
                aria-label="Override priority level"
                className="rounded-md border border-border bg-surface px-2 py-1 text-xs font-sans text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
              >
                <option value="">No override</option>
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
              <input
                name="reason"
                type="text"
                aria-label="Override reason"
                placeholder="Reason (optional)"
                defaultValue={selected.override?.reason ?? ""}
                className="min-w-0 flex-1 rounded-md border border-border bg-surface px-2 py-1 text-xs font-sans text-text placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
              />
              <button
                type="submit"
                className="rounded-md border border-copper/40 px-3 py-1 text-xs font-sans font-medium text-copper hover:bg-copper/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper transition-colors"
              >
                Save
              </button>
            </form>
          </div>

          {/* Invoice list */}
          <div className="mt-4">
            <span className="text-xs font-sans font-medium uppercase tracking-wider text-muted">Invoices</span>
            <ul className="mt-2 flex flex-col gap-1">
              {selected.invoices.map((inv) => (
                <li key={inv.invoiceId} className="flex items-center justify-between gap-2 rounded-md bg-paper px-3 py-2">
                  <span className="font-mono text-xs text-text">{inv.docNumber ?? inv.invoiceId}</span>
                  <span className="font-mono text-xs text-muted tabular-nums">
                    {formatUSD(inv.balance)} · {inv.ageDays > 0 ? `${inv.ageDays}d` : "Due"}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {/* Exception panel — warm accent card */}
          {selected.status === "on_hold" && selected.exceptionReason ? (
            <div className={`mt-4 rounded-card border border-l-[3px] p-4 ${ACCENT_CARD["warm"]}`}>
              <p className={`text-xs font-sans font-semibold ${ACCENT_TITLE["warm"]}`}>
                Exception · {EXCEPTION_REASON_LABEL[selected.exceptionReason] ?? selected.exceptionReason}
                <span className="ml-1 font-normal text-muted">
                  {isTerminal(selected.exceptionReason)
                    ? "· parked indefinitely"
                    : selected.nextActionAt
                      ? `· parked until ${formatDate(selected.nextActionAt)}`
                      : ""}
                </span>
              </p>
              {selected.exceptionNote ? (
                <p className="mt-1 text-xs text-muted">{selected.exceptionNote}</p>
              ) : null}
            </div>
          ) : null}

          {/* Promise card — accent by promise status */}
          {selected.promiseStatus ? (() => {
            const accent =
              selected.promiseStatus === "broken"
                ? "hot"
                : selected.promiseStatus === "pending" || selected.promiseStatus === "kept"
                  ? "cool"
                  : "neutral";
            return (
              <div className={`mt-4 rounded-card border border-l-[3px] p-4 ${ACCENT_CARD[accent]}`}>
                <div className="flex items-center justify-between">
                  <span className={`text-sm font-sans font-semibold ${ACCENT_TITLE[accent]}`}>
                    {PROMISE_STATUS[selected.promiseStatus]?.label ?? selected.promiseStatus}
                  </span>
                  {selected.promise ? (
                    <span className="font-mono text-sm text-text">{formatUSD(selected.promise.amount)}</span>
                  ) : null}
                </div>
                {selected.promise ? (
                  <p className="mt-1 text-xs text-muted">
                    Promised by {formatDate(selected.promise.date)}
                    {selected.amountReceived != null ? ` · received ${formatUSD(selected.amountReceived)}` : ""}
                  </p>
                ) : null}
                {promiseError ? (
                  <p className="mt-1 text-xs font-sans font-medium text-hot">
                    {PROMISE_ERROR_TEXT[promiseError] ?? "Could not cancel the promise."}
                  </p>
                ) : null}
                {selected.promiseStatus === "pending" && selectedPromiseId ? (
                  <form method="post" action="/api/promises/cancel" className="mt-2">
                    <input type="hidden" name="promiseId" value={selectedPromiseId} />
                    <input type="hidden" name="returnTo" value={overviewReturnTo} />
                    <button
                      type="submit"
                      className="text-xs font-sans font-medium text-copper hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper rounded"
                    >
                      Cancel promise
                    </button>
                  </form>
                ) : null}
              </div>
            );
          })() : null}
        </section>
      ) : null}

      {activeTab === "activity" ? (
        <section id="activity-panel" role="tabpanel" aria-labelledby="activity-tab" className="flex-1 px-5 py-4">
          {timeline.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
              <Icon name="note" size={24} className="text-border" aria-hidden />
              <p className="text-sm font-sans font-semibold text-text">No activity yet.</p>
              <p className="text-xs text-muted max-w-xs">Logged contacts and texts will appear here.</p>
            </div>
          ) : (
            <ol className="flex flex-col">
              {(() => {
                const today = todayISO();
                return timeline.map((e) => {
                  if (e.kind === "sms") {
                    const node = TL_NODE[e.direction] ?? TL_NODE.outbound;
                    return (
                      <li key={e.id} className="flex gap-3 pb-4 last:pb-0">
                        <div className="flex flex-col items-center shrink-0">
                          <span className={`grid place-items-center w-7 h-7 rounded-lg ${node.bg} ${node.color}`}>
                            <Icon name="message" size={14} aria-hidden />
                          </span>
                          <span aria-hidden="true" className="flex-1 w-0.5 bg-border mt-1.5" />
                        </div>
                        <div className="min-w-0 flex flex-col gap-0.5 pt-0.5">
                          <span className={`text-sm font-sans font-semibold ${e.direction === "inbound" ? "text-cool" : "text-text"}`}>
                            {e.outcomeLabel}
                          </span>
                          <span className="font-mono text-xs text-muted">{formatDate(e.at)}</span>
                          {e.body ? (
                            <span className="text-xs text-muted whitespace-pre-wrap line-clamp-3">{e.body}</span>
                          ) : null}
                          {e.errorCode ? (
                            <span className="text-xs font-sans text-hot">Error {e.errorCode}</span>
                          ) : null}
                        </div>
                      </li>
                    );
                  }
                  const broken = e.promisedDate != null && e.promisedDate < today;
                  const node = TL_NODE[e.method] ?? TL_NODE.note;
                  return (
                    <li key={e.id} className="flex gap-3 pb-4 last:pb-0">
                      <div className="flex flex-col items-center shrink-0">
                        <span className={`grid place-items-center w-7 h-7 rounded-lg ${node.bg} ${node.color}`}>
                          <Icon name={METHOD_ICON[e.method] ?? "note"} size={14} aria-hidden />
                        </span>
                        <span aria-hidden="true" className="flex-1 w-0.5 bg-border mt-1.5" />
                      </div>
                      <div className="min-w-0 flex flex-col gap-0.5 pt-0.5">
                        <span className="text-sm font-sans font-semibold text-text">
                          {e.outcomeLabel ?? "Logged"}
                        </span>
                        <span className="font-mono text-xs text-muted">{formatDate(e.at)}</span>
                        {e.promisedAmount != null && e.promisedDate != null && (
                          <span className={`text-xs font-sans font-medium ${broken ? "text-hot" : "text-text"}`}>
                            Promised {formatUSD(e.promisedAmount)} by {formatDate(e.promisedDate)}
                            {broken ? " · broken" : ""}
                          </span>
                        )}
                        {e.followUpAt && (
                          <span className="text-xs font-sans text-muted">Follow up {formatDate(e.followUpAt)}</span>
                        )}
                        {e.notes && <span className="text-xs text-muted whitespace-pre-wrap">{e.notes}</span>}
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
          repInvoiceId={repInvoiceId}
          messages={messages}
          consent={consent}
          prefs={prefs}
          phone={phone}
          sms={sms}
          view={view}
          sort={sort}
          q={q}
          collision={collision}
        />
      ) : null}
    </aside>
  );
}
