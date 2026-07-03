// LateFeesForm — owner-only late-fee display settings.
// Late fees are shown in NudgePay for awareness; never added to QBO invoices.

import { Form, useNavigation, useSearchParams } from "react-router";

export function LateFeesForm({
  lateFee,
  returnTo,
}: {
  lateFee: { enabled: boolean; graceDays: number; monthlyPercent: number; flatAmount: number };
  returnTo: string;
}) {
  const navigation = useNavigation();
  const busy =
    navigation.state !== "idle" &&
    navigation.formAction === "/api/org-settings" &&
    navigation.formData?.get("intent") === "save_late_fees";
  const [sp] = useSearchParams();

  return (
    <section className="rounded-lg border border-border bg-surface p-5">
      <h2 className="font-display text-base font-semibold text-text">Late fees (display only)</h2>
      <p className="mt-1 text-xs text-muted">Shown in NudgePay for awareness only — never added to QuickBooks invoices.</p>
      <Form method="post" action="/api/org-settings" className="mt-3 flex flex-col gap-3">
        <input type="hidden" name="intent" value="save_late_fees" />
        <input type="hidden" name="returnTo" value={returnTo} />
        <label className="flex items-center gap-2 text-sm font-medium text-text">
          <select
            name="late_fee_enabled"
            defaultValue={lateFee.enabled ? "true" : "false"}
            className="h-8 rounded-md border border-border bg-panel px-2 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
          >
            <option value="true">Enabled</option>
            <option value="false">Disabled</option>
          </select>
        </label>
        <div className="grid grid-cols-3 gap-3">
          <label className="grid gap-1 text-sm font-medium text-text">
            Grace days
            <input
              type="number" name="late_fee_grace_days" min={0} defaultValue={lateFee.graceDays}
              className="h-8 rounded-md border border-border bg-panel px-2 text-sm text-text tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
            />
          </label>
          <label className="grid gap-1 text-sm font-medium text-text">
            Monthly %
            <input
              type="number" name="late_fee_monthly_percent" min={0} max={100} step="0.01" defaultValue={lateFee.monthlyPercent}
              className="h-8 rounded-md border border-border bg-panel px-2 text-sm text-text tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
            />
          </label>
          <label className="grid gap-1 text-sm font-medium text-text">
            Flat fee ($)
            <input
              type="number" name="late_fee_flat_amount" min={0} step="0.01" defaultValue={lateFee.flatAmount}
              className="h-8 rounded-md border border-border bg-panel px-2 text-sm text-text tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
            />
          </label>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="submit" disabled={busy}
            className="rounded-md bg-copper px-3 py-1.5 text-xs font-semibold text-ink hover:bg-copper/90 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {busy ? "Saving…" : "Save"}
          </button>
          {sp.get("saved") === "1" && <span className="text-xs text-cool" role="status">Saved.</span>}
        </div>
      </Form>
    </section>
  );
}
