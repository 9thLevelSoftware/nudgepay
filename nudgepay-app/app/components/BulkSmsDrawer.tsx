import { useEffect, useState } from "react";
import { Form, useNavigation } from "react-router";
import type { MessageTemplateRow } from "../lib/message-templates";
import { partitionEligibility, renderCaseBody, clampBatch, type SkipReason, type TextableCase, type RenderableCase } from "../lib/bulk";
import { plural } from "../lib/labels";
import { useDialog } from "../lib/use-dialog";

export type DrawerCase = TextableCase & RenderableCase;

function skippedSummary(skipped: { reason: SkipReason }[]): string {
  const noPhone = skipped.filter((s) => s.reason === "no-phone").length;
  const noConsent = skipped.filter((s) => s.reason === "no-consent").length;
  const blocked = skipped.filter((s) => s.reason === "do-not-contact").length;
  const parts: string[] = [];
  if (noPhone) parts.push(`${noPhone} no phone`);
  if (noConsent) parts.push(`${noConsent} no consent`);
  if (blocked) parts.push(`${blocked} do-not-contact`);
  return parts.join(", ");
}

export function BulkSmsDrawer({
  open,
  onClose,
  cases,
  returnTo,
  smsEnabled,
  smsQuietNow,
  quietHoursLabel,
  smsTemplates,
  orgCompany,
  orgPhone,
  orgPaymentLink,
  maxBatch,
}: {
  open: boolean;
  onClose: () => void;
  cases: DrawerCase[];
  returnTo: string;
  smsEnabled: boolean;
  smsQuietNow: boolean;
  quietHoursLabel: string;
  smsTemplates: MessageTemplateRow[];
  orgCompany: string;
  orgPhone: string;
  orgPaymentLink: string;
  /** Org-configured max cases per bulk action — must match the server clamp. */
  maxBatch: number;
}) {
  const nav = useNavigation();
  const busy = nav.state !== "idle";
  const [templateId, setTemplateId] = useState(smsTemplates[0]?.id ?? "");
  const [body, setBody] = useState(smsTemplates[0]?.body ?? "");
  const [confirming, setConfirming] = useState(false);
  const { panelRef } = useDialog({ onClose, enabled: open });

  useEffect(() => {
    if (!open) {
      setConfirming(false);
      const defaultTemplate = smsTemplates[0];
      setTemplateId(defaultTemplate?.id ?? "");
      setBody(defaultTemplate?.body ?? "");
    }
  }, [open, smsTemplates]);

  if (!open) return null;
  // Defensive — selection is already capped upstream (WorkQueue), but this
  // keeps the drawer correct on its own if ever opened with a larger set.
  const cappedCases = clampBatch(cases, maxBatch);
  const { eligible, skipped } = partitionEligibility(cappedCases);
  const orgVars = { company: orgCompany, phone: orgPhone, paymentLink: orgPaymentLink };
  const sample = eligible[0] ? renderCaseBody(body, eligible[0], orgVars) : "";

  function pickTemplate(id: string) {
    setTemplateId(id);
    const t = smsTemplates.find((x) => x.id === id);
    if (t) setBody(t.body);
  }

  return (
    <div
      role="dialog"
      aria-label="Send batch SMS"
      aria-modal="true"
      className="fixed inset-0 z-40 flex items-end sm:items-center justify-center bg-ink/40 p-4"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        className="w-full max-w-lg rounded-lg border border-border bg-surface p-4 shadow-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-display text-lg font-semibold text-text mb-1">
          Send SMS to {plural(eligible.length, "customer")}
        </h2>
        <p className="text-xs font-sans text-muted mb-3">
          {eligible.length} of {cappedCases.length} eligible
          {skipped.length ? ` · ${skipped.length} skipped (${skippedSummary(skipped)})` : ""}
        </p>
        {!smsEnabled ? (
          <p className="text-xs font-sans font-medium text-hot mb-3">Text messaging is turned off for this workspace.</p>
        ) : smsQuietNow ? (
          <p className="text-xs font-sans font-medium text-warm mb-3" role="status">
            Outside quiet hours ({quietHoursLabel}) — sends will be blocked until the window reopens.
          </p>
        ) : null}

        {!confirming ? (
          <>
            <label htmlFor="bulk-template" className="block text-xs font-sans text-muted mb-1">Template</label>
            <select
              id="bulk-template"
              value={templateId}
              onChange={(e) => pickTemplate(e.target.value)}
              className="w-full rounded-md border border-border bg-panel px-2.5 h-9 text-sm text-text mb-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
            >
              {smsTemplates.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
            <label htmlFor="bulk-body" className="block text-xs font-sans text-muted mb-1">Message</label>
            <textarea
              id="bulk-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
              className="w-full rounded-md border border-border bg-panel px-2.5 py-2 text-sm text-text mb-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
            />
            {sample ? (
              <p className="text-xs font-sans text-muted mb-3">
                <span className="font-medium text-text">Preview:</span> {sample}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className="rounded-md border border-border bg-panel px-3 h-9 text-xs text-muted hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper">
                Cancel
              </button>
              <button
                type="button"
                onClick={() => setConfirming(true)}
                disabled={!smsEnabled || eligible.length === 0 || body.trim() === ""}
                className="rounded-md bg-copper px-3 h-9 text-xs font-semibold text-ink hover:bg-copper/90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
              >
                Review
              </button>
            </div>
          </>
        ) : (
          <Form method="post" action="/api/bulk-sms" aria-describedby="bulk-sms-confirm-desc">
            <input type="hidden" name="caseIds" value={cappedCases.map((c) => c.caseId).join(",")} />
            <input type="hidden" name="body" value={body} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <p id="bulk-sms-confirm-desc" className="text-sm font-sans text-text mb-3">
              Send this message to {plural(eligible.length, "customer")}? This cannot be undone. Eligibility is re-checked when you send, so the final count may be lower.
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setConfirming(false)} className="rounded-md border border-border bg-panel px-3 h-9 text-xs text-muted hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper">
                Back
              </button>
              <button
                type="submit"
                disabled={busy || !smsEnabled}
                className="rounded-md bg-copper px-3 h-9 text-xs font-semibold text-ink hover:bg-copper/90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
              >
                {busy ? "Sending…" : `Send ${eligible.length}`}
              </button>
            </div>
          </Form>
        )}
      </div>
    </div>
  );
}
