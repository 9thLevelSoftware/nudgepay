// TemplateEditor — settings templates tab. Owner-only CRUD over org message
// templates (SMS + email), with a channel toggle, token insert chips, a sample
// preview pane, unknown-token warning, inline edit, an add-template form, and
// a reset-to-defaults action per channel.

import { useEffect, useRef, useState } from "react";
import { Form, useNavigation, useSearchParams } from "react-router";
import type { MessageTemplateRow } from "../lib/message-templates";
import {
  TEMPLATE_TOKEN_KEYS,
  applyTemplate,
  unknownTokens,
  type TemplateVars,
} from "../lib/sms-templates";
import { applyEmailTemplate } from "../lib/email-templates";

type Channel = "sms" | "email";

const SAMPLE_CUSTOMER = "Acme Plumbing";
const SAMPLE_INVOICE = "INV-1042";
const SAMPLE_BALANCE = "$1,240.00";
const SAMPLE_DUE_DATE = "Mar 15, 2026";
const PLACEHOLDER_COMPANY = "Your company";
const PLACEHOLDER_PHONE = "555-0100";
const PLACEHOLDER_PAYMENT_LINK = "https://pay.example.com";

function sampleVars(org: {
  company?: string;
  phone?: string;
  paymentLink?: string;
}): TemplateVars {
  return {
    customer: SAMPLE_CUSTOMER,
    invoice: SAMPLE_INVOICE,
    balance: SAMPLE_BALANCE,
    dueDate: SAMPLE_DUE_DATE,
    company: org.company?.trim() || PLACEHOLDER_COMPANY,
    phone: org.phone?.trim() || PLACEHOLDER_PHONE,
    paymentLink: org.paymentLink?.trim() || PLACEHOLDER_PAYMENT_LINK,
  };
}

function interpolate(channel: Channel, text: string, vars: TemplateVars): string {
  return channel === "email" ? applyEmailTemplate(text, vars) : applyTemplate(text, vars);
}

export function TemplateEditor({
  smsTemplates,
  emailTemplates,
  isOwner,
  returnTo,
  orgCompany = "",
  orgPhone = "",
  orgPaymentLink = "",
}: {
  smsTemplates: MessageTemplateRow[];
  emailTemplates: MessageTemplateRow[];
  isOwner: boolean;
  returnTo: string;
  orgId: string;
  orgCompany?: string;
  orgPhone?: string;
  orgPaymentLink?: string;
}) {
  const [channel, setChannel] = useState<Channel>("sms");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [addingOpen, setAddingOpen] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [sp] = useSearchParams();
  const navigation = useNavigation();

  const busy = (intent: string) =>
    navigation.state !== "idle" && navigation.formData?.get("intent") === intent;

  // A successful save/delete/reset redirects back here with a fresh template
  // list — close any open edit/add/reset UI so it doesn't linger stale.
  useEffect(() => {
    setEditingId(null);
    setAddingOpen(false);
    setConfirmReset(false);
  }, [smsTemplates, emailTemplates]);

  const templates = channel === "sms" ? smsTemplates : emailTemplates;
  const saved = sp.get("saved") === "template";
  const errorCode = sp.get("error");
  const vars = sampleVars({
    company: orgCompany,
    phone: orgPhone,
    paymentLink: orgPaymentLink,
  });

  return (
    <section className="rounded-lg border border-border bg-surface p-5">
      <h2 className="font-display text-base font-semibold text-text">Message templates</h2>
      <p className="mt-1 text-xs text-muted">
        Customize the templates used when sending SMS and email to customers.
      </p>

      {errorCode && (
        <p className="mt-2 rounded-md border border-hot/30 bg-hot/10 px-3 py-2 text-xs text-hot" role="alert">
          Something went wrong saving your template. Please try again.
        </p>
      )}
      {saved && (
        <p className="mt-2 text-xs text-cool" role="status">Templates updated.</p>
      )}

      {/* Channel toggle */}
      <div className="mt-3 inline-flex rounded-md border border-border p-0.5" role="tablist" aria-label="Template channel">
        <button
          type="button"
          role="tab"
          aria-selected={channel === "sms"}
          onClick={() => { setChannel("sms"); setEditingId(null); setAddingOpen(false); }}
          className={`rounded px-3 py-1 text-xs font-semibold transition-colors ${
            channel === "sms" ? "bg-copper text-ink" : "text-muted hover:text-text"
          }`}
        >
          SMS
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={channel === "email"}
          onClick={() => { setChannel("email"); setEditingId(null); setAddingOpen(false); }}
          className={`rounded px-3 py-1 text-xs font-semibold transition-colors ${
            channel === "email" ? "bg-copper text-ink" : "text-muted hover:text-text"
          }`}
        >
          Email
        </button>
      </div>

      {/* Token legend */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {TEMPLATE_TOKEN_KEYS.map((k) => (
          <code key={k} className="rounded bg-panel px-1.5 py-0.5 font-mono text-[11px] text-text">
            {`{${k}}`}
          </code>
        ))}
        <span className="text-xs text-muted">Unknown tokens are sent as written.</span>
      </div>

      {/* Template cards */}
      <ul className="mt-4 flex flex-col gap-3" role="list">
        {templates.map((t) => (
          <li key={t.id} className="rounded-md border border-border p-3">
            {isOwner && editingId === t.id ? (
              <TemplateForm
                channel={channel}
                returnTo={returnTo}
                initial={t}
                vars={vars}
                onCancel={() => setEditingId(null)}
                busy={busy("save_template")}
              />
            ) : (
              <>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-text">{t.label}</span>
                  {isOwner && (
                    <div className="flex items-center gap-3 shrink-0">
                      <button
                        type="button"
                        onClick={() => { setEditingId(t.id); setAddingOpen(false); }}
                        className="text-xs font-medium text-copper hover:underline"
                      >
                        Edit
                      </button>
                      <Form
                        method="post"
                        action="/api/org-settings"
                        onSubmit={(e) => {
                          if (!window.confirm(`Delete "${t.label}"?`)) e.preventDefault();
                        }}
                      >
                        <input type="hidden" name="intent" value="delete_template" />
                        <input type="hidden" name="returnTo" value={returnTo} />
                        <input type="hidden" name="channel" value={channel} />
                        <input type="hidden" name="slug" value={t.slug} />
                        <button
                          type="submit"
                          disabled={busy("delete_template")}
                          className="text-xs font-medium text-hot hover:underline disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                          {busy("delete_template") ? "Deleting…" : "Delete"}
                        </button>
                      </Form>
                    </div>
                  )}
                </div>
                {channel === "email" && t.subject ? (
                  <p className="mt-1 text-xs font-medium text-muted">{t.subject}</p>
                ) : null}
                <pre className="mt-1.5 whitespace-pre-wrap font-sans text-xs text-muted">{t.body}</pre>
                <UnknownTokenWarning body={t.body} subject={channel === "email" ? t.subject : null} />
                <TemplatePreview
                  channel={channel}
                  subject={channel === "email" ? t.subject : null}
                  body={t.body}
                  vars={vars}
                />
              </>
            )}
          </li>
        ))}
        {templates.length === 0 ? (
          <li className="text-xs text-muted">No {channel === "sms" ? "SMS" : "email"} templates yet.</li>
        ) : null}
      </ul>

      {isOwner ? (
        <div className="mt-4 flex flex-col gap-3">
          {addingOpen ? (
            <TemplateForm
              channel={channel}
              returnTo={returnTo}
              vars={vars}
              onCancel={() => setAddingOpen(false)}
              busy={busy("save_template")}
            />
          ) : (
            <button
              type="button"
              onClick={() => { setAddingOpen(true); setEditingId(null); }}
              className="self-start rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-copper hover:border-copper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
            >
              + Add template
            </button>
          )}

          <div className="border-t border-border pt-3">
            {confirmReset ? (
              <Form method="post" action="/api/org-settings" className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="intent" value="reset_templates" />
                <input type="hidden" name="returnTo" value={returnTo} />
                <input type="hidden" name="channel" value={channel} />
                <span className="text-xs text-muted">
                  Reset all {channel === "sms" ? "SMS" : "email"} templates to defaults? This deletes your custom templates for this channel.
                </span>
                <button
                  type="submit"
                  disabled={busy("reset_templates")}
                  className="text-xs font-semibold text-hot hover:underline disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {busy("reset_templates") ? "Resetting…" : "Confirm reset"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmReset(false)}
                  className="text-xs font-medium text-muted hover:text-text"
                >
                  Cancel
                </button>
              </Form>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmReset(true)}
                className="text-xs font-medium text-muted hover:text-hot"
              >
                Reset to defaults
              </button>
            )}
          </div>
        </div>
      ) : (
        <p className="mt-3 text-xs text-muted">Only an owner can edit templates.</p>
      )}
    </section>
  );
}

function TemplateForm({
  channel,
  returnTo,
  initial,
  vars,
  onCancel,
  busy,
}: {
  channel: Channel;
  returnTo: string;
  initial?: MessageTemplateRow;
  vars: TemplateVars;
  onCancel: () => void;
  busy: boolean;
}) {
  const [body, setBody] = useState(initial?.body ?? "");
  const [subject, setSubject] = useState(initial?.subject ?? "");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function insertToken(key: (typeof TEMPLATE_TOKEN_KEYS)[number]) {
    const token = `{${key}}`;
    const el = textareaRef.current;
    if (!el || typeof el.selectionStart !== "number") {
      setBody((prev) => (prev + token).slice(0, 2000));
      return;
    }
    const start = el.selectionStart;
    const end = typeof el.selectionEnd === "number" ? el.selectionEnd : start;
    const current = el.value;
    const next = (current.slice(0, start) + token + current.slice(end)).slice(0, 2000);
    setBody(next);
    const pos = Math.min(start + token.length, next.length);
    requestAnimationFrame(() => {
      const node = textareaRef.current;
      if (!node) return;
      node.focus();
      if (typeof node.setSelectionRange === "function") {
        node.setSelectionRange(pos, pos);
      }
    });
  }

  return (
    <Form method="post" action="/api/org-settings" className="flex flex-col gap-2">
      <input type="hidden" name="intent" value="save_template" />
      <input type="hidden" name="returnTo" value={returnTo} />
      <input type="hidden" name="channel" value={channel} />
      {initial ? <input type="hidden" name="slug" value={initial.slug} /> : null}
      {initial ? <input type="hidden" name="sort" value={initial.sort} /> : null}
      <label className="flex flex-col gap-1 text-xs font-medium text-text">
        Label
        <input
          name="label" type="text" required maxLength={80} defaultValue={initial?.label ?? ""}
          className="h-8 rounded-md border border-border bg-panel px-2 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
        />
      </label>
      {channel === "email" ? (
        <label className="flex flex-col gap-1 text-xs font-medium text-text">
          Subject
          <input
            name="subject" type="text" maxLength={200} value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="h-8 rounded-md border border-border bg-panel px-2 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
          />
        </label>
      ) : null}
      <div className="flex flex-wrap items-center gap-1.5">
        {TEMPLATE_TOKEN_KEYS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => insertToken(k)}
            aria-label={`Insert {${k}}`}
            className="rounded border border-border bg-panel px-1.5 py-0.5 font-mono text-[11px] text-text hover:border-copper hover:text-copper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
          >
            {`{${k}}`}
          </button>
        ))}
      </div>
      <label className="flex flex-col gap-1 text-xs font-medium text-text">
        Message
        <textarea
          ref={textareaRef}
          name="body" required rows={4} maxLength={2000} value={body}
          onChange={(e) => setBody(e.target.value)}
          className="rounded-md border border-border bg-panel px-2 py-1.5 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
        />
      </label>
      <UnknownTokenWarning body={body} subject={channel === "email" ? subject : null} />
      <TemplatePreview
        channel={channel}
        subject={channel === "email" ? subject : null}
        body={body}
        vars={vars}
      />
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-copper px-3 py-1.5 text-xs font-semibold text-ink hover:bg-copper/90 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {busy ? "Saving…" : initial ? "Save" : "Add"}
        </button>
        <button type="button" onClick={onCancel} className="text-xs font-medium text-muted hover:text-text">
          Cancel
        </button>
      </div>
    </Form>
  );
}

function TemplatePreview({
  channel,
  subject,
  body,
  vars,
}: {
  channel: Channel;
  subject: string | null | undefined;
  body: string;
  vars: TemplateVars;
}) {
  const previewBody = interpolate(channel, body, vars);
  const previewSubject = channel === "email" && subject
    ? interpolate(channel, subject, vars)
    : "";
  return (
    <div className="mt-2 rounded-md border border-dashed border-border bg-panel/60 px-3 py-2">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted">Preview</p>
      {previewSubject ? (
        <p className="mt-1 text-xs font-semibold text-text">{previewSubject}</p>
      ) : null}
      <pre className="mt-1 whitespace-pre-wrap font-sans text-xs text-text">{previewBody}</pre>
    </div>
  );
}

function UnknownTokenWarning({
  body,
  subject,
}: {
  body: string;
  subject: string | null | undefined;
}) {
  const unknown = unknownTokens(subject ? `${subject}\n${body}` : body);
  if (unknown.length === 0) return null;
  return (
    <p className="mt-1.5 text-xs text-hot" role="alert">
      Unknown tokens will be sent as written: {unknown.map((t) => `{${t}}`).join(", ")}
    </p>
  );
}
