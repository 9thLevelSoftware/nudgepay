// PriorityThresholdsForm — owner-only priority scoring configuration.
// Controls the "high value" balance boundary (12-point balance tier + the
// high-value view/metric) and the score cutoffs that map a case's score to a
// Critical/High/Medium/Low level. Server-side ordering matches migration
// 0027's check constraint: critical > high > medium > 0.

import { Form, useNavigation, useSearchParams } from "react-router";

export function PriorityThresholdsForm({
  priority,
  returnTo,
}: {
  priority: { highValue: number; criticalMin: number; highMin: number; mediumMin: number };
  returnTo: string;
}) {
  const navigation = useNavigation();
  const busy =
    navigation.state !== "idle" &&
    navigation.formAction === "/api/org-settings" &&
    navigation.formData?.get("intent") === "save_priority_thresholds";
  const [sp] = useSearchParams();
  const error = sp.get("error");

  return (
    <section className="rounded-lg border border-border bg-surface p-5">
      <h2 className="font-display text-base font-semibold text-text">Priority scoring</h2>
      <p className="mt-1 text-xs text-muted">
        What counts as "high value", and the score cutoffs behind each case's Critical/High/Medium/Low level.
      </p>
      <Form method="post" action="/api/org-settings" className="mt-3 flex flex-col gap-3">
        <input type="hidden" name="intent" value="save_priority_thresholds" />
        <input type="hidden" name="returnTo" value={returnTo} />

        <label className="grid max-w-xs gap-1 text-sm font-medium text-text">
          High-value threshold ($)
          <input
            type="number" name="high_value_threshold" min={0.01} step="0.01" defaultValue={priority.highValue}
            className="h-8 rounded-md border border-border bg-panel px-2 text-sm text-text tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
          />
        </label>

        <div className="grid grid-cols-3 gap-3">
          <label className="grid gap-1 text-sm font-medium text-text">
            Critical ≥
            <input
              type="number" name="priority_critical_min" min={1} defaultValue={priority.criticalMin}
              className="h-8 rounded-md border border-border bg-panel px-2 text-sm text-text tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
            />
          </label>
          <label className="grid gap-1 text-sm font-medium text-text">
            High ≥
            <input
              type="number" name="priority_high_min" min={1} defaultValue={priority.highMin}
              className="h-8 rounded-md border border-border bg-panel px-2 text-sm text-text tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
            />
          </label>
          <label className="grid gap-1 text-sm font-medium text-text">
            Medium ≥
            <input
              type="number" name="priority_medium_min" min={1} defaultValue={priority.mediumMin}
              className="h-8 rounded-md border border-border bg-panel px-2 text-sm text-text tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
            />
          </label>
        </div>
        <p className="text-xs text-muted">
          A case scores Critical at {priority.criticalMin}+, High at {priority.highMin}–{priority.criticalMin - 1}, Medium at {priority.mediumMin}–{priority.highMin - 1}, and Low below that. Each threshold must be greater than the next (critical &gt; high &gt; medium &gt; 0).
        </p>

        <div className="flex items-center gap-3">
          <button
            type="submit" disabled={busy}
            className="rounded-md bg-copper px-3 py-1.5 text-xs font-semibold text-ink hover:bg-copper/90 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {busy ? "Saving…" : "Save"}
          </button>
          {sp.get("saved") === "1" && <span className="text-xs text-cool" role="status">Saved.</span>}
          {error === "high_value_threshold" && <span className="text-xs text-hot" role="alert">High-value threshold must be greater than 0.</span>}
          {error === "priority_thresholds" && <span className="text-xs text-hot" role="alert">Enter whole numbers for each threshold.</span>}
          {error === "priority_thresholds_order" && <span className="text-xs text-hot" role="alert">Thresholds must be ordered: critical &gt; high &gt; medium &gt; 0.</span>}
        </div>
      </Form>
    </section>
  );
}
