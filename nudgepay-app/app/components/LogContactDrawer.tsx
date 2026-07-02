import { useRef, useState } from "react";
import { Link, useFetcher, useNavigate } from "react-router";
import type { CaseItem } from "../lib/cases";
import type { Collision } from "../lib/collision";
import { CONTACT_METHODS, CONTACT_OUTCOMES } from "../lib/contact-log";
import { PRIMARY_EXCEPTION_STATES, requiresReviewDate, isContactBlocked, type ExceptionState } from "../lib/exceptions";
import { EXCEPTION_REASON_LABEL, formatUSD } from "../lib/format";
import { NEXT_ACTION_LABEL as NEXT_STEP_LABEL } from "../lib/labels";
import { OUTCOME_LABELS } from "../lib/timeline";
import { useDialog } from "../lib/use-dialog";
import type { action } from "../routes/api.contact-logs";

const METHOD_LABEL: Record<string, string> = {
  call: "Call", text: "Text", note: "Note",
};
const ERROR_MESSAGE: Record<string, string> = {
  "bad-method": "Choose a contact method.",
  "bad-outcome": "Choose an outcome.",
  "promise-required": "Add a promised amount and date, or change the outcome.",
  "bad-amount": "Enter a valid promised amount greater than zero.",
  "bad-date": "Enter a valid date.",
  "missing-case": "That account could not be found.",
  "missing-invoice": "That invoice could not be found.",
  "save-failed": "Could not save the contact. Try again.",
  "bad-next-step": "Choose a next step.",
  "next-step-date": "Enter a valid date for the next step.",
  "bad-exception": "Choose an exception reason.",
};

export function LogContactDrawer({
  selected, repInvoiceId, returnTo, logError, collision, method,
}: {
  selected: CaseItem;
  repInvoiceId: string | null;
  returnTo: string;
  logError: string | null;
  collision: Collision | null;
  method?: string | null;
}) {
  const defaultMethod = method && (CONTACT_METHODS as readonly string[]).includes(method) ? method : "call";
  const [outcome, setOutcome] = useState<string>("");
  const [nextStep, setNextStep] = useState<string>("");
  const [exceptionReason, setExceptionReason] = useState<ExceptionState>("disputed");
  const [confirmSave, setConfirmSave] = useState(false);
  const needsConfirm = !!collision && collision.level !== "none";
  const firstFieldRef = useRef<HTMLSelectElement>(null);
  const navigate = useNavigate();
  const { panelRef } = useDialog({
    onClose: () => navigate(returnTo),
    initialFocusRef: firstFieldRef as React.RefObject<HTMLElement | null>,
  });
  const fetcher = useFetcher<typeof action>();
  const saving = fetcher.state !== "idle";
  const activeError = (fetcher.data && !fetcher.data.ok) ? fetcher.data.error : logError;

  const showPromise = nextStep === "promise";

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-label="Log a contact">
      {/* Scrim — clicking it (a Link) closes the drawer */}
      <Link to={returnTo} aria-hidden="true" tabIndex={-1} className="absolute inset-0 bg-ink/40 motion-safe:transition-opacity" />

      {/* Panel */}
      <div ref={panelRef} className="relative w-full max-w-md bg-surface border-l border-border h-full overflow-y-auto shadow-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="font-display text-lg font-semibold text-text">Log a contact</h2>
          <Link
            to={returnTo}
            aria-label="Close"
            className="text-muted hover:text-text rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper p-1"
          >
            <span aria-hidden="true" className="text-lg leading-none">×</span>
          </Link>
        </div>

        <p className="px-5 pt-3 text-sm text-muted font-sans">
          {selected.customerName}
          <span className="mx-1.5 text-border">·</span>
          {selected.invoiceCount} open invoice(s)
        </p>
        {(() => {
          const inv = repInvoiceId
            ? selected.invoices.find((i) => i.invoiceId === repInvoiceId)
            : null;
          return inv ? (
            <p className="px-5 pt-1 text-xs font-mono text-muted">
              {inv.docNumber ?? inv.invoiceId}
              <span className="mx-1 text-border">·</span>
              {formatUSD(inv.balance)}
            </p>
          ) : null;
        })()}

        {activeError && ERROR_MESSAGE[activeError] && (
          <p role="alert" className="mx-5 mt-3 rounded-md bg-hot/10 border border-hot/30 px-3 py-2 text-sm text-hot font-sans">
            {ERROR_MESSAGE[activeError]}
          </p>
        )}

        <fetcher.Form
          method="post"
          action="/api/contact-logs"
          className="flex flex-col gap-4 px-5 py-4"
          onSubmit={(e) => {
            if (needsConfirm && !confirmSave) {
              e.preventDefault();
              setConfirmSave(true);
            }
          }}
        >
          <input type="hidden" name="caseId" value={selected.caseId} />
          <input type="hidden" name="invoiceId" value={repInvoiceId ?? ""} />
          <input type="hidden" name="customerId" value={selected.customerId ?? ""} />
          <input type="hidden" name="returnTo" value={returnTo} />

          <label className="flex flex-col gap-1">
            <span className="text-xs font-sans font-medium uppercase tracking-wider text-muted">Method</span>
            <select
              ref={firstFieldRef}
              name="method"
              defaultValue={defaultMethod}
              className="rounded-md border border-border bg-panel px-3 py-2 text-sm font-sans text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
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
              className="rounded-md border border-border bg-panel px-3 py-2 text-sm font-sans text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
            >
              <option value="" disabled>Select outcome…</option>
              {CONTACT_OUTCOMES.map((o) => (
                <option key={o} value={o}>{OUTCOME_LABELS[o]}</option>
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
                  className="rounded-md border border-border bg-surface px-3 py-2 text-sm font-mono text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-sans font-medium uppercase tracking-wider text-muted">Promised by</span>
                <input
                  name="promisedDate"
                  type="date"
                  className="rounded-md border border-border bg-surface px-3 py-2 text-sm font-sans text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
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
              className="rounded-md border border-border bg-panel px-3 py-2 text-sm font-sans text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper resize-y"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-sans font-medium uppercase tracking-wider text-muted">Next step</span>
            <select
              name="nextStep"
              value={nextStep}
              onChange={(e) => setNextStep(e.target.value)}
              className="rounded-md border border-border bg-panel px-3 py-2 text-sm font-sans text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
            >
              <option value="" disabled>Select next step…</option>
              {["follow_up", "promise", "waiting", "exception"].map((s) => (
                <option key={s} value={s}>{NEXT_STEP_LABEL[s]}</option>
              ))}
            </select>
          </label>

          {nextStep === "follow_up" && (
            <label className="flex flex-col gap-1">
              <span className="text-xs font-sans font-medium uppercase tracking-wider text-muted">Follow up on</span>
              <input name="followUpAt" type="date" required defaultValue={selected.suggestedFollowUpAt}
                className="rounded-md border border-border bg-panel px-3 py-2 text-sm font-sans text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper" />
              <span className="text-xs font-sans text-muted">
                Suggested from {selected.effectiveLevel} priority · {selected.suggestedFollowUpIntervalDays}-day cadence
              </span>
            </label>
          )}

          {nextStep === "waiting" && (
            <label className="flex flex-col gap-1">
              <span className="text-xs font-sans font-medium uppercase tracking-wider text-muted">Revisit on</span>
              <input name="reviewAt" type="date" required
                className="rounded-md border border-border bg-panel px-3 py-2 text-sm font-sans text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper" />
            </label>
          )}

          {nextStep === "exception" && (
            <div className="grid gap-3 rounded-md bg-panel/60 border border-border p-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-sans font-medium uppercase tracking-wider text-muted">Reason</span>
                <select name="exceptionReason" value={exceptionReason}
                  onChange={(e) => setExceptionReason(e.target.value as ExceptionState)}
                  className="rounded-md border border-border bg-surface px-3 py-2 text-sm font-sans text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper">
                  {PRIMARY_EXCEPTION_STATES.map((r) => (
                    <option key={r} value={r}>{EXCEPTION_REASON_LABEL[r]}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-sans font-medium uppercase tracking-wider text-muted">Note (optional)</span>
                <input name="exceptionNote" type="text"
                  className="rounded-md border border-border bg-surface px-3 py-2 text-sm font-sans text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper" />
              </label>
              {requiresReviewDate(exceptionReason) ? (
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-sans font-medium uppercase tracking-wider text-muted">Revisit on</span>
                  <input name="reviewAt" type="date" required
                    className="rounded-md border border-border bg-surface px-3 py-2 text-sm font-sans text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper" />
                </label>
              ) : (
                <p className="text-xs font-sans text-amber-700">
                  Parks this case indefinitely{isContactBlocked(exceptionReason) ? " and blocks outbound messages" : ""}.
                </p>
              )}
            </div>
          )}

          {confirmSave ? (
            <p className="text-xs font-sans text-amber-700" role="alert">
              {collision?.level === "live"
                ? `${collision.byUser} is viewing this customer now. Log anyway?`
                : `${collision?.byUser} contacted this customer recently. Log anyway?`}
            </p>
          ) : null}

          <div className="flex items-center justify-end gap-2 pt-2">
            <Link
              to={returnTo}
              className="rounded-md border border-border bg-panel px-4 py-2 text-sm font-sans text-muted hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-copper px-4 py-2 text-sm font-sans font-semibold text-surface hover:bg-copper/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper focus-visible:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {saving ? "Saving…" : "Save contact"}
            </button>
          </div>
        </fetcher.Form>
      </div>
    </div>
  );
}
