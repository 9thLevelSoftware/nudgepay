import { expect, test } from "vitest";
import { withSms } from "../app/routes/api.text.send";

test("withSms appends sms code onto a path that already has a query", () => {
  expect(withSms("/dashboard?invoice=i1&tab=messages", "sent"))
    .toBe("/dashboard?invoice=i1&tab=messages&sms=sent");
});

test("withSms uses ? when the path has no query", () => {
  expect(withSms("/dashboard", "error")).toBe("/dashboard?sms=error");
});
