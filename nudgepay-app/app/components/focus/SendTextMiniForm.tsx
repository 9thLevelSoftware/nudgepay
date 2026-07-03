// Focus Mode — compact send-text mini-form. Opens inline below the FocusCard
// when the user presses "2". Gate banner via smsGateFor, template chips, editable
// textarea, POST /api/text/send with respond=json.

import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import type { CaseItem } from "../../lib/cases";
import { smsGateFor } from "../../lib/sms-gate";
import { SMS_TEMPLATES, applyTemplate, type TemplateVars } from "../../lib/sms-templates";
import { formatUSD } from "../../lib/format";
import { formatDate } from "../../lib/dates";

interface SendTextMiniFormProps {
  item: CaseItem;
  smsEnabled: boolean;
  onDone: () => void;
  onCancel: () => void;
  /** Called when the send fails — parent shows a toast with the error code. */
  onError: (code: string) => void;
}

export function SendTextMiniForm({ item, smsEnabled, onDone, onCancel, onError }: SendTextMiniFormProps) {
  const firstInvoice = item.invoices[0] ?? null;

  const gate = smsGateFor({
    smsEnabled,
    contactBlocked: item.contactBlocked,
    exceptionReason: item.exceptionReason,
    doNotText: item.doNotText,
    hasInvoice: firstInvoice !== null,
    consent: item.smsConsent,
    phone: item.phone,
  });

  const vars: TemplateVars = {
    customer: item.customerName,
    invoice: firstInvoice?.docNumber ?? item.customerName,
    balance: formatUSD(item.totalOverdue),
    dueDate: formatDate(firstInvoice?.dueDate ?? null),
  };

  const [body, setBody] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fetcher = useFetcher();

  // Autofocus the textarea on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Track which fetcher response we've already handled — prevents re-fire
  // if callbacks change identity on parent re-render before unmount.
  const handledRef = useRef<unknown>(null);

  // Handle fetcher response
  useEffect(() => {
    if (
      fetcher.data &&
      fetcher.data !== handledRef.current &&
      typeof fetcher.data === "object" &&
      "ok" in fetcher.data
    ) {
      handledRef.current = fetcher.data;
      if ((fetcher.data as { ok: boolean }).ok) {
        onDone();
      } else {
        const code = (fetcher.data as { sms?: string }).sms ?? "error";
        onError(code);
      }
    }
  }, [fetcher.data, onDone, onError]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onCancel]);

  const sending = fetcher.state !== "idle";
  const isHardGate = gate?.severity === "hard";
  // Block the form for ALL gates — soft gates (no invoice, no consent) will
  // also fail server-side, and Focus Mode has no UI to resolve them inline.
  const gated = gate !== null;

  return (
    <div className="mx-auto w-full max-w-2xl mt-3 rounded-lg border border-white/10 bg-white/5 p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-sans font-semibold text-surface">Send a text</p>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs text-muted hover:text-surface"
        >
          Cancel <kbd className="ml-1 rounded border border-white/10 bg-white/5 px-1 py-0.5 font-mono text-[9px]">esc</kbd>
        </button>
      </div>

      {/* Gate banner */}
      {gate && (
        <div className={[
          "rounded-lg border px-3 py-2 text-xs mb-3",
          isHardGate
            ? "border-hot/30 bg-hot/5 text-hot"
            : "border-warm/30 bg-warm/5 text-warm",
        ].join(" ")}>
          {gate.reason}
        </div>
      )}

      {/* Any gate blocks the form — soft gates can't be resolved in Focus Mode */}
      {gated ? (
        <p className="text-xs text-muted">
          Texting is not available for this customer. Press <kbd className="rounded border border-white/10 bg-white/5 px-1 py-0.5 font-mono text-[9px]">esc</kbd> to go back.
        </p>
      ) : (
        <>
          {/* Template chips */}
          <div className="flex flex-wrap gap-2 mb-3">
            {SMS_TEMPLATES.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setBody(applyTemplate(t.body, vars))}
                className={[
                  "rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors",
                  body === applyTemplate(t.body, vars)
                    ? "border-copper bg-copper/15 text-copper"
                    : "border-white/10 bg-white/5 text-muted hover:text-surface",
                ].join(" ")}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Textarea */}
          <textarea
            ref={textareaRef}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Type a message…"
            rows={3}
            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-surface placeholder:text-muted/50 focus:outline-none focus:ring-1 focus:ring-copper resize-none"
          />

          {/* Send */}
          <div className="mt-3 flex items-center justify-between">
            <p className="text-[10px] text-muted/60">
              To: {item.phone ?? "—"}
            </p>
            <fetcher.Form method="post" action="/api/text/send">
              <input type="hidden" name="invoiceId" value={firstInvoice?.invoiceId ?? ""} />
              <input type="hidden" name="body" value={body} />
              <input type="hidden" name="respond" value="json" />
              <button
                type="submit"
                disabled={sending || !body.trim()}
                className="rounded-lg bg-copper px-4 py-1.5 text-sm font-semibold text-surface hover:bg-copper/90 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {sending ? "Sending…" : "Send text"}
              </button>
            </fetcher.Form>
          </div>
        </>
      )}
    </div>
  );
}
