// app/components/MessageThreadPanel.tsx
import { useEffect, useState } from "react";
import { Form, Link } from "react-router";
import type { ThreadRow } from "../lib/message-inbox";
import type { MessageEntry } from "~/routes/dashboard";
import { MessageBubbles } from "./MessageBubbles";
import { SMS_TEMPLATES, applyTemplate, type TemplateVars } from "../lib/sms-templates";
import { Icon } from "./Icons";

const SMS_BANNER: Record<string, { text: string; tone: string }> = {
  sent: { text: "Text sent.", tone: "text-cool" },
  noconsent: { text: "Not sent — customer has not consented to SMS.", tone: "text-hot" },
  optout: { text: "Not sent — customer opted out of texts.", tone: "text-hot" },
  error: { text: "Could not send the text.", tone: "text-hot" },
  blocked: { text: "Not sent — this case is marked do-not-contact / legal.", tone: "text-hot" },
};

interface Props {
  thread: ThreadRow | null;
  messages: MessageEntry[];
  consent: boolean;
  phone: string | null;
  vars: TemplateVars;
  sms: string | null;
  tab: string;
  sort: string;
  q: string;
}

export function MessageThreadPanel({ thread, messages, consent, phone, vars, sms, tab, sort, q }: Props) {
  const [body, setBody] = useState("");
  useEffect(() => { setBody(""); }, [thread?.customerId]);

  if (!thread) {
    return (
      <aside className="hidden lg:flex flex-col items-center justify-center bg-surface border border-border rounded-card p-8 text-center text-muted">
        <Icon name="message" size={28} className="mb-2 text-muted/60" aria-hidden />
        <p className="text-sm">Select a thread to preview it here.</p>
      </aside>
    );
  }

  const params = new URLSearchParams({ tab, sort, ...(q ? { q } : {}), customerId: thread.customerId });
  const returnTo = `/messages?${params.toString()}`;
  const banner = sms ? SMS_BANNER[sms] : null;

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

      {/* Consent row */}
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
          <button type="submit" className="text-xs font-medium text-copper hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper rounded">
            {consent ? "Revoke consent" : "Mark consented"}
          </button>
        </Form>
      </div>

      {banner ? <p className={`px-4 py-2 text-xs font-medium ${banner.tone}`}>{banner.text}</p> : null}

      {/* Thread */}
      <div className="max-h-[420px] overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
            <Icon name="message" size={24} className="text-border" aria-hidden />
            <p className="text-sm font-semibold text-text">No messages yet.</p>
          </div>
        ) : (
          <MessageBubbles messages={messages} />
        )}
      </div>

      {/* Templates + composer */}
      <div className="border-t border-border px-4 py-3">
        <div className="flex flex-wrap gap-1.5 mb-2" role="group" aria-label="Message templates">
          {SMS_TEMPLATES.map((t) => (
            <button
              key={t.id} type="button" onClick={() => setBody(applyTemplate(t.body, vars))}
              className="text-xs text-muted border border-border rounded-md px-2 py-1 hover:text-copper hover:border-copper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper transition-colors"
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
            className="w-full resize-none rounded-md border border-border bg-panel px-3 py-2 text-sm text-text placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
          />
          <div className="flex items-center justify-between gap-2">
            {thread.canReply ? <span /> : <span className="text-xs text-muted">{thread.replyDisabledReason}</span>}
            <button
              type="submit" disabled={!thread.canReply}
              className="inline-flex items-center gap-1.5 rounded-md bg-copper px-3 py-1.5 text-xs font-semibold text-surface hover:bg-copper/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Icon name="message" size={14} aria-hidden /> Send text
            </button>
          </div>
        </Form>
      </div>
    </aside>
  );
}
