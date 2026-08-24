import { Form, Link } from "react-router";

export function FirstRunBanner({
  isOwner,
  qboConfigured,
  kind = "not_connected",
}: {
  isOwner: boolean;
  qboConfigured: boolean;
  kind?: "not_connected" | "needs_reconnect";
}) {
  const reconnect = kind === "needs_reconnect";
  return (
    <div className="mx-6 mt-4 rounded-lg border border-border bg-surface p-5" role="status">
      <h2 className="font-display text-base font-semibold text-text">
        {reconnect ? "Reconnect QuickBooks" : "Connect QuickBooks to start collections"}
      </h2>
      <p className="mt-1 text-sm text-muted">
        {reconnect
          ? "The QuickBooks connection needs attention. Reconnect to keep invoices and the work queue current."
          : "Your workspace is ready. Overdue invoices, accounts, and the work queue appear after QuickBooks is connected."}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {isOwner && qboConfigured ? (
          <Form method="post" action="/api/qbo/connect">
            <button type="submit" className="rounded-md bg-copper px-3 py-1.5 text-xs font-semibold text-ink hover:bg-copper/90">
              {reconnect ? "Reconnect QuickBooks" : "Connect QuickBooks"}
            </button>
          </Form>
        ) : (
          <Link
            to="/settings?tab=integrations"
            className="rounded-md bg-copper px-3 py-1.5 text-xs font-semibold text-ink hover:bg-copper/90"
          >
            Open Integrations
          </Link>
        )}
        {!qboConfigured ? (
          <p className="self-center text-xs text-muted">
            An operator still needs to set QBO Client ID, secret, redirect URI, and webhook token on the Worker.
          </p>
        ) : null}
      </div>
    </div>
  );
}
