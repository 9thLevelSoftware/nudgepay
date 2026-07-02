import { Form } from "react-router";

const WEEKDAYS: Array<{ value: number; label: string }> = [
  { value: 0, label: "Sun" }, { value: 1, label: "Mon" }, { value: 2, label: "Tue" },
  { value: 3, label: "Wed" }, { value: 4, label: "Thu" }, { value: 5, label: "Fri" }, { value: 6, label: "Sat" },
];

export function CollectionsRulesForm({
  grace, workingDays, cadence, holidays, isOwner,
}: {
  grace: number;
  workingDays: number[];
  cadence: { Critical: number; High: number; Medium: number; Low: number };
  holidays: string[];
  isOwner: boolean;
}) {
  const days = new Set(workingDays);
  const ro = !isOwner;
  return (
    <section className="rounded-lg border border-border bg-surface p-5">
      <h2 className="font-display text-base font-semibold text-text">Collections rules</h2>
      <p className="mt-0.5 mb-4 text-xs text-muted">
        How NudgePay schedules grace periods and follow-ups. {ro ? "Only an owner can change these." : ""}
      </p>

      <Form method="post" action="/api/org-settings" className="flex flex-col gap-4">
        <input type="hidden" name="intent" value="save_rules" />
        <input type="hidden" name="returnTo" value="/settings" />

        <label className="flex flex-col gap-1 max-w-xs">
          <span className="text-xs font-medium uppercase tracking-wider text-muted">Promise grace (business days)</span>
          <input type="number" name="promise_grace_days" min={0} defaultValue={grace} disabled={ro}
            className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-text disabled:opacity-60" />
        </label>

        <fieldset className="flex flex-col gap-1.5">
          <legend className="text-xs font-medium uppercase tracking-wider text-muted">Working days</legend>
          <div className="flex flex-wrap gap-3">
            {WEEKDAYS.map((d) => (
              <label key={d.value} className="flex items-center gap-1.5 text-sm text-text">
                <input type="checkbox" name="working_days" value={d.value} defaultChecked={days.has(d.value)} disabled={ro}
                  className="h-4 w-4 rounded border-border text-copper disabled:opacity-60" />
                {d.label}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-1.5">
          <legend className="text-xs font-medium uppercase tracking-wider text-muted">Follow-up cadence (days)</legend>
          <div className="flex flex-wrap gap-3">
            {([["cadence_critical", "Critical", cadence.Critical], ["cadence_high", "High", cadence.High],
              ["cadence_medium", "Medium", cadence.Medium], ["cadence_low", "Low", cadence.Low]] as const).map(([name, label, val]) => (
              <label key={name} className="flex flex-col gap-1 w-20">
                <span className="text-[11px] text-muted">{label}</span>
                <input type="number" name={name} min={1} defaultValue={val} disabled={ro}
                  className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-text disabled:opacity-60" />
              </label>
            ))}
          </div>
        </fieldset>

        {isOwner ? (
          <div>
            <button type="submit" className="rounded-md bg-copper px-3 py-1.5 text-xs font-semibold text-ink hover:bg-copper/90">
              Save rules
            </button>
          </div>
        ) : null}
      </Form>

      <div className="mt-5">
        <h3 className="text-xs font-medium uppercase tracking-wider text-muted">Holidays</h3>
        <ul className="mt-2 flex flex-col gap-1" role="list">
          {holidays.length === 0 ? <li className="text-sm text-muted">No holidays configured.</li> : null}
          {holidays.map((h) => (
            <li key={h} className="flex items-center gap-3 text-sm text-text">
              <span className="tabular-nums">{h}</span>
              {isOwner ? (
                <Form method="post" action="/api/org-settings">
                  <input type="hidden" name="intent" value="remove_holiday" />
                  <input type="hidden" name="holiday_date" value={h} />
                  <input type="hidden" name="returnTo" value="/settings" />
                  <button type="submit" className="text-xs text-hot hover:underline">Remove</button>
                </Form>
              ) : null}
            </li>
          ))}
        </ul>
        {isOwner ? (
          <Form method="post" action="/api/org-settings" className="mt-2 flex items-center gap-2">
            <input type="hidden" name="intent" value="add_holiday" />
            <input type="hidden" name="returnTo" value="/settings" />
            <label className="sr-only" htmlFor="holiday-date-input">Holiday date</label>
            <input id="holiday-date-input" type="date" name="holiday_date" required
              className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper" />
            <button type="submit" className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text hover:border-copper">
              Add holiday
            </button>
          </Form>
        ) : null}
      </div>
    </section>
  );
}
