// app/components/MessageThreadPanel.tsx
import { useEffect, useState } from "react";
import { Form, Link, useNavigation, useSearchParams } from "react-router";
import type { ThreadRow } from "../lib/message-inbox";
import type { MessageEntry, EmailMessageEntry } from "~/routes/dashboard";
import { MessageBubbles } from "./MessageBubbles";
import { SMS_TEMPLATES, applyTemplate, type TemplateVars } from "../lib/sms-templates";
import { EMAIL_TEMPLATES, applyEmailTemplate } from "../lib/email-templates";
import { formatDate } from "../lib/dates";
import { emailFailureLabel, isHardBounce } from "../lib/labels";
import { Icon } from "./Icons";

const SMS_BANNER: Record<string, { text: string; tone: string }> = {
  sent: { text: "Text sent.", tone: "text-cool" },
  noconsent: { text: "Not sent — customer has not consented to SMS.", tone: "text-hot" },
  optout: { text: "Not sent — customer opted out of texts.", tone: "text-hot" },
  error: { text: "Could not send the text.", tone: "text-hot" },
  blocked: { text: "Not sent — this case is marked do-not-contact / legal.", tone: "text-hot" },
  disabled: { text: "Not sent — text messaging is turned off for this workspace.", tone: "text-hot" },
};

const EMAIL_BANNER: Record<string, { text: string; tone: string }> = {
  sent: { text: "Email sent.", tone: "text-cool" },
  disabled: { text: "Not sent — email is turned off for this workspace.", tone: "text-hot" },
  optout: { text: "Not sent — customer opted out of email.", tone: "text-hot" },
  blocked: { text: "Not sent — this case is marked do-not-contact / legal.", tone: "text-hot" },
  error: { text: "Could not send the email.", tone: "text-hot" },
};

interface Props {
  thread: ThreadRow | null;
  messages: MessageEntry[];
  emailMessages: EmailMessageEntry[];
  consent: boolean;
  phone: string | null;
  vars: TemplateVars;
  sms: string | null;
  smsEnabled: boolean;
  emailEnabled: boolean;
  selectedEmail: string | null;
  tab: string;
  sort: string;
  q: string;
}

export function MessageThreadPanel({
  thread, messages, emailMessages, consent, phone, vars, sms, smsEnabled,
  emailEnabled, selectedEmail, tab, sort, q,
}: Props) {
  const [body, setBody] = useState("");
  const [subject, setSubject] = useState("");
  const [searchParams] = useSearchParams();
  const emailResult = searchParams.get("email");
  const navigation = useNavigation();
  const formBusy = (action: string) => navigation.state !== "idle" && navigation.formAction === action;

  useEffect(() => {
    setBody("");
    setSubject("");
  }, [thread?.customerId, thread?.channel]);

  if (!thread) {
    return (
      <aside className="hidden lg:flex flex-col items-center justify-center bg-surface border border-border rounded-card p-8 text-center text-muted">
        <Icon name="message" size={28} className="mb-2 text-muted/60" aria-hidden />
        <p className="text-sm">Select a thread to preview it here.</p>
      </aside>
    );
  }

  const isEmail = thread.channel === "email";
  const smsSendDisabled = !smsEnabled || !thread.canReply;
  // Workspace-off and opt-outs are compliance-sensitive (red); routine soft blocks are amber.
  const smsGateMessage = !smsEnabled ? "Text messaging is turned off for this workspace." : thread.replyDisabledReason ?? "Sending is not available.";
  const smsGateHard = !smsEnabled || (thread.replyDisabledReason ?? "").includes("opted out");

  // F-022: warn before composing into an address that just hard-bounced.
  const lastEmail = emailMessages.length > 0 ? emailMessages[emailMessages.length - 1] : null;
  const lastEmailBounced = lastEmail != null && lastEmail.direction === "outbound" && isHardBounce(lastEmail.errorCode);

  const params = new URLSearchParams({
    tab, sort, ...(q ? { q } : {}),
    channel: thread.channel,
    customerId: thread.customerId,
  });
  const returnTo = `/messages?${params.toString()}`;

  const smsBanner = sms ? SMS_BANNER[sms] : null;
  const emailBanner = emailResult ? (EMAIL_BANNER[emailResult] ?? null) : null;
  const banner = isEmail ? emailBanner : smsBanner;

  return (
    <aside className="flex flex-col bg-surface border border-border rounded-card overflow-hidden">
      <header className="bg-ink text-surface px-4 py-3">
        <p className="font-mono text-[10px] uppercase tracking-wide text-surface/50">Thread</p>
        <h2 className="font-display text-lg font-semibold leading-tight">{thread.customerName}</h2>
        <div className="mt-2 flex flex-wrap gap-2">
          {thread.openCaseId ? (
            <Link to={`/dashboard?case=${thread.openCaseId}`} className="inline-flex items-center gap-1 text-xs text-copper hover:underline">
              Open in Collections <Icon name="chevronRight" size={13} />
            </Link>
          ) : null}
          <Link to={`/accounts/${thread.customerId}`} className="inline-flex items-center gap-1 text-xs text-surface/70 hover:underline">
            View account
          </Link>
        </div>
      </header>

      {/* Channel info row */}
      {isEmail ? (
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border">
          <span className="text-xs text-muted">
            Email:{" "}
            <span className={selectedEmail ? "font-semibold text-text" : "font-semibold text-muted"}>
              {selectedEmail ?? "—"}
            </span>
          </span>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-border">
          <span className="text-xs text-muted">
            SMS consent:{" "}
            <span className={consent ? "font-semibold text-cool" : "font-semibold text-hot"}>{consent ? "yes" : "no"}</span>
            {phone ? <span className="text-muted"> · {phone}</span> : null}
          </span>
          <Form method="post" action="/api/sms-consent">
            <input type="hidden" name="invoiceId" value={thread.anchorInvoiceId ?? ""} />
            <input type="hidden" name="customerId" value={thread.customerId} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <input type="hidden" name="consent" value={consent ? "false" : "true"} />
            <button type="submit" disabled={formBusy("/api/sms-consent")} className="text-xs font-medium text-copper hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper rounded disabled:opacity-60 disabled:cursor-not-allowed">
              {formBusy("/api/sms-consent") ? "Updating…" : consent ? "Revoke consent" : "Mark consented"}
            </button>
          </Form>
        </div>
      )}

      {banner ? <p className={`px-4 py-2 text-xs font-medium ${banner.tone}`} role={banner.tone === "text-hot" ? "alert" : "status"}>{banner.text}</p> : null}

      {/* Thread */}
      <div
        className="max-h-[420px] overflow-y-auto px-4 py-4"
        tabIndex={0}
        role="region"
        aria-label="Message history"
      >
        {isEmail ? (
          emailMessages.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
              <Icon name="mail" size={24} className="text-border" aria-hidden />
              <p className="text-sm font-semibold text-text">No emails yet.</p>
            </div>
          ) : (
            <ul className="flex flex-col gap-3">
              {emailMessages.map((msg) => (
                <li key={msg.id} className={`flex ${msg.direction === "inbound" ? "justify-start" : "justify-end"}`}>
                  <div className={`max-w-[85%] rounded-lg px-3 py-2 ${msg.direction === "inbound" ? "bg-cool/10 text-text" : "bg-copper/10 text-text"}`}>
                    {msg.subject ? (
                      <p className="text-xs font-semibold text-muted mb-1">{msg.subject}</p>
                    ) : null}
                    <p className="text-xs whitespace-pre-wrap">{msg.body}</p>
                    <p className="mt-1 text-[11px] text-muted">{formatDate(msg.createdAt)}</p>
                    {msg.errorCode ? <p className="text-xs text-hot">{emailFailureLabel(msg.errorCode)}</p> : null}
                  </div>
                </li>
              ))}
            </ul>
          )
        ) : (
          messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
              <Icon name="message" size={24} className="text-border" aria-hidden />
              <p className="text-sm font-semibold text-text">No messages yet.</p>
            </div>
          ) : (
            <MessageBubbles messages={messages} />
          )
        )}
      </div>

      {/* Composer */}
      {isEmail ? (
        <div className="border-t border-border px-4 py-3">
          <select
            key={`email-tmpl-${thread.customerId}-${thread.channel}`}
            defaultValue=""
            disabled={!emailEnabled || !thread.canReply}
            onChange={(e) => {
              const tmpl = EMAIL_TEMPLATES.find((t) => t.id === e.target.value);
              if (tmpl) {
                setSubject(applyEmailTemplate(tmpl.subject, vars));
                setBody(applyEmailTemplate(tmpl.body, vars));
              }
            }}
            className="w-full mb-2 rounded-md border border-border bg-panel px-3 py-1.5 text-xs text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
            aria-label="Email template"
          >
            <option value="" disabled>Pick a template…</option>
            {EMAIL_TEMPLATES.map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
          <Form method="post" action="/api/email/send" className="flex flex-col gap-2">
            <input type="hidden" name="invoiceId" value={thread.anchorInvoiceId ?? ""} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <input
              name="subject"
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Subject"
              required
              disabled={!emailEnabled || !thread.canReply}
              aria-label="Email subject"
              className="w-full rounded-md border border-border bg-panel px-3 py-2 text-sm text-text placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper disabled:opacity-40 disabled:cursor-not-allowed"
            />
            <textarea
              name="body"
              rows={3}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Type an email…"
              required
              disabled={!emailEnabled || !thread.canReply}
              aria-label="Email body"
              className="w-full resize-none rounded-md border border-border bg-panel px-3 py-2 text-sm text-text placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper disabled:opacity-40 disabled:cursor-not-allowed"
            />
            {lastEmailBounced ? (
              <p className="text-xs text-hot">Last email to this address bounced.</p>
            ) : null}
            <div className="flex items-center justify-between gap-2">
              {!emailEnabled ? (
                <span className="text-xs text-hot">Email is turned off for this workspace.</span>
              ) : !thread.canReply ? (
                <span className="text-xs text-muted">{thread.replyDisabledReason}</span>
              ) : <span />}
              <button
                type="submit"
                disabled={!emailEnabled || !thread.canReply || formBusy("/api/email/send")}
                className="inline-flex items-center gap-1.5 rounded-md bg-copper px-3 py-1.5 text-xs font-semibold text-ink hover:bg-copper/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <Icon name="mail" size={14} aria-hidden /> {formBusy("/api/email/send") ? "Sending…" : "Send email"}
              </button>
            </div>
          </Form>
        </div>
      ) : (
        <div className="border-t border-border px-4 py-3">
          {smsSendDisabled && (
            <p
              className={`mb-2 rounded-md px-3 py-2 text-xs font-sans font-medium ${
                smsGateHard
                  ? "bg-hot/10 border border-hot/30 text-hot"
                  : "bg-amber-400/10 border border-amber-400/30 text-amber-700"
              }`}
              role={smsGateHard ? "alert" : "status"}
            >
              {smsGateMessage}
            </p>
          )}
          <div className="flex flex-wrap gap-1.5 mb-2" role="group" aria-label="Message templates">
            {SMS_TEMPLATES.map((t) => (
              <button
                key={t.id} type="button" disabled={smsSendDisabled} onClick={() => setBody(applyTemplate(t.body, vars))}
                className="text-xs text-muted border border-border rounded-md px-2 py-1 hover:text-copper hover:border-copper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {t.label}
              </button>
            ))}
          </div>
          <Form method="post" action="/api/text/send" className="flex flex-col gap-2">
            <input type="hidden" name="invoiceId" value={thread.anchorInvoiceId ?? ""} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <textarea
              name="body" rows={3} value={body} onChange={(e) => setBody(e.target.value)}
              placeholder="Type a message…" required
              disabled={smsSendDisabled}
              aria-label="Message body"
              className="w-full resize-none rounded-md border border-border bg-panel px-3 py-2 text-sm text-text placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper disabled:opacity-40 disabled:cursor-not-allowed"
            />
            <div className="flex items-center justify-between gap-2">
              <span />
              <button
                type="submit" disabled={smsSendDisabled || formBusy("/api/text/send")}
                className="inline-flex items-center gap-1.5 rounded-md bg-copper px-3 py-1.5 text-xs font-semibold text-ink hover:bg-copper/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <Icon name="message" size={14} aria-hidden /> {formBusy("/api/text/send") ? "Sending…" : "Send text"}
              </button>
            </div>
          </Form>
        </div>
      )}
    </aside>
  );
}
