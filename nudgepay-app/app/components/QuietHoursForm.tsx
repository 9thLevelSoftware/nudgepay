// QuietHoursForm — owner-only SMS send window ("quiet hours", Phase 7).
// Two hour <select>s (start/end); server ranges mirror migration 0030's check
// constraints (start 0-23, end 1-24, start < end — same-day windows only).

import { Form, useNavigation, useSearchParams } from "react-router";
import { formatHourLabel } from "../lib/quiet-hours";

const START_HOUR_OPTIONS = Array.from({ length: 24 }, (_, h) => ({ value: h, label: formatHourLabel(h) }));
// End hour excludes 0 (must be > start, min possible start is 0) and includes
// 24 ("midnight" / end of day), matching the DB CHECK (between 1 and 24).
const END_HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => {
  const h = i + 1;
  return { value: h, label: h === 24 ? "12:00 AM" : formatHourLabel(h) };
});

export function QuietHoursForm({
  quietHours,
  returnTo,
}: {
  quietHours: { startHour: number; endHour: number };
  returnTo: string;
}) {
  const navigation = useNavigation();
  const busy =
    navigation.state !== "idle" &&
    navigation.formAction === "/api/org-settings" &&
    navigation.formData?.get("intent") === "save_quiet_hours";
  const [sp] = useSearchParams();
  const saved = sp.get("saved") === "quiet_hours";
  const error = sp.get("error");

  return (
    <section className="rounded-lg border border-border bg-surface p-5">
      <h2 className="font-display text-base font-semibold text-text">Quiet hours</h2>
      <p className="mt-1 text-xs text-muted">
        Texts are only sent between these hours, in your company's timezone. Attempts outside this window are blocked — this applies to every send path (single, bulk, and any future automation).
      </p>
      <Form method="post" action="/api/org-settings" className="mt-3 flex flex-col gap-3">
        <input type="hidden" name="intent" value="save_quiet_hours" />
        <input type="hidden" name="returnTo" value={returnTo} />

        <div className="grid grid-cols-2 gap-3">
          <label className="grid gap-1 text-sm font-medium text-text">
            Start
            <select
              name="sms_send_start_hour" defaultValue={quietHours.startHour}
              className="h-9 rounded-md border border-border bg-panel px-2 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
            >
              {START_HOUR_OPTIONS.map((h) => (
                <option key={h.value} value={h.value}>{h.label}</option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm font-medium text-text">
            End
            <select
              name="sms_send_end_hour" defaultValue={quietHours.endHour}
              className="h-9 rounded-md border border-border bg-panel px-2 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
            >
              {END_HOUR_OPTIONS.map((h) => (
                <option key={h.value} value={h.value}>{h.label}</option>
              ))}
            </select>
          </label>
        </div>
        {error === "quiet_hours" && (
          <p className="text-xs text-hot" role="alert">Start must be before end (same-day window only).</p>
        )}

        <div className="flex items-center gap-3">
          <button
            type="submit" disabled={busy}
            className="rounded-md bg-copper px-3 py-1.5 text-xs font-semibold text-ink hover:bg-copper/90 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {busy ? "Saving…" : "Save"}
          </button>
          {saved && <span className="text-xs text-cool" role="status">Saved.</span>}
        </div>
      </Form>
    </section>
  );
}
