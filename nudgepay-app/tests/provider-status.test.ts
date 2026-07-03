import { expect, test } from "vitest";
import { deriveWebhookUrls, parseTestSmsDestination } from "../app/lib/provider-status";

// ---------------------------------------------------------------------------
// deriveWebhookUrls
// ---------------------------------------------------------------------------

test("deriveWebhookUrls: both bases set", () => {
  const urls = deriveWebhookUrls("https://twilio.example.com", "https://app.example.com");
  expect(urls).toEqual({
    twilioInbound: "https://twilio.example.com/webhooks/twilio/inbound",
    twilioStatus: "https://twilio.example.com/webhooks/twilio/status",
    resendWebhook: "https://app.example.com/webhooks/resend",
  });
});

test("deriveWebhookUrls: trims trailing slash off base URLs", () => {
  const urls = deriveWebhookUrls("https://twilio.example.com/", "https://app.example.com/");
  expect(urls.twilioInbound).toBe("https://twilio.example.com/webhooks/twilio/inbound");
  expect(urls.resendWebhook).toBe("https://app.example.com/webhooks/resend");
});

test("deriveWebhookUrls: only twilio base", () => {
  const urls = deriveWebhookUrls("https://twilio.example.com", null);
  expect(urls.twilioInbound).toBe("https://twilio.example.com/webhooks/twilio/inbound");
  expect(urls.twilioStatus).toBe("https://twilio.example.com/webhooks/twilio/status");
  expect(urls.resendWebhook).toBeNull();
});

test("deriveWebhookUrls: only app base", () => {
  const urls = deriveWebhookUrls(null, "https://app.example.com");
  expect(urls.twilioInbound).toBeNull();
  expect(urls.twilioStatus).toBeNull();
  expect(urls.resendWebhook).toBe("https://app.example.com/webhooks/resend");
});

test("deriveWebhookUrls: neither base → all null", () => {
  const urls = deriveWebhookUrls(null, null);
  expect(urls).toEqual({ twilioInbound: null, twilioStatus: null, resendWebhook: null });
});

// ---------------------------------------------------------------------------
// parseTestSmsDestination
// ---------------------------------------------------------------------------

test("parseTestSmsDestination: E.164 passes through", () => {
  expect(parseTestSmsDestination("+15551234567")).toBe("+15551234567");
  expect(parseTestSmsDestination("+442071234567")).toBe("+442071234567");
});

test("parseTestSmsDestination: 10-digit US number normalizes", () => {
  expect(parseTestSmsDestination("5551234567")).toBe("+15551234567");
});

test("parseTestSmsDestination: 11-digit US number with leading 1", () => {
  expect(parseTestSmsDestination("15551234567")).toBe("+15551234567");
});

test("parseTestSmsDestination: strips dashes/spaces/parens/dots", () => {
  expect(parseTestSmsDestination("(555) 123-4567")).toBe("+15551234567");
  expect(parseTestSmsDestination("555.123.4567")).toBe("+15551234567");
  expect(parseTestSmsDestination("+1 555 123 4567")).toBe("+15551234567");
});

test("parseTestSmsDestination: empty/null → null", () => {
  expect(parseTestSmsDestination("")).toBeNull();
  expect(parseTestSmsDestination("  ")).toBeNull();
  expect(parseTestSmsDestination(null)).toBeNull();
});

test("parseTestSmsDestination: too short → null", () => {
  expect(parseTestSmsDestination("12345")).toBeNull();
});

test("parseTestSmsDestination: letters → null", () => {
  expect(parseTestSmsDestination("abcdefghij")).toBeNull();
});
