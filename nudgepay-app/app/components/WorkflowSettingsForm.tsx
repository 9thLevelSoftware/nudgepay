// WorkflowSettingsForm — owner-only workflow knobs: how many days ahead an
// invoice counts as "coming due", how many business days ahead a pending
// promise counts as "due soon", and the max number of cases a single bulk
// action (assign / SMS) can touch. Server-side ranges match migration 0028's
// check constraints: coming_due_days 1-60, due_soon_business_days 1-30,
// sms_batch_limit 1-200.

import { Form, useNavigation, useSearchParams } from "react-router";

export function WorkflowSettingsForm({
  workflow,
  returnTo,
}: {
  workflow: { comingDueDays: number; dueSoonBusinessDays: number; smsBatchLimit: number };
  returnTo: string;
}) {
  const navigation = useNavigation();
  const busy =
    navigation.state !== "idle" &&
    navigation.formAction === "/api/org-settings" &&
    navigation.formData?.get("intent") === "save_workflow";
  const [sp] = useSearchParams();
  const error = sp.get("error");

  return (
    <section className="rounded-lg border border-border bg-surface p-5">
      <h2 className="font-display text-base font-semibold text-text">Workflow</h2>
      <p className="mt-1 text-xs text-muted">
        Lookahead windows for "coming due" and "due soon", and the max accounts a single bulk action can touch.
      </p>
      <Form method="post" action="/api/org-settings" className="mt-3 flex flex-col gap-3">
        <input type="hidden" name="intent" value="save_workflow" />
        <input type="hidden" name="returnTo" value={returnTo} />

        <div className="grid grid-cols-3 gap-3">
          <label className="grid gap-1 text-sm font-medium text-text">
            Coming-due window (days)
            <input
              type="number" name="coming_due_days" min={1} max={60} defaultValue={workflow.comingDueDays}
              className="h-8 rounded-md border border-border bg-panel px-2 text-sm text-text tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
            />
          </label>
          <label className="grid gap-1 text-sm font-medium text-text">
            Due-soon window (business days)
            <input
              type="number" name="due_soon_business_days" min={1} max={30} defaultValue={workflow.dueSoonBusinessDays}
              className="h-8 rounded-md border border-border bg-panel px-2 text-sm text-text tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
            />
          </label>
          <label className="grid gap-1 text-sm font-medium text-text">
            Bulk-action batch limit
            <input
              type="number" name="sms_batch_limit" min={1} max={200} defaultValue={workflow.smsBatchLimit}
              className="h-8 rounded-md border border-border bg-panel px-2 text-sm text-text tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
            />
          </label>
        </div>
        <p className="text-xs text-muted">
          Invoices due within {workflow.comingDueDays} days appear on the Coming due view. Promises due within {workflow.dueSoonBusinessDays} business days appear on the Due soon tab. Bulk assign / SMS act on at most {workflow.smsBatchLimit} accounts per batch.
        </p>

        <div className="flex items-center gap-3">
          <button
            type="submit" disabled={busy}
            className="rounded-md bg-copper px-3 py-1.5 text-xs font-semibold text-ink hover:bg-copper/90 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {busy ? "Saving…" : "Save"}
          </button>
          {sp.get("saved") === "1" && <span className="text-xs text-cool" role="status">Saved.</span>}
          {error === "coming_due_days" && <span className="text-xs text-hot" role="alert">Coming-due window must be a whole number of days between 1 and 60.</span>}
          {error === "due_soon_business_days" && <span className="text-xs text-hot" role="alert">Due-soon window must be a whole number of business days between 1 and 30.</span>}
          {error === "sms_batch_limit" && <span className="text-xs text-hot" role="alert">Bulk-action batch limit must be a whole number between 1 and 200.</span>}
        </div>
      </Form>
    </section>
  );
}
