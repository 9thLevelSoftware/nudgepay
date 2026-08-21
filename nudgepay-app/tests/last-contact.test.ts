import { expect, test } from "vitest";
import { countsAsCustomerContact } from "../app/lib/last-contact";

test("notes and snooze do not count as customer contact", () => {
  expect(countsAsCustomerContact("note")).toBe(false);
  expect(countsAsCustomerContact(null)).toBe(false);
  expect(countsAsCustomerContact("call")).toBe(true);
  expect(countsAsCustomerContact("text")).toBe(true);
  expect(countsAsCustomerContact("email")).toBe(true);
});
