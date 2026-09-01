import { useEffect, useState } from "react";
import { Form, useNavigation } from "react-router";
import type { MessageTemplateRow } from "../lib/message-templates";
import { partitionEligibility, renderCaseBody, clampBatch, skippedSummary, type TextableCase, type RenderableCase } from "../lib/bulk";
import { plural } from "../lib/labels";
import { DrawerShell } from "./DrawerShell";
import { Button, Select, Textarea } from "./ui";

export type DrawerCase = TextableCase & RenderableCase;

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
    <DrawerShell label="Send batch SMS" onClose={onClose}>
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-display text-lg font-semibold text-text">
            Send SMS to {plural(eligible.length, "customer")}
          </h2>
          <button type="button" onClick={onClose} className="inline-flex items-center min-h-6 text-xs text-muted hover:text-text rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper">
            Close
          </button>
        </div>
        <p className="text-xs font-sans text-muted">
          {eligible.length} of {cappedCases.length} eligible
          {skipped.length ? ` · ${skipped.length} skipped (${skippedSummary(skipped)})` : ""}
        </p>
        {!smsEnabled ? (
          <p className="text-xs font-sans font-medium text-hot">Text messaging is turned off for this workspace.</p>
        ) : smsQuietNow ? (
          <p className="text-xs font-sans font-medium text-warm" role="status">
            Outside quiet hours ({quietHoursLabel}) — sends will be blocked until the window reopens.
          </p>
        ) : null}

        {!confirming ? (
          <>
            <label htmlFor="bulk-template" className="block text-xs font-sans text-muted">Template</label>
            <Select
              id="bulk-template"
              value={templateId}
              onChange={(e) => pickTemplate(e.target.value)}
              className="w-full h-9 bg-panel px-2.5"
            >
              {smsTemplates.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </Select>
            <label htmlFor="bulk-body" className="block text-xs font-sans text-muted">Message</label>
            <Textarea
              id="bulk-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
              className="w-full bg-panel px-2.5"
            />
            {sample ? (
              <p className="text-xs font-sans text-muted">
                <span className="font-medium text-text">Preview:</span> {sample}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" size="sm" className="bg-panel" onClick={onClose}>
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => setConfirming(true)}
                disabled={!smsEnabled || eligible.length === 0 || body.trim() === ""}
              >
                Review
              </Button>
            </div>
          </>
        ) : (
          <Form method="post" action="/api/bulk-sms" aria-describedby="bulk-sms-confirm-desc" className="flex flex-col gap-4">
            <input type="hidden" name="caseIds" value={cappedCases.map((c) => c.caseId).join(",")} />
            <input type="hidden" name="body" value={body} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <p id="bulk-sms-confirm-desc" className="text-sm font-sans text-text">
              Send this message to {plural(eligible.length, "customer")}? This cannot be undone. Eligibility is re-checked when you send, so the final count may be lower.
            </p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" size="sm" className="bg-panel" onClick={() => setConfirming(false)}>
                Back
              </Button>
              <Button type="submit" size="sm" disabled={busy || !smsEnabled}>
                {busy ? "Sending…" : `Send ${eligible.length}`}
              </Button>
            </div>
          </Form>
        )}
    </DrawerShell>
  );
}
