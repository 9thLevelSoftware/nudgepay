import { expect, test } from "vitest";
import { resolveChannelSettings, parseChannelSettingsUpdate } from "../app/lib/channel-settings";

function fd(entries: Array<[string, string]>): FormData {
  const f = new FormData();
  for (const [k, v] of entries) f.append(k, v);
  return f;
}

test("resolveChannelSettings: explicit true/false; nullish row or column defaults enabled", () => {
  expect(resolveChannelSettings({ sms_enabled: true })).toEqual({ smsEnabled: true });
  expect(resolveChannelSettings({ sms_enabled: false })).toEqual({ smsEnabled: false });
  expect(resolveChannelSettings({})).toEqual({ smsEnabled: true });        // column absent
  expect(resolveChannelSettings(null)).toEqual({ smsEnabled: true });      // no row
  expect(resolveChannelSettings(undefined)).toEqual({ smsEnabled: true });
});

test("parseChannelSettingsUpdate: only the literal 'true' enables", () => {
  expect(parseChannelSettingsUpdate(fd([["sms_enabled", "true"]]))).toEqual({ sms_enabled: true });
  expect(parseChannelSettingsUpdate(fd([["sms_enabled", "false"]]))).toEqual({ sms_enabled: false });
  expect(parseChannelSettingsUpdate(fd([]))).toEqual({ sms_enabled: false }); // missing => off
});
