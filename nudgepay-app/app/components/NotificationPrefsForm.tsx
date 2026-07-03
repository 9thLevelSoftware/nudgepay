// NotificationPrefsForm — per-user notification opt-in/opt-out toggles.

import { Form, useNavigation, useSearchParams } from "react-router";

export function NotificationPrefsForm({
  orgId,
  emailEnabled,
  prefs,
}: {
  orgId: string;
  emailEnabled: boolean;
  prefs: { brokenPromiseEmail: boolean; dailyDigestEmail: boolean };
}) {
  const navigation = useNavigation();
  const busy = navigation.state !== "idle" && navigation.formAction === "/api/notification-prefs";
  const [sp] = useSearchParams();

  return (
    <section className="rounded-lg border border-border bg-surface p-5">
      <h2 className="font-display text-base font-semibold text-text">Notifications</h2>
      <p className="mt-1 text-xs text-muted">
        Choose which team alert emails you receive.
        {!emailEnabled && (
          <span className="ml-1 text-hot">Org email is disabled — alerts won't send until enabled.</span>
        )}
      </p>
      <Form method="post" action="/api/notification-prefs" className="mt-3 flex flex-col gap-3">
        <input type="hidden" name="org_id" value={orgId} />
        <label className="flex items-center gap-2 text-sm text-text">
          <input
            type="checkbox" name="broken_promise_email"
            defaultChecked={prefs.brokenPromiseEmail}
            className="h-4 w-4 rounded border-border accent-copper"
          />
          Broken-promise alerts
          <span className="text-xs text-muted ml-1">Immediate email when a customer breaks a promise</span>
        </label>
        <label className="flex items-center gap-2 text-sm text-text">
          <input
            type="checkbox" name="daily_digest_email"
            defaultChecked={prefs.dailyDigestEmail}
            className="h-4 w-4 rounded border-border accent-copper"
          />
          Daily follow-up digest
          <span className="text-xs text-muted ml-1">Morning summary of accounts needing follow-up</span>
        </label>
        <div className="flex items-center gap-3">
          <button
            type="submit" disabled={busy}
            className="rounded-md bg-copper px-3 py-1.5 text-xs font-semibold text-ink hover:bg-copper/90 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {busy ? "Saving…" : "Save"}
          </button>
          {sp.get("saved") === "notifications" && (
            <span className="text-xs text-cool" role="status">Preferences saved.</span>
          )}
        </div>
      </Form>
    </section>
  );
}
