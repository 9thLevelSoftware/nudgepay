// Focus Mode — compact log-call mini-form. Opens inline below the FocusCard
// when the user presses "1". Outcomes: Reached (no-commitment), No answer
// (no-answer), Left voicemail (left-voicemail). Optional notes. Submits via
// useFetcher → POST /api/contact-logs with respond=json.

import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import type { CaseItem } from "../../lib/cases";
import type { Collision } from "../../lib/collision";
import { formatDate } from "../../lib/dates";
import { useCollisionRecheck } from "../../lib/use-collision-recheck";
import type { action } from "../../routes/api.contact-logs";

const OUTCOMES: { label: string; value: string }[] = [
  { label: "Reached", value: "no-commitment" },
  { label: "No answer", value: "no-answer" },
  { label: "Left voicemail", value: "left-voicemail" },
];

interface LogCallMiniFormProps {
  item: CaseItem;
  collision: Collision | null;
  onDone: () => void;
  onCancel: () => void;
}

export function LogCallMiniForm({ item, collision, onDone, onCancel }: LogCallMiniFormProps) {
  const fetcher = useFetcher<typeof action>();
  const [outcome, setOutcome] = useState(OUTCOMES[0].value);
  const [notes, setNotes] = useState("");
  const { collision: liveCollision, showConfirm, checking, guardSubmit } = useCollisionRecheck(
    item.caseId, collision,
  );
  const formRef = useRef<HTMLFormElement>(null);

  // Track which fetcher response we've already handled — prevents re-fire
  // when React re-renders before the parent unmounts this component.
  const handledRef = useRef<unknown>(null);

  // Advance on success
  useEffect(() => {
    if (
      fetcher.data &&
      fetcher.data !== handledRef.current &&
      typeof fetcher.data === "object" &&
      "ok" in fetcher.data &&
      fetcher.data.ok
    ) {
      handledRef.current = fetcher.data;
      onDone();
    }
  }, [fetcher.data, onDone]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onCancel]);

  const saving = fetcher.state !== "idle";
  const error =
    fetcher.data && typeof fetcher.data === "object" && "ok" in fetcher.data && !fetcher.data.ok
      ? (fetcher.data as { ok: false; error: string }).error
      : null;

  return (
    <div className="mx-auto w-full max-w-2xl mt-3 rounded-lg border border-white/10 bg-white/5 p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-sans font-semibold text-surface">Log a call</p>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs text-on-ink hover:text-surface"
        >
          Cancel <kbd className="ml-1 rounded border border-white/10 bg-white/5 px-1 py-0.5 font-mono text-[9px]">esc</kbd>
        </button>
      </div>

      <fetcher.Form
        ref={formRef}
        method="post"
        action="/api/contact-logs"
        onSubmit={guardSubmit}
      >
        {/* Hidden fields */}
        <input type="hidden" name="caseId" value={item.caseId} />
        <input type="hidden" name="customerId" value={item.customerId} />
        <input type="hidden" name="method" value="call" />
        <input type="hidden" name="nextStep" value="follow_up" />
        <input type="hidden" name="followUpAt" value={item.suggestedFollowUpAt} />
        <input type="hidden" name="respond" value="json" />

        {/* Outcome chips */}
        <div className="flex flex-wrap gap-2 mb-3">
          {OUTCOMES.map((o) => (
            <label
              key={o.value}
              className={[
                "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold cursor-pointer transition-colors",
                outcome === o.value
                  ? "border-copper bg-copper/15 text-copper"
                  : "border-white/10 bg-white/5 text-on-ink hover:text-surface",
              ].join(" ")}
            >
              <input
                type="radio"
                name="outcome"
                value={o.value}
                checked={outcome === o.value}
                onChange={() => setOutcome(o.value)}
                className="sr-only"
              />
              {o.label}
            </label>
          ))}
        </div>

        {/* Notes */}
        <textarea
          name="notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notes (optional)"
          rows={2}
          className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-surface placeholder:text-on-ink/50 focus:outline-none focus:ring-1 focus:ring-copper-bright resize-none"
        />

        {/* Follow-up hint */}
        <p className="mt-1.5 text-[10px] text-on-ink/80">
          Follow-up auto-set to {formatDate(item.suggestedFollowUpAt)}
        </p>

        {/* Error */}
        {error && (
          <p className="mt-2 text-xs text-hot">{error}</p>
        )}

        {showConfirm ? (
          <p className="mt-2 text-xs font-sans text-advisory" role="alert">
            {liveCollision?.level === "live"
              ? `${liveCollision.byUser} is viewing this customer now. Log anyway?`
              : `${liveCollision?.byUser} contacted this customer recently. Log anyway?`}
          </p>
        ) : null}

        {/* Submit */}
        <div className="mt-3 flex justify-end">
          <button
            type="submit"
            disabled={saving || checking}
            className="rounded-lg bg-copper px-4 py-1.5 text-sm font-semibold text-surface hover:bg-copper/90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving || checking ? "Saving…" : "Log call"}
          </button>
        </div>
      </fetcher.Form>
    </div>
  );
}
