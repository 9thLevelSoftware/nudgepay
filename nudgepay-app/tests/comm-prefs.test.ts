import { expect, test, describe, it } from "vitest";
import {
  resolveCommPrefs, canSendSms, canSendEmail, channelBlocked, DEFAULT_COMM_PREFS, CHANNELS,
  parseCommPrefsUpdate,
} from "../app/lib/comm-prefs";

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.append(k, v);
  return f;
}

test("resolveCommPrefs maps a full snake_case row", () => {
  expect(resolveCommPrefs({
    preferred_channel: "text", do_not_call: true, do_not_text: true,
  })).toEqual({ preferredChannel: "text", doNotCall: true, doNotText: true, doNotEmail: false });
});

test("resolveCommPrefs returns defaults for null/undefined", () => {
  expect(resolveCommPrefs(null)).toEqual(DEFAULT_COMM_PREFS);
  expect(resolveCommPrefs(undefined)).toEqual(DEFAULT_COMM_PREFS);
});

test("resolveCommPrefs coerces nullish booleans to false and unknown channel to null", () => {
  expect(resolveCommPrefs({ preferred_channel: "fax", do_not_call: null, do_not_text: undefined }))
    .toEqual({ preferredChannel: null, doNotCall: false, doNotText: false, doNotEmail: false });
  expect(resolveCommPrefs({ preferred_channel: "email" }).preferredChannel).toBe("email"); // email is now a channel
  expect(resolveCommPrefs({ preferred_channel: null })).toEqual(DEFAULT_COMM_PREFS);
});

test("canSendSms requires legal consent AND not opted out of text", () => {
  const base = { preferredChannel: null, doNotCall: false, doNotEmail: false } as const;
  expect(canSendSms({ ...base, doNotText: false }, true)).toBe(true);
  expect(canSendSms({ ...base, doNotText: true }, true)).toBe(false);   // preference opt-out
  expect(canSendSms({ ...base, doNotText: false }, false)).toBe(false); // no legal consent
  expect(canSendSms({ ...base, doNotText: true }, false)).toBe(false);
});

test("channelBlocked reads the matching per-channel flag", () => {
  const prefs = { preferredChannel: null, doNotCall: true, doNotText: false, doNotEmail: false };
  expect(channelBlocked(prefs, "call")).toBe(true);
  expect(channelBlocked(prefs, "text")).toBe(false);
});

describe("comm-prefs email channel", () => {
  it("includes email in CHANNELS", () => {
    expect(CHANNELS).toContain("email");
  });
  it("resolves do_not_email", () => {
    expect(resolveCommPrefs({ do_not_email: true }).doNotEmail).toBe(true);
    expect(resolveCommPrefs(null).doNotEmail).toBe(false);
  });
  it("canSendEmail is true unless opted out (no consent term)", () => {
    expect(canSendEmail(resolveCommPrefs({ do_not_email: false }))).toBe(true);
    expect(canSendEmail(resolveCommPrefs({ do_not_email: true }))).toBe(false);
  });
  it("channelBlocked handles email", () => {
    expect(channelBlocked(resolveCommPrefs({ do_not_email: true }), "email")).toBe(true);
  });
});

describe("parseCommPrefsUpdate (NP-AUD-2026-003)", () => {
  it("omits do_not_email when the form does not post it", () => {
    expect(parseCommPrefsUpdate(fd({ preferred_channel: "text", do_not_call: "true", do_not_text: "true" })))
      .toEqual({ preferred_channel: "text" });
  });

  it("writes do_not_email only when the sentinel is posted", () => {
    expect(parseCommPrefsUpdate(fd({
      preferred_channel: "email",
      do_not_email_set: "1",
      do_not_email: "true",
    }))).toEqual({ preferred_channel: "email", do_not_email: true });
  });

  it("treats an unchecked box with sentinel as false for call, not text without confirm", () => {
    expect(parseCommPrefsUpdate(fd({
      do_not_call_set: "1",
      do_not_text_set: "1",
    }))).toEqual({ preferred_channel: null, do_not_call: false });
  });

  it("does not clear do_not_text without confirm_resubscribe_sms", () => {
    expect(parseCommPrefsUpdate(fd({
      do_not_text_set: "1",
    }))).toEqual({ preferred_channel: null });
  });

  it("allows explicit SMS re-subscribe when confirm_resubscribe_sms is posted", () => {
    expect(parseCommPrefsUpdate(fd({
      do_not_text_set: "1",
      confirm_resubscribe_sms: "true",
    }))).toEqual({ preferred_channel: null, do_not_text: false });
  });

  it("does not clear do_not_email without confirm_resubscribe", () => {
    expect(parseCommPrefsUpdate(fd({
      do_not_email_set: "1",
    }))).toEqual({ preferred_channel: null });
  });

  it("allows explicit re-subscribe when confirm_resubscribe is posted", () => {
    expect(parseCommPrefsUpdate(fd({
      do_not_email_set: "1",
      confirm_resubscribe: "true",
    }))).toEqual({ preferred_channel: null, do_not_email: false });
  });

  it("never includes sms_consent", () => {
    expect("sms_consent" in parseCommPrefsUpdate(fd({ do_not_text_set: "1", do_not_text: "true" }))).toBe(false);
  });
});
