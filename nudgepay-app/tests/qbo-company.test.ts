import { expect, test } from "vitest";
import { isSupportedQboCompany } from "../app/lib/qbo-company";

test("US company without currency is supported (CompanyInfo often omits HomeCurrency)", () => {
  expect(isSupportedQboCompany({ Id: "1", Country: "US", CompanyName: "Acme HVAC" })).toBe(true);
});

test("US company billed in USD is supported", () => {
  expect(isSupportedQboCompany({ Country: "US", HomeCurrency: "USD" })).toBe(true);
  expect(isSupportedQboCompany({ Country: "US", HomeCurrency: { value: "USD" } })).toBe(true);
  expect(isSupportedQboCompany({ Country: "US", CurrencyRef: { value: "USD" } })).toBe(true);
  expect(isSupportedQboCompany({
    Country: "US",
    CurrencyPrefs: { HomeCurrency: { value: "USD" } },
  })).toBe(true);
});

test("country match is case-insensitive and accepts US aliases", () => {
  expect(isSupportedQboCompany({ Country: "us" })).toBe(true);
  expect(isSupportedQboCompany({ Country: "USA" })).toBe(true);
  expect(isSupportedQboCompany({ Country: "United States" })).toBe(true);
  expect(isSupportedQboCompany({ Country: "  US  " })).toBe(true);
});

test("Country can come from CompanyAddr or LegalAddr", () => {
  expect(isSupportedQboCompany({ CompanyAddr: { Country: "US" } })).toBe(true);
  expect(isSupportedQboCompany({ LegalAddr: { Country: "US" } })).toBe(true);
});

test("API envelope { CompanyInfo } is unwrapped", () => {
  expect(isSupportedQboCompany({ CompanyInfo: { Country: "US", CompanyName: "Acme" } })).toBe(true);
  expect(isSupportedQboCompany({ CompanyInfo: { Country: "AU" } })).toBe(false);
});

test("non-US country is rejected even when currency is USD", () => {
  expect(isSupportedQboCompany({ Country: "AU" })).toBe(false);
  expect(isSupportedQboCompany({ Country: "CA", HomeCurrency: "CAD" })).toBe(false);
  expect(isSupportedQboCompany({ Country: "GB", HomeCurrency: { value: "GBP" } })).toBe(false);
  expect(isSupportedQboCompany({ Country: "AU", HomeCurrency: "USD" })).toBe(false);
});

test("US company with a non-USD home currency is rejected", () => {
  expect(isSupportedQboCompany({ Country: "US", HomeCurrency: "AUD" })).toBe(false);
  expect(isSupportedQboCompany({ Country: "US", HomeCurrency: { value: "CAD" } })).toBe(false);
  expect(isSupportedQboCompany({ Country: "US", CurrencyRef: { value: "EUR" } })).toBe(false);
});

test("NameValue HomeCurrency is honored when present", () => {
  expect(isSupportedQboCompany({
    Country: "US",
    NameValue: [{ Name: "HomeCurrency", Value: "USD" }],
  })).toBe(true);
  expect(isSupportedQboCompany({
    Country: "US",
    NameValue: [{ Name: "HomeCurrency", Value: "AUD" }],
  })).toBe(false);
});

test("missing or unreadable CompanyInfo is not supported", () => {
  expect(isSupportedQboCompany(null)).toBe(false);
  expect(isSupportedQboCompany(undefined)).toBe(false);
  expect(isSupportedQboCompany("US")).toBe(false);
  expect(isSupportedQboCompany({})).toBe(false);
  expect(isSupportedQboCompany({ CompanyName: "Acme HVAC" })).toBe(false);
});
