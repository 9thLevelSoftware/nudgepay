// Pure module — no I/O, no node:*, no .server suffix. Per-customer communication
// preferences: a single preferred channel plus per-channel opt-outs. Single
// source of truth for SMS eligibility (canSendSms), email eligibility
// (canSendEmail), and badge state (channelBlocked). These are PREFERENCES,
// distinct from the legal sms_consent record (TCPA/A2P) which STOP/START
// governs exclusively. Email is a NudgePay channel (CAN-SPAM opt-out; no
// positive-consent term unlike TCPA/A2P).

export const CHANNELS = ["call", "text", "email"] as const;
export type Channel = (typeof CHANNELS)[number];

export type CommPrefs = {
  preferredChannel: Channel | null;
  doNotCall: boolean;
  doNotText: boolean;
  doNotEmail: boolean;
};

export const DEFAULT_COMM_PREFS: CommPrefs = {
  preferredChannel: null,
  doNotCall: false,
  doNotText: false,
  doNotEmail: false,
};

export type CommPrefsRow = {
  preferred_channel?: string | null;
  do_not_call?: boolean | null;
  do_not_text?: boolean | null;
  do_not_email?: boolean | null;
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
    doNotText: Boolean(row.do_not_text),
    doNotEmail: Boolean(row.do_not_email),
  };
}

// Shape the submitted form into a customers UPDATE. Deliberately OMITS
// sms_consent — the legal consent record is governed solely by STOP/START.
// Boolean opt-outs are included only when a "*_set" sentinel was posted, so a
// form that does not display do_not_email cannot default the column to false
// (CAN-SPAM: NP-AUD-2026-003). Unchecked boxes still work: the sentinel is a
// hidden input; the checkbox posts "true" only when checked.
export type CommPrefsPatch = {
  preferred_channel: Channel | null;
  do_not_call?: boolean;
  do_not_text?: boolean;
  do_not_email?: boolean;
};

export function parseCommPrefsUpdate(form: FormData): CommPrefsPatch {
  const raw = form.get("preferred_channel");
  const ch = typeof raw === "string" ? raw : "";
  const patch: CommPrefsPatch = {
    preferred_channel: isChannel(ch) ? ch : null,
  };
  if (form.get("do_not_call_set") === "1") {
    patch.do_not_call = form.get("do_not_call") === "true";
  }
  if (form.get("do_not_text_set") === "1") {
    patch.do_not_text = form.get("do_not_text") === "true";
  }
  if (form.get("do_not_email_set") === "1") {
    const next = form.get("do_not_email") === "true";
    // Re-subscribe (true → false) requires an explicit confirm field so "Save
    // preferences" cannot silently undo a tokenized unsubscribe.
    if (next === false && form.get("confirm_resubscribe") !== "true") {
      // omit — leave the existing DB value
    } else {
      patch.do_not_email = next;
    }
  }
  return patch;
}

// Single source of truth for SMS eligibility: legal consent AND not opted out.
export function canSendSms(prefs: CommPrefs, smsConsent: boolean): boolean {
  return smsConsent && !prefs.doNotText;
}

// Single source of truth for email eligibility: not opted out. CAN-SPAM is
// opt-out, so (unlike canSendSms) there is no positive-consent term.
export function canSendEmail(prefs: CommPrefs): boolean {
  return !prefs.doNotEmail;
}

// Is a given channel opted out (for badge/warning rendering)?
export function channelBlocked(prefs: CommPrefs, channel: Channel): boolean {
  switch (channel) {
    case "call": return prefs.doNotCall;
    case "text": return prefs.doNotText;
    case "email": return prefs.doNotEmail;
  }
}
