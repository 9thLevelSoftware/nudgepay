import { useState } from "react";
import { Form, useNavigation } from "react-router";
import { MAX_BATCH } from "../lib/bulk";

// Roster prop kept minimal (no .server import in a client component).
type RosterOption = { userId: string; label: string };

export function BulkActionBar({
  selectedCaseIds,
  eligibleCount,
  roster,
  returnTo,
  onClear,
  onOpenSms,
}: {
  selectedCaseIds: string[];
  eligibleCount: number;
  roster: RosterOption[];
  returnTo: string;
  onClear: () => void;
  onOpenSms: () => void;
}) {
  const nav = useNavigation();
  const busy = nav.state !== "idle";
  const n = selectedCaseIds.length;
  const [ownerChoice, setOwnerChoice] = useState("");

  return (
    <div className="sticky bottom-0 z-30 flex flex-wrap items-center gap-3 border-t border-border bg-surface px-6 py-3 shadow-panel">
      <span className="font-sans text-sm text-text font-medium">
        {n} selected
        <span className="text-muted"> · {eligibleCount} can be texted</span>
        {n >= MAX_BATCH ? <span className="text-muted"> · max {MAX_BATCH} per batch</span> : null}
      </span>

      <Form method="post" action="/api/bulk-assign" className="flex items-center gap-2 ml-auto">
        <input type="hidden" name="caseIds" value={selectedCaseIds.join(",")} />
        <input type="hidden" name="returnTo" value={returnTo} />
        <label htmlFor="bulk-owner" className="sr-only">Assign owner</label>
        <select
          id="bulk-owner"
          name="ownerId"
          value={ownerChoice}
          onChange={(e) => setOwnerChoice(e.target.value)}
          className="rounded-md border border-border bg-panel px-2.5 h-9 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
        >
          <option value="" disabled>Change owner…</option>
          {roster.map((m) => <option key={m.userId} value={m.userId}>{m.label}</option>)}
          <option value="__unassign__">Unassign</option>
        </select>
        <button
          type="submit"
          disabled={busy || ownerChoice === ""}
          className="rounded-md border border-border bg-panel px-3 h-9 text-xs font-sans text-text hover:border-copper disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
        >
          Assign
        </button>
      </Form>

      <button
        type="button"
        onClick={onOpenSms}
        disabled={eligibleCount === 0}
        className="rounded-md bg-copper px-3 h-9 text-xs font-sans font-semibold text-ink hover:bg-copper/90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
      >
        Send SMS
      </button>
      <button
        type="button"
        onClick={onClear}
        className="rounded-md border border-border bg-panel px-3 h-9 text-xs font-sans text-muted hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
      >
        Clear
      </button>
    </div>
  );
}
