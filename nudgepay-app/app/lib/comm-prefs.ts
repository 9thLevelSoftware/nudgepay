// Pure module — no I/O, no node:*, no .server suffix. Per-customer communication
// preferences: a single preferred channel plus per-channel opt-outs. Single
// source of truth for SMS eligibility (canSendSms) and badge state
// (channelBlocked). These are PREFERENCES, distinct from the legal sms_consent
// record (TCPA/A2P) which STOP/START governs exclusively.

export const CHANNELS = ["call", "text", "email"] as const;
export type Channel = (typeof CHANNELS)[number];

export type CommPrefs = {
  preferredChannel: Channel | null;
  doNotCall: boolean;
  doNotEmail: boolean;
  doNotText: boolean;
};

export const DEFAULT_COMM_PREFS: CommPrefs = {
  preferredChannel: null,
  doNotCall: false,
  doNotEmail: false,
  doNotText: false,
};

export type CommPrefsRow = {
  preferred_channel?: string | null;
  do_not_call?: boolean | null;
  do_not_email?: boolean | null;
  do_not_text?: boolean | null;
};

function isChannel(v: string | null | undefined): v is Channel {
  return v === "call" || v === "text" || v === "email";
}

// Map a (possibly partial/nullable) DB row to CommPrefs. Unknown
// preferred_channel coerces to null; nullish booleans coerce to false.
export function resolveCommPrefs(row: CommPrefsRow | null | undefined): CommPrefs {
  if (!row) return { ...DEFAULT_COMM_PREFS };
  return {
    preferredChannel: isChannel(row.preferred_channel) ? row.preferred_channel : null,
    doNotCall: Boolean(row.do_not_call),
    doNotEmail: Boolean(row.do_not_email),
    doNotText: Boolean(row.do_not_text),
  };
}

// Single source of truth for SMS eligibility: legal consent AND not opted out.
export function canSendSms(prefs: CommPrefs, smsConsent: boolean): boolean {
  return smsConsent && !prefs.doNotText;
}

// Is a given channel opted out (for badge/warning rendering)?
export function channelBlocked(prefs: CommPrefs, channel: Channel): boolean {
  switch (channel) {
    case "call": return prefs.doNotCall;
    case "text": return prefs.doNotText;
    case "email": return prefs.doNotEmail;
  }
}
