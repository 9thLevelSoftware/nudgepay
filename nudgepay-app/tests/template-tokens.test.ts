import { describe, it, expect } from "vitest";
import { unknownTokens, TEMPLATE_TOKEN_KEYS, applyTemplate, type TemplateVars } from "../app/lib/sms-templates";

const vars: TemplateVars = {
  customer: "Acme Plumbing",
  invoice: "INV-1042",
  balance: "$1,240.00",
  dueDate: "Mar 15, 2026",
  company: "Your company",
  phone: "555-0100",
  paymentLink: "https://pay.example.com",
};

describe("unknownTokens", () => {
  it("returns empty for known-only bodies", () => {
    const body = TEMPLATE_TOKEN_KEYS.map((k) => `{${k}}`).join(" ");
    expect(unknownTokens(body)).toEqual([]);
    expect(unknownTokens("Hi {customer}, invoice {invoice} for {balance} due {dueDate}. — {company}")).toEqual([]);
  });

  it("returns unknown tokens in first-seen order, unique", () => {
    expect(unknownTokens("Hi {custmer}, ref {unknown}")).toEqual(["custmer", "unknown"]);
    expect(unknownTokens("{foo} {customer} {foo} {bar}")).toEqual(["foo", "bar"]);
  });

  it("returns empty for empty or tokenless input", () => {
    expect(unknownTokens("")).toEqual([]);
    expect(unknownTokens("   ")).toEqual([]);
    expect(unknownTokens("No placeholders in this body.")).toEqual([]);
  });

  it("ignores nested and malformed braces", () => {
    expect(unknownTokens("{unclosed")).toEqual([]);
    expect(unknownTokens("customer}")).toEqual([]);
    expect(unknownTokens("{}")).toEqual([]);
    expect(unknownTokens("{{customer}}")).toEqual([]);
    expect(unknownTokens("{foo{bar}}")).toEqual(["bar"]);
    expect(unknownTokens("{a{b{c}}}")).toEqual(["c"]);
  });

  it("treats spaced or differently cased names as unknown", () => {
    expect(unknownTokens("{ customer }")).toEqual([" customer "]);
    expect(unknownTokens("{Customer}")).toEqual(["Customer"]);
    expect(unknownTokens("{payment_link}")).toEqual(["payment_link"]);
  });
});

describe("unknown tokens pass through applyTemplate", () => {
  it("leaves unknownTokens results intact in the rendered body", () => {
    const body = "Hi {customer} {custmer} on {invoice}";
    expect(unknownTokens(body)).toEqual(["custmer"]);
    expect(applyTemplate(body, vars)).toBe("Hi Acme Plumbing {custmer} on INV-1042");
  });
});
