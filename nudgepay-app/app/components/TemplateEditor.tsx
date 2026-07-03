// TemplateEditor — settings templates tab. Owner-only CRUD over org message
// templates (SMS + email), with a channel toggle, token legend, inline edit,
// an add-template form, and a reset-to-defaults action per channel.

import { useEffect, useState } from "react";
import { Form, useNavigation, useSearchParams } from "react-router";
import type { MessageTemplateRow } from "../lib/message-templates";
import { TEMPLATE_TOKEN_KEYS } from "../lib/sms-templates";

type Channel = "sms" | "email";

export function TemplateEditor({
  smsTemplates,
  emailTemplates,
  isOwner,
  returnTo,
}: {
  smsTemplates: MessageTemplateRow[];
  emailTemplates: MessageTemplateRow[];
  isOwner: boolean;
  returnTo: string;
  orgId: string;
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
        <span className="text-xs text-muted">Unset tokens render blank.</span>
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
  onCancel,
  busy,
}: {
  channel: Channel;
  returnTo: string;
  initial?: MessageTemplateRow;
  onCancel: () => void;
  busy: boolean;
}) {
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
            name="subject" type="text" maxLength={200} defaultValue={initial?.subject ?? ""}
            className="h-8 rounded-md border border-border bg-panel px-2 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
          />
        </label>
      ) : null}
      <label className="flex flex-col gap-1 text-xs font-medium text-text">
        Message
        <textarea
          name="body" required rows={4} maxLength={2000} defaultValue={initial?.body ?? ""}
          className="rounded-md border border-border bg-panel px-2 py-1.5 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
        />
      </label>
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
