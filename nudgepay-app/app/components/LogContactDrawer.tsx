import { useEffect, useRef, useState } from "react";
import { Form, Link } from "react-router";
import type { WorkItem } from "../lib/worklist";
import { CONTACT_METHODS, CONTACT_OUTCOMES } from "../lib/contact-log";
import { Icon } from "./Icons";

const METHOD_LABEL: Record<string, string> = {
  call: "Call", email: "Email", text: "Text", note: "Note",
};
const OUTCOME_LABEL: Record<string, string> = {
  "promise-to-pay": "Promise to pay",
  dispute: "Dispute",
  "no-commitment": "No commitment",
  "left-voicemail": "Left voicemail",
  "no-answer": "No answer",
  other: "Other",
};
const ERROR_MESSAGE: Record<string, string> = {
  "promise-required": "Add a promised amount and date, or change the outcome.",
  "bad-amount": "Enter a valid promised amount greater than zero.",
  "bad-date": "Enter a valid date.",
  "missing-invoice": "That invoice could not be found.",
  "save-failed": "Could not save the contact. Try again.",
};

export function LogContactDrawer({
  selected, returnTo, logError,
}: {
  selected: WorkItem;
  returnTo: string;
  logError: string | null;
}) {
  const [outcome, setOutcome] = useState<string>("no-answer");
  const firstFieldRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    firstFieldRef.current?.focus();
  }, []);

  const showPromise = outcome === "promise-to-pay";

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-label="Log a contact">
      {/* Scrim — clicking it (a Link) closes the drawer */}
      <Link to={returnTo} aria-label="Close" className="absolute inset-0 bg-ink/40 motion-safe:transition-opacity" />

      {/* Panel */}
      <div className="relative w-full max-w-md bg-surface border-l border-border h-full overflow-y-auto shadow-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="font-display text-lg font-semibold text-text">Log a contact</h2>
          <Link
            to={returnTo}
            aria-label="Close"
            className="text-muted hover:text-text rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-copper p-1"
          >
            <Icon name="chevronRight" size={18} aria-hidden />
          </Link>
        </div>

        <p className="px-5 pt-3 text-sm text-muted font-sans">
          {selected.customerName}
          <span className="mx-1.5 text-border">·</span>
          {selected.docNumber ?? selected.invoiceId}
        </p>

        {logError && ERROR_MESSAGE[logError] && (
          <p role="alert" className="mx-5 mt-3 rounded-md bg-hot/10 border border-hot/30 px-3 py-2 text-sm text-hot font-sans">
            {ERROR_MESSAGE[logError]}
          </p>
        )}

        <Form method="post" action="/api/contact-logs" className="flex flex-col gap-4 px-5 py-4">
          <input type="hidden" name="invoiceId" value={selected.invoiceId} />
          <input type="hidden" name="customerId" value={selected.customerId ?? ""} />
          <input type="hidden" name="returnTo" value={returnTo} />

          <label className="flex flex-col gap-1">
            <span className="text-xs font-sans font-medium uppercase tracking-wider text-muted">Method</span>
            <select
              ref={firstFieldRef}
              name="method"
              defaultValue="call"
              className="rounded-md border border-border bg-panel px-3 py-2 text-sm font-sans text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-copper"
            >
              {CONTACT_METHODS.map((m) => (
                <option key={m} value={m}>{METHOD_LABEL[m]}</option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-sans font-medium uppercase tracking-wider text-muted">Outcome</span>
            <select
              name="outcome"
              value={outcome}
              onChange={(e) => setOutcome(e.target.value)}
              className="rounded-md border border-border bg-panel px-3 py-2 text-sm font-sans text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-copper"
            >
              {CONTACT_OUTCOMES.map((o) => (
                <option key={o} value={o}>{OUTCOME_LABEL[o]}</option>
              ))}
            </select>
          </label>

          {showPromise && (
            <div className="grid grid-cols-2 gap-3 rounded-md bg-panel/60 border border-border p-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-sans font-medium uppercase tracking-wider text-muted">Promised amount</span>
                <input
                  name="promisedAmount"
                  type="number"
                  min="0.01"
                  step="0.01"
                  inputMode="decimal"
                  placeholder="0.00"
                  className="rounded-md border border-border bg-surface px-3 py-2 text-sm font-mono text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-copper"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-sans font-medium uppercase tracking-wider text-muted">Promised by</span>
                <input
                  name="promisedDate"
                  type="date"
                  className="rounded-md border border-border bg-surface px-3 py-2 text-sm font-sans text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-copper"
                />
              </label>
            </div>
          )}

          <label className="flex flex-col gap-1">
            <span className="text-xs font-sans font-medium uppercase tracking-wider text-muted">Notes</span>
            <textarea
              name="notes"
              rows={3}
              placeholder="Who you spoke with, what they said…"
              className="rounded-md border border-border bg-panel px-3 py-2 text-sm font-sans text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-copper resize-y"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-sans font-medium uppercase tracking-wider text-muted">Follow up (optional)</span>
            <input
              name="followUpAt"
              type="date"
              className="rounded-md border border-border bg-panel px-3 py-2 text-sm font-sans text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-copper"
            />
          </label>

          <div className="flex items-center justify-end gap-2 pt-2">
            <Link
              to={returnTo}
              className="rounded-md border border-border bg-panel px-4 py-2 text-sm font-sans text-muted hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-copper"
            >
              Cancel
            </Link>
            <button
              type="submit"
              className="rounded-md bg-copper px-4 py-2 text-sm font-sans font-semibold text-ink hover:bg-copper/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-copper focus-visible:ring-offset-2"
            >
              Save contact
            </button>
          </div>
        </Form>
      </div>
    </div>
  );
}
