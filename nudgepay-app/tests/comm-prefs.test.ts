import { expect, test } from "vitest";
import {
  resolveCommPrefs, canSendSms, channelBlocked, DEFAULT_COMM_PREFS,
} from "../app/lib/comm-prefs";

test("resolveCommPrefs maps a full snake_case row", () => {
  expect(resolveCommPrefs({
    preferred_channel: "email", do_not_call: true, do_not_email: false, do_not_text: true,
  })).toEqual({ preferredChannel: "email", doNotCall: true, doNotEmail: false, doNotText: true });
});

test("resolveCommPrefs returns defaults for null/undefined", () => {
  expect(resolveCommPrefs(null)).toEqual(DEFAULT_COMM_PREFS);
  expect(resolveCommPrefs(undefined)).toEqual(DEFAULT_COMM_PREFS);
});

test("resolveCommPrefs coerces nullish booleans to false and unknown channel to null", () => {
  expect(resolveCommPrefs({ preferred_channel: "fax", do_not_call: null, do_not_text: undefined }))
    .toEqual({ preferredChannel: null, doNotCall: false, doNotEmail: false, doNotText: false });
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
  const prefs = { preferredChannel: null, doNotCall: true, doNotEmail: false, doNotText: true };
  expect(channelBlocked(prefs, "call")).toBe(true);
  expect(channelBlocked(prefs, "email")).toBe(false);
  expect(channelBlocked(prefs, "text")).toBe(true);
});
