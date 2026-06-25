import { useEffect, useRef, useState } from "react";
import { Form } from "react-router";

export type SyncIssue = {
  id: string;
  source: string;       // 'manual' | 'webhook' | 'cron'
  scope: string;
  message: string;
  occurredAt: string;   // ISO timestamp
};

function relativeTime(iso: string): string {
  const diffMin = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}

/**
 * SyncIssues — header indicator for unresolved QBO sync failures (B6).
 * Renders nothing when there are no issues. Otherwise a warning badge that
 * toggles a panel listing each error with a Dismiss action that POSTs to
 * /api/sync-errors/dismiss (org-scoped on the server).
 */
export function SyncIssues({ issues, returnTo }: { issues: SyncIssue[]; returnTo: string }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close the panel on Escape or a click outside it (only while open).
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onPointer(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [open]);

  if (issues.length === 0) return null;
  const label = issues.length === 1 ? "1 sync issue" : `${issues.length} sync issues`;

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        className="hidden sm:inline-flex items-center gap-1.5 rounded-md border border-amber-400/40 bg-amber-400/10 px-2.5 h-8 text-xs font-sans text-amber-200 hover:border-amber-300 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${label} — show details`}
        onClick={() => setOpen((v) => !v)}
      >
        <span aria-hidden="true">⚠</span>
        <span>{issues.length}</span>
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Sync issues"
          className="absolute right-0 top-10 z-40 w-80 max-h-96 overflow-auto rounded-lg border border-border bg-surface text-text shadow-panel p-2"
        >
          <p className="px-2 py-1 text-[11px] font-sans font-semibold uppercase tracking-wide text-muted">
            {label}
          </p>
          <ul className="flex flex-col gap-1" role="list">
            {issues.map((it) => (
              <li key={it.id} className="rounded-md border border-border p-2 text-xs font-sans">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-text capitalize">{it.source}</span>
                  {/* relativeTime() reads Date.now(); suppress the SSR/client diff. */}
                  <span className="text-muted" suppressHydrationWarning>{relativeTime(it.occurredAt)}</span>
                </div>
                <p className="mt-0.5 break-words text-text/80">{it.message}</p>
                <Form method="post" action="/api/sync-errors/dismiss" className="mt-1.5">
                  <input type="hidden" name="id" value={it.id} />
                  <input type="hidden" name="returnTo" value={returnTo} />
                  <button
                    type="submit"
                    className="text-[11px] font-medium text-copper hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper rounded"
                  >
                    Dismiss
                  </button>
                </Form>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
