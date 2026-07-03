import { expect, test } from "vitest";
import {
  resolveChannelSettings, parseChannelSettingsUpdate,
  resolveSmsSenderSettings, parseSmsSenderUpdate,
  parseQuietHoursUpdate,
} from "../app/lib/channel-settings";

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

// ---------------------------------------------------------------------------
// resolveSmsSenderSettings
// ---------------------------------------------------------------------------

test("resolveSmsSenderSettings: null/undefined row → empty strings", () => {
  expect(resolveSmsSenderSettings(null)).toEqual({ sender: "", messagingServiceSid: "" });
  expect(resolveSmsSenderSettings(undefined)).toEqual({ sender: "", messagingServiceSid: "" });
});

test("resolveSmsSenderSettings: trims and defaults null columns", () => {
  expect(resolveSmsSenderSettings({ sender: "  +15551234567  " })).toEqual({
    sender: "+15551234567", messagingServiceSid: "",
  });
  expect(resolveSmsSenderSettings({ messaging_service_sid: "MG" + "a".repeat(32) })).toEqual({
    sender: "", messagingServiceSid: "MG" + "a".repeat(32),
  });
});

// ---------------------------------------------------------------------------
// parseSmsSenderUpdate
// ---------------------------------------------------------------------------

test("parseSmsSenderUpdate: valid E.164 + valid SID accepted", () => {
  const result = parseSmsSenderUpdate(fd([
    ["sender", "+15551234567"],
    ["messaging_service_sid", "MG" + "0".repeat(32)],
  ]));
  expect(result).toEqual({
    ok: true,
    value: { sender: "+15551234567", messaging_service_sid: "MG" + "0".repeat(32) },
  });
});

test("parseSmsSenderUpdate: empty strings → null (clears override)", () => {
  const result = parseSmsSenderUpdate(fd([["sender", ""], ["messaging_service_sid", ""]]));
  expect(result).toEqual({ ok: true, value: { sender: null, messaging_service_sid: null } });
});

test("parseSmsSenderUpdate: missing fields → null", () => {
  const result = parseSmsSenderUpdate(fd([]));
  expect(result).toEqual({ ok: true, value: { sender: null, messaging_service_sid: null } });
});

test("parseSmsSenderUpdate: rejects phone without +", () => {
  const result = parseSmsSenderUpdate(fd([["sender", "5551234567"]]));
  expect(result).toEqual({ ok: false, error: "sms_sender" });
});

test("parseSmsSenderUpdate: rejects +0 prefix", () => {
  const result = parseSmsSenderUpdate(fd([["sender", "+0123456789"]]));
  expect(result).toEqual({ ok: false, error: "sms_sender" });
});

test("parseSmsSenderUpdate: rejects SID with wrong prefix", () => {
  const result = parseSmsSenderUpdate(fd([["messaging_service_sid", "XX" + "0".repeat(32)]]));
  expect(result).toEqual({ ok: false, error: "sms_sid" });
});

test("parseSmsSenderUpdate: rejects SID with too few hex chars", () => {
  const result = parseSmsSenderUpdate(fd([["messaging_service_sid", "MG" + "0".repeat(31)]]));
  expect(result).toEqual({ ok: false, error: "sms_sid" });
});

test("parseSmsSenderUpdate: rejects SID with non-hex chars", () => {
  const result = parseSmsSenderUpdate(fd([["messaging_service_sid", "MG" + "g".repeat(32)]]));
  expect(result).toEqual({ ok: false, error: "sms_sid" });
});

// ---------------------------------------------------------------------------
// parseQuietHoursUpdate — ranges mirror migration 0030's CHECKs
// ---------------------------------------------------------------------------

test("parseQuietHoursUpdate: accepts a valid window", () => {
  const result = parseQuietHoursUpdate(fd([["sms_send_start_hour", "8"], ["sms_send_end_hour", "21"]]));
  expect(result).toEqual({ ok: true, patch: { sms_send_start_hour: 8, sms_send_end_hour: 21 } });
});

test("parseQuietHoursUpdate: accepts the boundary values (start=0, end=24)", () => {
  const result = parseQuietHoursUpdate(fd([["sms_send_start_hour", "0"], ["sms_send_end_hour", "24"]]));
  expect(result).toEqual({ ok: true, patch: { sms_send_start_hour: 0, sms_send_end_hour: 24 } });
});

test("parseQuietHoursUpdate: rejects start >= end", () => {
  expect(parseQuietHoursUpdate(fd([["sms_send_start_hour", "12"], ["sms_send_end_hour", "12"]])))
    .toEqual({ ok: false, error: "quiet_hours" });
  expect(parseQuietHoursUpdate(fd([["sms_send_start_hour", "15"], ["sms_send_end_hour", "9"]])))
    .toEqual({ ok: false, error: "quiet_hours" });
});

test("parseQuietHoursUpdate: rejects start out of 0-23 range", () => {
  expect(parseQuietHoursUpdate(fd([["sms_send_start_hour", "-1"], ["sms_send_end_hour", "21"]])))
    .toEqual({ ok: false, error: "quiet_hours" });
  expect(parseQuietHoursUpdate(fd([["sms_send_start_hour", "24"], ["sms_send_end_hour", "21"]])))
    .toEqual({ ok: false, error: "quiet_hours" });
});

test("parseQuietHoursUpdate: rejects end out of 1-24 range", () => {
  expect(parseQuietHoursUpdate(fd([["sms_send_start_hour", "8"], ["sms_send_end_hour", "0"]])))
    .toEqual({ ok: false, error: "quiet_hours" });
  expect(parseQuietHoursUpdate(fd([["sms_send_start_hour", "8"], ["sms_send_end_hour", "25"]])))
    .toEqual({ ok: false, error: "quiet_hours" });
});

test("parseQuietHoursUpdate: rejects missing or non-integer fields", () => {
  expect(parseQuietHoursUpdate(fd([]))).toEqual({ ok: false, error: "quiet_hours" });
  expect(parseQuietHoursUpdate(fd([["sms_send_start_hour", "8.5"], ["sms_send_end_hour", "21"]])))
    .toEqual({ ok: false, error: "quiet_hours" });
  expect(parseQuietHoursUpdate(fd([["sms_send_start_hour", "abc"], ["sms_send_end_hour", "21"]])))
    .toEqual({ ok: false, error: "quiet_hours" });
});
