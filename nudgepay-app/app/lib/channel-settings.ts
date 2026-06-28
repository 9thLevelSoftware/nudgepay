// Pure parse/resolve for per-org channel settings. No I/O, no node:*, no .server.
// Mirrors org-settings.ts / comm-prefs.ts. SMS-only this phase; email config is
// storage-only groundwork (subsystem #3) and is not represented here yet.

export type ChannelSettings = { smsEnabled: boolean };

export type ChannelSettingsRow = { sms_enabled?: boolean | null };

// A missing row or missing column means SMS is ENABLED (preserves the pre-toggle
// default — orgs without a messaging_config row still send).
export function resolveChannelSettings(row: ChannelSettingsRow | null | undefined): ChannelSettings {
  if (!row || row.sms_enabled == null) return { smsEnabled: true };
  return { smsEnabled: row.sms_enabled === true };
}

// The Settings toggle posts an explicit "true"/"false"; anything else is off.
export function parseChannelSettingsUpdate(form: FormData): { sms_enabled: boolean } {
  return { sms_enabled: form.get("sms_enabled") === "true" };
}
