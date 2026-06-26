import { expect, test } from "vitest";
import {
  resolveCommPrefs, canSendSms, channelBlocked, DEFAULT_COMM_PREFS,
} from "../app/lib/comm-prefs";

test("resolveCommPrefs maps a full snake_case row", () => {
  expect(resolveCommPrefs({
    preferred_channel: "text", do_not_call: true, do_not_text: true,
  })).toEqual({ preferredChannel: "text", doNotCall: true, doNotText: true });
});

test("resolveCommPrefs returns defaults for null/undefined", () => {
  expect(resolveCommPrefs(null)).toEqual(DEFAULT_COMM_PREFS);
  expect(resolveCommPrefs(undefined)).toEqual(DEFAULT_COMM_PREFS);
});

test("resolveCommPrefs coerces nullish booleans to false and unknown/email channel to null", () => {
  expect(resolveCommPrefs({ preferred_channel: "fax", do_not_call: null, do_not_text: undefined }))
    .toEqual({ preferredChannel: null, doNotCall: false, doNotText: false });
  expect(resolveCommPrefs({ preferred_channel: "email" }).preferredChannel).toBe(null); // email no longer a channel
  expect(resolveCommPrefs({ preferred_channel: null })).toEqual(DEFAULT_COMM_PREFS);
});

test("canSendSms requires legal consent AND not opted out of text", () => {
  const base = { preferredChannel: null, doNotCall: false } as const;
  expect(canSendSms({ ...base, doNotText: false }, true)).toBe(true);
  expect(canSendSms({ ...base, doNotText: true }, true)).toBe(false);   // preference opt-out
  expect(canSendSms({ ...base, doNotText: false }, false)).toBe(false); // no legal consent
  expect(canSendSms({ ...base, doNotText: true }, false)).toBe(false);
});

test("channelBlocked reads the matching per-channel flag", () => {
  const prefs = { preferredChannel: null, doNotCall: true, doNotText: false };
  expect(channelBlocked(prefs, "call")).toBe(true);
  expect(channelBlocked(prefs, "text")).toBe(false);
});
