import { expect, test } from "vitest";
import { withSms } from "../app/lib/return-to";
import { smsSendReason } from "../app/lib/sms-send-reason";

test("withSms appends sms code onto a path that already has a query", () => {
  expect(withSms("/dashboard?invoice=i1&tab=messages", "sent"))
    .toBe("/dashboard?invoice=i1&tab=messages&sms=sent");
});

test("withSms uses ? when the path has no query", () => {
  expect(withSms("/dashboard", "error")).toBe("/dashboard?sms=error");
});

test("smsSendReason maps sendInvoiceText's thrown messages to result codes", () => {
  expect(smsSendReason("SMS disabled for this workspace")).toBe("disabled");
  expect(smsSendReason("Quiet hours: texts can be sent only between 8:00 AM – 9:00 PM (America/New_York)")).toBe("quiet");
  expect(smsSendReason("Contact blocked: do_not_contact")).toBe("blocked");
  expect(smsSendReason("Customer has opted out of SMS")).toBe("optout");
  expect(smsSendReason("Customer has not consented to SMS")).toBe("noconsent");
  expect(smsSendReason("Invoice has no linked customer")).toBe("error");
});

test("smsSendReason checks disabled and quiet before the generic blocked/consent checks", () => {
  // "disabled" must win even though the message could plausibly also read as
  // something else — order matters, first match wins.
  expect(smsSendReason("SMS disabled for this workspace")).not.toBe("error");
  // "quiet" must not be misclassified as "blocked" just because both are hard gates.
  expect(smsSendReason("Quiet hours: texts can be sent only between 8:00 AM – 9:00 PM")).not.toBe("blocked");
});
