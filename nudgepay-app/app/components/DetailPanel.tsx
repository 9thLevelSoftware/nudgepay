import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useNavigation, useRouteLoaderData, useSearchParams } from "react-router";
import { HEARTBEAT_INTERVAL_MS, type Collision } from "~/lib/collision";
import { previewWorkspaceInvoices, type CaseInvoice, type CaseItem } from "~/lib/cases";
import { chaseRecipientsFrom } from "~/lib/chase-recipients";
import type { ViewId, SortId } from "~/lib/worklist";
import { dashboardHref, dashboardSearchParams, type DensityId, type EntityMode } from "~/lib/queue-chrome";
import { Icon } from "~/components/Icons";
import { ICON_HIT_CLASS } from "~/components/ui";
import { MessageBubbles } from "~/components/MessageBubbles";
import { applyTemplate, type TemplateVars } from "~/lib/sms-templates";
import { applyEmailTemplate } from "~/lib/email-templates";
import type { MessageTemplateRow } from "~/lib/message-templates";
import { formatDate, formatInstant } from "~/lib/dates";
import { STATUS_LABEL, EXCEPTION_REASON_LABEL, formatUSD } from "~/lib/format";
import { isContactBlocked, isTerminal, exceptionLabel } from "~/lib/exceptions";
import { smsGateFor } from "~/lib/sms-gate";
import { whyNow } from "~/lib/next-best-action";
import { nextActionLabel, emailFailureLabel, smsFailureLabel, isHardBounce, plural } from "~/lib/labels";
import type { MessageEntry, EmailMessageEntry, RosterMember } from "~/routes/dashboard";
import { isTimelinePromiseBroken, type TimelineEntry } from "~/lib/timeline";
import { canSendEmail, type CommPrefs } from "~/lib/comm-prefs";
import { resolveCallAction } from "~/lib/channel-actions";
import { statusChipTone, type ChipTone } from "~/lib/status-style";
import { smsFlash } from "~/lib/flash-copy";
import { Input } from "~/components/ui";
import { useSendSubmission } from "~/lib/use-send-submission";

const FALLBACK_SUBMISSION_SEED = "00000000-0000-4000-8000-000000000000";

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

// Static promise status → label. Literal class strings for Tailwind v4.
const PROMISE_STATUS: Record<string, { label: string }> = {
  pending:        { label: "Promise pending" },
  kept:           { label: "Promise kept" },
  partially_kept: { label: "Partially kept" },
  broken:         { label: "Promise broken" },
  renegotiated:   { label: "Renegotiated" },
  cancelled:      { label: "Cancelled" },
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
const EMAIL_BANNER: Record<string, { text: string; tone: string }> = {
  sent:     { text: "Email sent.",                                                  tone: "text-cool" },
  disabled: { text: "Not sent — email is turned off for this workspace.",           tone: "text-hot" },
  optout:   { text: "Not sent — customer opted out of email.",                      tone: "text-hot" },
  blocked:  { text: "Not sent — this case is marked do-not-contact / legal.",       tone: "text-hot" },
  error:    { text: "Could not send the email.",                                    tone: "text-hot" },
  limited:  { text: "Not sent — send limit reached. Try again later.",              tone: "text-hot" },
  quiet:    { text: "Not sent — outside quiet hours.",                              tone: "text-warm" },
  from_allowlist: { text: "Not sent — from address is not on the operator allowlist.", tone: "text-hot" },
};

// Static promise-error code → copy. Literal strings for Tailwind v4.
const PROMISE_ERROR_TEXT: Record<string, string> = {
  "missing-promise": "Could not find that promise.",
  "cancel-failed":   "Could not cancel the promise.",
};

function panelHref(
  view: ViewId,
  sort: SortId,
  q: string,
  density: DensityId | undefined,
  extra?: { case?: string; tab?: string; log?: string; method?: string; prefs?: string; entity?: EntityMode; invoice?: string | null },
): string {
  const sp = dashboardSearchParams({
    view,
    sort,
    q: q || undefined,
    entity: extra?.entity,
    density,
    case: extra?.case,
    tab: extra?.tab,
    invoice: extra?.invoice ?? undefined,
  });
  if (extra?.log) sp.set("log", extra.log);
  if (extra?.method) sp.set("method", extra.method);
  if (extra?.prefs) sp.set("prefs", extra.prefs);
  return `?${sp.toString()}`;
}

const INVOICE_PREVIEW = 5;
const HISTORY_PREVIEW = 5;

const CHASE_CHANNEL_LABEL: Record<"sms" | "email" | "call", string> = {
  sms: "SMS", email: "Email", call: "Call",
};

function MessagesTab({
  selected, invoices, repInvoiceId, messages, consent, smsConsentSource, isOwner, prefs, phone, sms, smsEnabled, smsQuietNow, quietHoursLabel,
  view, sort, q, density, entity, invoice, collision,
  smsTemplates, orgCompany, orgPhone, orgPaymentLink, timeZone, composerRef, loadError,
  orgId, userId, sendSubmissionId,
}: {
  selected: CaseItem;
  invoices: CaseInvoice[];
  repInvoiceId: string | null;
  messages: MessageEntry[];
  consent: boolean;
  smsConsentSource: "inbound_stop" | "inbound_start" | "staff" | "import" | "unknown" | null;
  isOwner: boolean;
  prefs: CommPrefs;
  phone: string | null;
  sms: string | null;
  smsEnabled: boolean;
  smsQuietNow: boolean;
  quietHoursLabel: string;
  view: ViewId;
  sort: SortId;
  q: string;
  density?: DensityId;
  entity?: EntityMode;
  invoice?: string | null;
  collision: Collision | null;
  smsTemplates: MessageTemplateRow[];
  orgCompany: string;
  orgPhone: string;
  orgPaymentLink: string;
  timeZone?: string | null;
  composerRef: React.RefObject<HTMLDivElement | null>;
  loadError?: string | null;
  orgId: string;
  userId: string;
  sendSubmissionId: string | null;
}) {
  const returnTo = `/dashboard${panelHref(view, sort, q, density, { case: selected.caseId, tab: "messages", entity, invoice })}`;
  const prefsHref = panelHref(view, sort, q, density, { case: selected.caseId, tab: "messages", prefs: "1", entity, invoice });

  const repInvoice = repInvoiceId
    ? invoices.find((i) => i.invoiceId === repInvoiceId)
    : null;

  const vars: TemplateVars = {
    customer: selected.customerName,
    invoice:  repInvoice?.docNumber ?? selected.customerName,
    balance:  formatUSD(repInvoice?.balance ?? selected.totalOverdue),
    dueDate:  formatDate(repInvoice?.dueDate ?? null),
    company: orgCompany,
    phone: orgPhone,
    paymentLink: orgPaymentLink,
  };

  const [body, setBody] = useState("");
  const [confirmSend, setConfirmSend] = useState(false);
  const needsConfirm = !!collision && collision.level !== "none";
  const banner = smsFlash(sms);
  const noInvoice = repInvoiceId === null;
  const contactBlocked = isContactBlocked(selected.exceptionReason);
  const navigation = useNavigation();
  const consentBusy = navigation.state !== "idle" && navigation.formAction === "/api/sms-consent";
  const sendBusy = navigation.state !== "idle" && navigation.formAction === "/api/text/send";
  const rootData = useRouteLoaderData<{ sendSubmissionSeed: string }>("root");
  const submission = useSendSubmission({
    serverSeed: rootData?.sendSubmissionSeed ?? FALLBACK_SUBMISSION_SEED,
    userId,
    orgId,
    channel: "sms",
    customerId: selected.customerId,
    result: sendSubmissionId && sms
      ? { id: sendSubmissionId, success: sms === "sent" }
      : null,
  });

  // Reset draft state when the case changes
  useEffect(() => {
    setConfirmSend(false);
    setBody("");
  }, [selected.caseId]);

  // Gate ladder — shared with Focus Mode via sms-gate.ts.
  const smsGate = smsGateFor({
    smsEnabled,
    contactBlocked,
    exceptionReason: selected.exceptionReason,
    doNotText: prefs.doNotText,
    hasInvoice: !noInvoice,
    consent,
    phone,
  });
  const smsGateReason = smsGate?.reason ?? null;
  const smsSendDisabled = smsGateReason !== null;

  return (
    <section
      id="messages-panel"
      className="flex flex-1 flex-col min-h-0"
    >
      {/* Consent row */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 border-b border-border">
        <span className="text-xs font-sans text-muted">
          SMS consent:{" "}
          <span className={consent ? "font-semibold text-cool" : "font-semibold text-hot"}>
            {consent ? "yes" : "no"}
          </span>
          {phone ? <span className="text-muted"> · {phone}</span> : null}
        </span>
        <div className="flex flex-wrap items-center gap-3">
          <Link
            to={prefsHref}
            className="text-xs font-medium text-copper hover:underline"
          >
            Communication preferences
          </Link>
          {!consent && smsConsentSource === "inbound_stop" && !isOwner ? (
            <p className="text-xs font-sans text-hot">Stopped by inbound STOP. Admin override required.</p>
          ) : (
            <form method="post" action="/api/sms-consent">
              <div className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="invoiceId" value={repInvoiceId ?? ""} />
                <input type="hidden" name="customerId" value={selected.customerId} />
                <input type="hidden" name="returnTo" value={returnTo} />
                <input type="hidden" name="consent" value={consent ? "false" : "true"} />
                {!consent && smsConsentSource === "inbound_stop" ? (
                  <Input
                    name="reason"
                    required
                    minLength={3}
                    placeholder="Override reason"
                    className="h-7 w-40 max-w-full min-w-0 px-2 py-0 text-xs"
                    aria-label="Consent override reason"
                  />
                ) : null}
                <button
                  type="submit"
                  disabled={consentBusy}
                  className="text-xs font-sans font-medium text-copper hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper rounded disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {consentBusy ? "Updating…" : consent ? "Revoke consent" : smsConsentSource === "inbound_stop" ? "Override STOP" : "Mark consented"}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>

      {/* Banner */}
      {banner ? (
        <p className={`px-5 py-2 text-xs font-sans font-medium ${banner.tone}`} role={banner.tone === "text-hot" ? "alert" : "status"}>{banner.text}</p>
      ) : null}

      {/* Thread */}
      <div
        className="flex-1 min-h-0 overflow-y-auto px-5 py-4"
        tabIndex={0}
        role="region"
        aria-label="Message history"
>
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
            <Icon name="message" size={24} className="text-border" aria-hidden />
            <p className="text-sm font-sans font-semibold text-text">{loadError ?? "No messages yet."}</p>
            <p className="text-xs text-muted max-w-xs">{loadError ? "Message history could not be loaded." : "Pick a template or write a message below."}</p>
          </div>
        ) : (
          <MessageBubbles messages={messages} timeZone={timeZone} />
        )}
      </div>

      {/* Templates + composer */}
      <div
        ref={composerRef}
        tabIndex={-1}
        aria-label="Text message composer"
        className="border-t border-border px-5 py-3 shrink-0 focus-visible:outline-none"
      >
        {smsQuietNow && (
          <p
            className="mb-2 rounded-md border border-warm/30 bg-warm/10 px-3 py-2 text-xs font-sans font-medium text-warm"
            role="status"
          >
            Outside quiet hours ({quietHoursLabel}) — sends are blocked until the window reopens. The button stays enabled in case this page is stale.
          </p>
        )}
        {smsGate && (
          <p
            className={`mb-2 rounded-md px-3 py-2 text-xs font-sans font-medium ${
              smsGate.severity === "hard"
                ? "bg-hot/10 border border-hot/30 text-hot"
                : "bg-warm/10 border border-warm/30 text-warm"
            }`}
            role={smsGate.severity === "hard" ? "alert" : "status"}
          >
            {smsGate.reason}
          </p>
        )}
        <div className="flex flex-wrap gap-1.5 mb-2" role="group" aria-label="Message templates">
          {smsTemplates.map((t) => (
            <button
              key={t.id}
              type="button"
              disabled={smsSendDisabled}
              onClick={() => setBody(applyTemplate(t.body, vars))}
              className="text-xs font-sans text-muted border border-border rounded-md px-2 py-1 hover:text-copper hover:border-copper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
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
              return;
            }
            submission.onSubmit(e);
          }}
        >
          <input ref={submission.inputRef} type="hidden" name="submissionId" value={submission.submissionId} readOnly />
          <input type="hidden" name="invoiceId" value={repInvoiceId ?? ""} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <textarea
            name="body"
            rows={3}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Type a message…"
            required
            disabled={smsSendDisabled || !submission.ready}
            aria-label="Message body"
            className="w-full resize-none rounded-md border border-border bg-panel px-3 py-2 text-sm font-sans text-text placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper disabled:opacity-40 disabled:cursor-not-allowed"
          />
          {submission.error ? <p className="text-xs font-sans text-hot" role="alert">{submission.error}</p> : null}
          {confirmSend ? (
            <p className="text-xs font-sans text-warm" role="alert">
              {collision?.level === "live"
                ? `${collision.byUser} is viewing this customer now. Send anyway?`
                : `${collision?.byUser} contacted this customer recently. Send anyway?`}
            </p>
          ) : null}
          <div className="flex items-center justify-between gap-2">
            <span />
            <button
              type="submit"
              disabled={smsSendDisabled || sendBusy || !submission.ready}
              className="inline-flex items-center gap-1.5 rounded-md bg-copper px-3 py-1.5 text-xs font-sans font-semibold text-on-copper hover:bg-copper/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Icon name="message" size={14} aria-hidden />
              {sendBusy ? "Sending…" : "Send text"}
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}

function EmailTab({
  selected, invoices, repInvoiceId, emailMessages, prefs, customerEmail, emailEnabled,
  view, sort, q, density, entity, invoice, emailTemplates, orgCompany, orgPhone, orgPaymentLink, timeZone, composerRef, loadError,
  orgId, userId, sendSubmissionId,
}: {
  selected: CaseItem;
  invoices: CaseInvoice[];
  repInvoiceId: string | null;
  emailMessages: EmailMessageEntry[];
  prefs: CommPrefs;
  customerEmail: string | null;
  emailEnabled: boolean;
  view: ViewId;
  sort: SortId;
  q: string;
  density?: DensityId;
  entity?: EntityMode;
  invoice?: string | null;
  emailTemplates: MessageTemplateRow[];
  orgCompany: string;
  orgPhone: string;
  orgPaymentLink: string;
  timeZone?: string | null;
  composerRef: React.RefObject<HTMLDivElement | null>;
  loadError?: string | null;
  orgId: string;
  userId: string;
  sendSubmissionId: string | null;
}) {
  const [searchParams] = useSearchParams();
  const emailResult = searchParams.get("email");
  const banner = emailResult ? (EMAIL_BANNER[emailResult] ?? null) : null;

  const returnTo = `/dashboard${panelHref(view, sort, q, density, { case: selected.caseId, tab: "email", entity, invoice })}`;

  const repInvoice = repInvoiceId
    ? invoices.find((i) => i.invoiceId === repInvoiceId)
    : null;

  const vars: TemplateVars = {
    customer: selected.customerName,
    invoice:  repInvoice?.docNumber ?? selected.customerName,
    balance:  formatUSD(repInvoice?.balance ?? selected.totalOverdue),
    dueDate:  formatDate(repInvoice?.dueDate ?? null),
    company: orgCompany,
    phone: orgPhone,
    paymentLink: orgPaymentLink,
  };

  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const noInvoice = repInvoiceId === null;
  const contactBlocked = isContactBlocked(selected.exceptionReason);
  const navigation = useNavigation();
  const busy = navigation.state !== "idle" && navigation.formAction === "/api/email/send";
  const rootData = useRouteLoaderData<{ sendSubmissionSeed: string }>("root");
  const submission = useSendSubmission({
    serverSeed: rootData?.sendSubmissionSeed ?? FALLBACK_SUBMISSION_SEED,
    userId,
    orgId,
    channel: "email",
    customerId: selected.customerId,
    result: sendSubmissionId && emailResult
      ? { id: sendSubmissionId, success: emailResult === "sent" }
      : null,
  });

  // F-022: warn before composing into an address that just hard-bounced.
  const lastEmail = emailMessages.length > 0 ? emailMessages[emailMessages.length - 1] : null;
  const lastEmailBounced = lastEmail != null && lastEmail.direction === "outbound" && isHardBounce(lastEmail.errorCode);

  // Derive the first gate reason that applies. Order: workspace → blocked → no-email → opted-out.
  const gateReason = !emailEnabled
    ? "Email is turned off for this workspace."
    : contactBlocked
      ? `Messaging blocked — ${exceptionLabel(selected.exceptionReason)}.`
      : !customerEmail
        ? "Customer has no email address."
        : !canSendEmail(prefs)
          ? "Customer opted out of email."
          : null;

  const sendDisabled = gateReason !== null || noInvoice;

  return (
    <section
      id="email-panel"
      className="flex flex-1 flex-col min-h-0"
    >
      {/* Customer email info row */}
      <div className="flex items-center gap-2 px-5 py-3 border-b border-border">
        <span className="text-xs font-sans text-muted">
          Email:{" "}
          <span className={customerEmail ? "font-semibold text-text" : "font-semibold text-muted"}>
            {customerEmail ?? "—"}
          </span>
        </span>
      </div>

      {/* Result banner */}
      {banner ? (
        <p className={`px-5 py-2 text-xs font-sans font-medium ${banner.tone}`} role={banner.tone === "text-hot" ? "alert" : "status"}>{banner.text}</p>
      ) : null}

      {/* Email thread */}
      <div
        className="flex-1 min-h-0 overflow-y-auto px-5 py-4"
        tabIndex={0}
        role="region"
        aria-label="Message history"
      >
        {emailMessages.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
            <Icon name="mail" size={24} className="text-border" aria-hidden />
            <p className="text-sm font-sans font-semibold text-text">{loadError ?? "No emails yet."}</p>
            <p className="text-xs text-muted max-w-xs">{loadError ? "Email history could not be loaded." : "Pick a template or write an email below."}</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {emailMessages.map((msg) => (
              <li key={msg.id} className={`flex ${msg.direction === "inbound" ? "justify-start" : "justify-end"}`}>
                <div
                  className={`max-w-[85%] rounded-lg px-3 py-2 ${
                    msg.direction === "inbound" ? "bg-cool/10 text-text" : "bg-copper/10 text-text"
                  }`}
                >
                  {msg.subject ? (
                    <p className="text-xs font-sans font-semibold text-muted mb-1">{msg.subject}</p>
                  ) : null}
                  <p className="text-xs font-sans whitespace-pre-wrap">{msg.body}</p>
                  <p className="mt-1 text-[11px] text-muted">{formatInstant(msg.createdAt, timeZone)}</p>
                  {msg.errorCode ? (
                    <p className="text-xs font-sans text-hot">{emailFailureLabel(msg.errorCode)}</p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Template picker + composer */}
      <div
        ref={composerRef}
        tabIndex={-1}
        aria-label="Email composer"
        className="border-t border-border px-5 py-3 shrink-0 focus-visible:outline-none"
      >
        {/* Template select — fills subject + body on change */}
        <select
          defaultValue=""
          disabled={sendDisabled}
          onChange={(e) => {
            const tmpl = emailTemplates.find((t) => t.id === e.target.value);
            if (tmpl) {
              setSubject(applyEmailTemplate(tmpl.subject ?? "", vars));
              setBody(applyEmailTemplate(tmpl.body, vars));
            }
          }}
          className="w-full mb-2 rounded-md border border-border bg-panel px-3 py-1.5 text-xs font-sans text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
          aria-label="Email template"
        >
          <option value="" disabled>Pick a template…</option>
          {emailTemplates.map((t) => (
            <option key={t.id} value={t.id}>{t.label}</option>
          ))}
        </select>

        <form method="post" action="/api/email/send" className="flex flex-col gap-2" onSubmit={submission.onSubmit}>
          <input ref={submission.inputRef} type="hidden" name="submissionId" value={submission.submissionId} readOnly />
          <input type="hidden" name="invoiceId" value={repInvoiceId ?? ""} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <input
            name="subject"
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject"
            required
            disabled={sendDisabled || !submission.ready}
            aria-label="Email subject"
            className="w-full rounded-md border border-border bg-panel px-3 py-2 text-sm font-sans text-text placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper disabled:opacity-40 disabled:cursor-not-allowed"
          />
          <textarea
            name="body"
            rows={4}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Type an email…"
            required
            disabled={sendDisabled || !submission.ready}
            aria-label="Email body"
            className="w-full resize-none rounded-md border border-border bg-panel px-3 py-2 text-sm font-sans text-text placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper disabled:opacity-40 disabled:cursor-not-allowed"
          />
          {submission.error ? <p className="text-xs font-sans text-hot" role="alert">{submission.error}</p> : null}
          {lastEmailBounced ? (
            <p className="text-xs font-sans text-hot">Last email to this address bounced.</p>
          ) : null}
          <div className="flex items-center justify-between gap-2">
            {gateReason ? (
              <span className="text-xs text-hot">{gateReason}</span>
            ) : noInvoice ? (
              <span className="text-xs text-muted">No invoice to reference.</span>
            ) : <span />}
            <button
              type="submit"
              disabled={sendDisabled || busy || !submission.ready}
              className="inline-flex items-center gap-1.5 rounded-md bg-copper px-3 py-1.5 text-xs font-sans font-semibold text-on-copper hover:bg-copper/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Icon name="mail" size={14} aria-hidden />
              {busy ? "Sending…" : "Send email"}
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
  { id: "messages" as const, label: "Messages" },
  { id: "email" as const, label: "Email" },
];

// ─── Main export ───────────────────────────────────────────────────────────────

export function DetailPanel({
  selected,
  repInvoiceId,
  workspaceInvoices,
  selectedInvoiceId,
  activeTab,
  timeline,
  messages,
  consent,
  smsConsentSource,
  isOwner,
  prefs,
  phone,
  sms,
  smsEnabled,
  smsQuietNow,
  quietHoursLabel,
  emailEnabled,
  emailMessages,
  customerEmail,
  promiseError,
  roster,
  view,
  sort,
  q,
  density,
  entity,
  selectedPromiseId,
  collision,
  smsTemplates,
  emailTemplates,
  orgCompany,
  orgPhone,
  orgPaymentLink,
  today,
  timeZone,
  loadError = null,
  orgId,
  userId,
  sendSubmissionId,
}: {
  selected: CaseItem | null;
  repInvoiceId: string | null;
  workspaceInvoices?: CaseInvoice[];
  selectedInvoiceId?: string | null;
  activeTab: "overview" | "activity" | "messages" | "email";
  timeline: TimelineEntry[];
  messages: MessageEntry[];
  consent: boolean;
  smsConsentSource: "inbound_stop" | "inbound_start" | "staff" | "import" | "unknown" | null;
  isOwner: boolean;
  prefs: CommPrefs;
  phone: string | null;
  sms: string | null;
  smsEnabled: boolean;
  smsQuietNow: boolean;
  quietHoursLabel: string;
  emailEnabled?: boolean;
  emailMessages?: EmailMessageEntry[];
  customerEmail?: string | null;
  promiseError?: string | null;
  roster: RosterMember[];
  view: ViewId;
  sort: SortId;
  q: string;
  density?: DensityId;
  entity?: EntityMode;
  selectedPromiseId: string | null;
  collision: Collision | null;
  smsTemplates: MessageTemplateRow[];
  emailTemplates: MessageTemplateRow[];
  orgCompany: string;
  orgPhone: string;
  orgPaymentLink: string;
  /** Org-local calendar day (YYYY-MM-DD) from todayInTz — never UTC. */
  today: string;
  timeZone?: string | null;
  loadError?: string | null;
  orgId: string;
  userId: string;
  sendSubmissionId: string | null;
}) {
  // ── Hooks (must be unconditional, before any early return) ─────────────────
  // Presence: beat immediately on customer change, then every HEARTBEAT_INTERVAL_MS.
  // Interval POSTs presence only — must not revalidate the dashboard loader.
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
    }, HEARTBEAT_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [customerId]);
  const navigate = useNavigate();
  const navigation = useNavigation();
  const location = useLocation();
  const formBusy = (action: string) => navigation.state !== "idle" && navigation.formAction === action;
  const [confirmCancelPromise, setConfirmCancelPromise] = useState(false);
  const [showAllInvoices, setShowAllInvoices] = useState(false);
  const [hashHistory, setHashHistory] = useState(false);
  const composerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const sync = () => setHashHistory(window.location.hash === "#history");
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, [location.hash]);

  // Reset confirm / invoice-preview state when case changes
  useEffect(() => {
    setConfirmCancelPromise(false);
    setShowAllInvoices(false);
  }, [customerId]);

  // Tab links update URL state while preserving the panel instance. Bring the
  // active composer into view so Email/Messages never appear to do nothing.
  useEffect(() => {
    if (activeTab !== "messages" && activeTab !== "email") return;
    const frame = window.requestAnimationFrame(() => {
      composerRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      composerRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeTab, customerId]);

  // Auto-reset cancel confirmation after 5s; cleanup prevents stale timers
  useEffect(() => {
    if (!confirmCancelPromise) return;
    const id = setTimeout(() => setConfirmCancelPromise(false), 5000);
    return () => clearTimeout(id);
  }, [confirmCancelPromise]);

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
  const tab = activeTab === "activity" ? "overview" : activeTab;
  const invoice = selectedInvoiceId ?? null;
  const invoices = workspaceInvoices ?? selected.invoices;
  const hrefBase = { case: selected.caseId, entity, invoice };
  const logHref = panelHref(view, sort, q, density, { ...hrefBase, tab, log: "1" });
  const overviewReturnTo = `/dashboard${panelHref(view, sort, q, density, { ...hrefBase, tab: "overview" })}`;

  const callAction = resolveCallAction(prefs, selected.phone, selected.contactBlocked);
  const callLogHref = panelHref(view, sort, q, density, { ...hrefBase, tab, log: "1", method: "call" });
  const historyExpanded = hashHistory || location.hash === "#history" || activeTab === "activity";
  const chase = chaseRecipientsFrom({
    phone: phone ?? selected.phone,
    email: customerEmail ?? selected.email,
    commPrefs: prefs,
    smsConsent: consent,
    contactBlocked: selected.contactBlocked,
    exceptionReason: selected.exceptionReason,
    smsEnabled,
    emailEnabled: emailEnabled ?? false,
    hasInvoice: invoices.length > 0,
  });
  const visibleInvoices = showAllInvoices
    ? invoices
    : previewWorkspaceInvoices(invoices, invoice, INVOICE_PREVIEW);
  const visibleTimeline = historyExpanded ? timeline : timeline.slice(0, HISTORY_PREVIEW);

  return (
    <aside
      aria-label={`Selected account ${selected.customerName}`}
      className="flex flex-col bg-surface border-l border-border h-full overflow-y-auto"
    >
      {/* Mobile/tablet: back to queue */}
      <div className="md:hidden px-4 pt-3 pb-1">
        <Link
          to={dashboardHref({ view, sort, q: q || undefined, entity, density })}
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
            to={dashboardHref({ view, sort, q: q || undefined, entity, density })}
            aria-label="Close detail panel"
            className={`hidden md:flex ${ICON_HIT_CLASS} rounded text-surface/60 hover:text-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper`}
          >
            <span aria-hidden="true" className="text-base leading-none">×</span>
          </Link>
        </div>
        <h2 className="mt-1.5 font-display text-xl font-semibold leading-tight text-surface">
          {selected.customerName}
        </h2>
        <p className="mt-1 text-xs text-surface/60">
          {plural(selected.invoiceCount, "open invoice")}
          <span className="mx-1.5 text-surface/30 select-none">·</span>
          oldest{" "}
          <span className={`font-mono font-semibold ${HEAT_TEXT[selected.heat.band] ?? "text-surface"}`}>
            {selected.oldestAgeDays}d
          </span>{" "}
          overdue
        </p>
        <Link
          to={`/accounts/${selected.customerId}`}
          className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-copper-bright hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper rounded"
        >
          Open account record
          <Icon name="external" size={12} aria-hidden />
        </Link>
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
          to={panelHref(view, sort, q, density, { ...hrefBase, tab: "messages" })}
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

        {/* Email → Email tab */}
        <Link
          to={panelHref(view, sort, q, density, { ...hrefBase, tab: "email" })}
          className="flex-1 flex flex-col items-center gap-1.5 py-2.5 rounded-card bg-surface border border-border text-copper hover:border-copper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper transition-colors"
        >
          <Icon name="mail" size={16} aria-hidden />
          <span className="text-[11.5px] font-sans font-semibold text-text">Email</span>
        </Link>
      </div>

      {/* ── Collision banner ────────────────────────────────────────────────── */}
      {collision && (collision.level !== "none" || collision.byUser) ? (
        <div
          role="status"
          className={
            collision.level === "live"
              ? "mx-5 mt-3 rounded-md border border-warm/40 bg-warm/10 px-3 py-2 text-xs font-sans text-warm"
              : "mx-5 mt-3 rounded-md border border-border bg-panel px-3 py-2 text-xs font-sans text-muted"
          }
        >
          {collision.level === "live"
            ? (
              <span className="inline-flex items-center gap-1">
                <Icon name="alert" size={12} aria-hidden="true" />
                {collision.liveUsers.join(", ")} {collision.liveUsers.length > 1 ? "are" : "is"} viewing this customer now
              </span>
            )
            : `Last contacted by ${collision.byUser}`}
        </div>
      ) : null}

      {/* ── Next best action card ─────────────────────────────────────────── */}
      <NbaCard selected={selected} smsEnabled={smsEnabled} prefs={prefs} phone={phone} view={view} sort={sort} q={q} density={density} entity={entity} invoice={invoice} logHref={logHref} timeZone={timeZone} />

      {/* ── Tab bar ─────────────────────────────────────────────────────────── */}
      <nav
        aria-label="Selected account sections"
        className="flex border-b border-border shrink-0 bg-paper"
      >
        {TABS.map((t) => {
          const isActive = tab === t.id;
          return (
            <Link
              key={t.id}
              to={panelHref(view, sort, q, density, { ...hrefBase, tab: t.id })}
              id={`${t.id}-tab`}
              aria-current={isActive ? "page" : undefined}
              className={[
                "px-4 py-3 text-[13px] font-sans focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper transition-colors",
                isActive
                  ? "border-b-2 border-copper text-text font-semibold"
                  : "border-b-2 border-transparent text-muted font-medium hover:text-text",
              ].join(" ")}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>

      {/* ── Tab panels ──────────────────────────────────────────────────────── */}

      {tab === "overview" ? (
        <section
          id="overview-panel"
          className="flex-1 px-5 py-4"
        >
          <div className="mb-4">
            <span className="text-xs font-sans font-medium uppercase tracking-wider text-muted">Contacts</span>
            {chase.length === 0 ? (
              <p className="mt-2 text-xs text-muted">No chase recipients on file.</p>
            ) : (
              <ul className="mt-2 flex flex-col gap-1" aria-label="Chase recipients">
                {chase.map((row) => (
                  <li
                    key={`${row.channel}:${row.address}`}
                    className="flex items-start justify-between gap-2 rounded-md bg-paper px-3 py-2"
                  >
                    <span className="text-xs font-sans text-text">
                      <span className="font-semibold">{CHASE_CHANNEL_LABEL[row.channel]}</span>
                      <span className="text-muted"> · {row.address}</span>
                    </span>
                    {row.enabled ? (
                      <span className="text-[11px] font-sans font-medium text-cool">Ready</span>
                    ) : (
                      <span className="text-[11px] font-sans text-muted text-right">{row.reasonDisabled}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

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
                  ? `${nextActionLabel(selected.nextActionType)}${selected.nextActionAt ? ` · ${formatDate(selected.nextActionAt)}` : ""}`
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
                  value={`/dashboard${panelHref(view, sort, q, density, { ...hrefBase, tab: "overview" })}`}
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
          </div>

          {/* Why this priority */}
          <div className="mt-4 rounded-card bg-panel p-4 shadow-tile">
            <div className="flex items-center justify-between">
              <span className="text-xs font-sans font-medium uppercase tracking-wider text-muted">
                Why this priority
              </span>
              <span className={`text-sm font-sans font-semibold ${LEVEL_TONE[selected.effectiveLevel] ?? "text-text"}`}>
                {selected.effectiveLevel}
                {selected.override ? <Icon name="pin" size={12} aria-hidden="true" className="ml-0.5 inline" /> : null}
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
                    ? ` by ${roster.find((m) => m.userId === selected.override!.by)?.label ?? "a teammate"}`
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
                disabled={formBusy("/api/priority-override")}
                className="rounded-md border border-copper/40 px-3 py-1 text-xs font-sans font-medium text-copper hover:bg-copper/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {formBusy("/api/priority-override") ? "Saving…" : "Save"}
              </button>
            </form>
          </div>

          {/* Invoice list — overdue ∪ coming-due; click sets ?invoice= */}
          <div className="mt-4">
            <span className="text-xs font-sans font-medium uppercase tracking-wider text-muted">Invoices</span>
            {invoices.length === 0 ? (
              <p className="mt-2 text-xs text-muted">No invoices.</p>
            ) : (
              <ul className="mt-2 flex flex-col gap-1">
                {visibleInvoices.map((inv) => {
                  const highlighted = invoice === inv.invoiceId;
                  return (
                    <li key={inv.invoiceId}>
                      <Link
                        to={panelHref(view, sort, q, density, { ...hrefBase, tab: "overview", invoice: inv.invoiceId })}
                        aria-current={highlighted ? "true" : undefined}
                        className={[
                          "flex items-center justify-between gap-2 rounded-md px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper",
                          highlighted ? "bg-copper/10 ring-1 ring-copper/40" : "bg-paper hover:bg-panel",
                        ].join(" ")}
                      >
                        <span className="font-mono text-xs text-text">{inv.docNumber ?? "—"}</span>
                        <span className="font-mono text-xs text-muted tabular-nums">
                          {formatUSD(inv.balance)}
                          {inv.lateFee > 0 ? <span className="text-hot"> + {formatUSD(inv.lateFee)} late fee</span> : null}
                          {" · "}{inv.ageDays > 0 ? `${inv.ageDays}d` : "Due"}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
            {visibleInvoices.length < invoices.length ? (
              <button
                type="button"
                onClick={() => setShowAllInvoices(true)}
                className="mt-2 text-xs font-sans font-medium text-copper hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper rounded"
              >
                Show all {invoices.length}
              </button>
            ) : null}
            {selected.lateFeeTotal > 0 ? (
              <p className="mt-1 text-xs text-muted italic">Late fees are display-only estimates; QuickBooks balances are unchanged.</p>
            ) : null}
          </div>

          {/* History — collapsed to 5; #history expands */}
          <div id="history" className="mt-4 scroll-mt-4">
            <span className="text-xs font-sans font-medium uppercase tracking-wider text-muted">History</span>
            {timeline.length === 0 ? (
              <p className="mt-2 text-xs text-muted">{loadError ?? "No activity yet."}</p>
            ) : (
              <TimelineList entries={visibleTimeline} today={today} timeZone={timeZone} />
            )}
            {timeline.length > HISTORY_PREVIEW && !historyExpanded ? (
              <Link
                to={{ pathname: location.pathname, search: location.search, hash: "#history" }}
                className="mt-2 inline-block text-xs font-sans font-medium text-copper hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper rounded"
              >
                Show all {timeline.length}
              </Link>
            ) : null}
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
                {selected.promise && selected.amountReceived != null && selected.promise.amount > 0 ? (
                  <div className="mt-2 h-1.5 w-full rounded-full bg-border/50 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${accent === "hot" ? "bg-hot" : "bg-cool"}`}
                      style={{ width: `${Math.min(100, (selected.amountReceived / selected.promise.amount) * 100)}%` }}
                    />
                  </div>
                ) : null}
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
                    {confirmCancelPromise ? (
                      <span className="inline-flex items-center gap-2 text-xs font-sans">
                        <span className="text-muted">Cancel this promise?</span>
                        <button
                          type="submit"
                          disabled={formBusy("/api/promises/cancel")}
                          className="font-medium text-hot hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper rounded disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                          {formBusy("/api/promises/cancel") ? "Cancelling…" : "Confirm"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmCancelPromise(false)}
                          className="font-medium text-muted hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper rounded"
                        >
                          Keep
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmCancelPromise(true)}
                        className="text-xs font-sans font-medium text-copper hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper rounded"
                      >
                        Cancel promise
                      </button>
                    )}
                  </form>
                ) : null}
              </div>
            );
          })() : null}
        </section>
      ) : null}

      {tab === "messages" ? (
        <MessagesTab
          selected={selected}
          invoices={invoices}
          repInvoiceId={repInvoiceId}
          messages={messages}
          consent={consent}
          smsConsentSource={smsConsentSource}
          isOwner={isOwner}
          prefs={prefs}
          phone={phone}
          sms={sms}
          smsEnabled={smsEnabled}
          smsQuietNow={smsQuietNow}
          quietHoursLabel={quietHoursLabel}
          view={view}
          sort={sort}
          q={q}
          density={density}
          entity={entity}
          invoice={invoice}
          collision={collision}
          smsTemplates={smsTemplates}
          orgCompany={orgCompany}
          orgPhone={orgPhone}
          orgPaymentLink={orgPaymentLink}
          timeZone={timeZone}
          composerRef={composerRef}
          loadError={loadError}
          orgId={orgId}
          userId={userId}
          sendSubmissionId={sendSubmissionId}
        />
      ) : null}

      {tab === "email" ? (
        <EmailTab
          key={selected.caseId}
          selected={selected}
          invoices={invoices}
          repInvoiceId={repInvoiceId}
          emailMessages={emailMessages ?? []}
          prefs={prefs}
          customerEmail={customerEmail ?? null}
          emailEnabled={emailEnabled ?? false}
          view={view}
          sort={sort}
          q={q}
          density={density}
          entity={entity}
          invoice={invoice}
          emailTemplates={emailTemplates}
          orgCompany={orgCompany}
          orgPhone={orgPhone}
          orgPaymentLink={orgPaymentLink}
          timeZone={timeZone}
          composerRef={composerRef}
          loadError={loadError}
          orgId={orgId}
          userId={userId}
          sendSubmissionId={sendSubmissionId}
        />
      ) : null}
    </aside>
  );
}

// ---------------------------------------------------------------------------
// NbaCard — "Next best action" callout between action tiles and tab bar
// ---------------------------------------------------------------------------

function TimelineList({
  entries, today, timeZone,
}: {
  entries: TimelineEntry[];
  today: string;
  timeZone?: string | null;
}) {
  return (
    <ol className="mt-2 flex flex-col">
      {entries.map((e, index) => {
        const isLast = index === entries.length - 1;
        if (e.kind === "sms") {
          const node = TL_NODE[e.direction] ?? TL_NODE.outbound;
          return (
            <li key={e.id} className="flex gap-3 pb-4 last:pb-0">
              <div className="flex flex-col items-center shrink-0">
                <span className={`grid place-items-center w-7 h-7 rounded-lg ${node.bg} ${node.color}`}>
                  <Icon name="message" size={14} aria-hidden />
                </span>
                {!isLast ? <span aria-hidden="true" className="flex-1 w-0.5 bg-border mt-1.5" /> : null}
              </div>
              <div className="min-w-0 flex flex-col gap-0.5 pt-0.5">
                <span className={`text-sm font-sans font-semibold ${e.direction === "inbound" ? "text-cool" : "text-text"}`}>
                  {e.outcomeLabel}
                </span>
                <span className="font-mono text-xs text-muted">{formatInstant(e.at, timeZone)}</span>
                {e.body ? (
                  <span className="text-xs text-muted whitespace-pre-wrap line-clamp-3">{e.body}</span>
                ) : null}
                {e.errorCode ? (
                  <span className="text-xs font-sans text-hot" title={`Provider code ${e.errorCode}`}>
                    {smsFailureLabel(e.errorCode)}
                  </span>
                ) : null}
              </div>
            </li>
          );
        }
        const broken = isTimelinePromiseBroken(e.promisedDate, today);
        const node = TL_NODE[e.method] ?? TL_NODE.note;
        return (
          <li key={e.id} className="flex gap-3 pb-4 last:pb-0">
            <div className="flex flex-col items-center shrink-0">
              <span className={`grid place-items-center w-7 h-7 rounded-lg ${node.bg} ${node.color}`}>
                <Icon name={METHOD_ICON[e.method] ?? "note"} size={14} aria-hidden />
              </span>
              {!isLast ? <span aria-hidden="true" className="flex-1 w-0.5 bg-border mt-1.5" /> : null}
            </div>
            <div className="min-w-0 flex flex-col gap-0.5 pt-0.5">
              <span className="text-sm font-sans font-semibold text-text">
                {e.outcomeLabel ?? "Logged"}
                {e.authorLabel ? <span className="font-normal text-muted"> · by {e.authorLabel}</span> : null}
              </span>
              <span className="font-mono text-xs text-muted">{formatInstant(e.at, timeZone)}</span>
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
      })}
    </ol>
  );
}

function NbaCard({
  selected, smsEnabled, prefs, phone, view, sort, q, density, entity, invoice, logHref, timeZone,
}: {
  selected: CaseItem;
  smsEnabled: boolean;
  prefs: CommPrefs;
  phone: string | null;
  view: ViewId;
  sort: SortId;
  q: string;
  density?: DensityId;
  entity?: EntityMode;
  invoice?: string | null;
  logHref: string;
  timeZone?: string | null;
}) {
  const nba = whyNow(selected, timeZone);

  // Determine primary action: prefer text tab if sendable, else log call
  const gate = smsGateFor({
    smsEnabled,
    contactBlocked: selected.contactBlocked,
    exceptionReason: selected.exceptionReason,
    doNotText: prefs.doNotText ?? false,
    hasInvoice: selected.invoices.length > 0,
    consent: selected.smsConsent,
    phone,
  });
  const canText = gate === null;
  const callAction = resolveCallAction(prefs, phone, selected.contactBlocked);
  const canCall = callAction.kind === "live";
  const textHref = panelHref(view, sort, q, density, { case: selected.caseId, tab: "messages", entity, invoice });
  const callHref = panelHref(view, sort, q, density, { case: selected.caseId, tab: "overview", log: "1", method: "call", entity, invoice });

  return (
    <div className="mx-4 my-3 rounded-lg border border-copper/30 bg-copper/5 px-4 py-3">
      <p className="text-[10px] font-mono font-semibold uppercase tracking-wider text-copper mb-1">
        Next best action
      </p>
      <p className="text-sm font-sans font-semibold text-text leading-snug">{nba.headline}</p>
      {nba.reason && (
        <p className="mt-0.5 text-xs text-muted leading-relaxed">{nba.reason}</p>
      )}
      <div className="mt-2.5 flex items-center gap-2">
        {canText ? (
          <Link
            to={textHref}
            className="inline-flex items-center gap-1.5 rounded-md bg-copper px-3 py-1.5 text-xs font-semibold text-surface hover:bg-copper/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper transition-colors"
          >
            <Icon name="message" size={13} aria-hidden />
            Send text
          </Link>
        ) : canCall ? (
          <Link
            to={callHref}
            className="inline-flex items-center gap-1.5 rounded-md bg-copper px-3 py-1.5 text-xs font-semibold text-surface hover:bg-copper/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper transition-colors"
          >
            <Icon name="phone" size={13} aria-hidden />
            Log call
          </Link>
        ) : null}
        <Link
          to={logHref}
          className="text-xs font-sans font-medium text-copper hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper rounded"
        >
          Log contact
        </Link>
      </div>
    </div>
  );
}
