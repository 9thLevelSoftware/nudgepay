// Pure parser for notification preference form data. No I/O.

export type NotificationPrefsPatch = {
  brokenPromiseEmail: boolean;
  dailyDigestEmail: boolean;
};

export type NotificationPrefsParseResult =
  | { ok: true; patch: NotificationPrefsPatch }
  | { ok: false; error: string };

export function parseNotificationPrefsUpdate(form: FormData): NotificationPrefsParseResult {
  // Checkboxes only present when checked; absent = unchecked = false.
  const brokenPromiseEmail = form.get("broken_promise_email") === "on";
  const dailyDigestEmail = form.get("daily_digest_email") === "on";
  return { ok: true, patch: { brokenPromiseEmail, dailyDigestEmail } };
}
