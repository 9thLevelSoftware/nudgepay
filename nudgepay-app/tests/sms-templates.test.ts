import { expect, test } from "vitest";
import { DEFAULT_SMS_TEMPLATES, applyTemplate, type TemplateVars } from "../app/lib/sms-templates";

const vars: TemplateVars = {
  customer: "Acme Co", invoice: "1042", balance: "$4,850.00", dueDate: "Mar 1, 2026",
  company: "Chancey Heating & Cooling", phone: "555-0100", paymentLink: "https://pay.example.com/abc",
};

test("applyTemplate substitutes all four variables", () => {
  const out = applyTemplate("{customer} owes {balance} on {invoice} (due {dueDate})", vars);
  expect(out).toBe("Acme Co owes $4,850.00 on 1042 (due Mar 1, 2026)");
});

test("applyTemplate substitutes company, phone, and paymentLink", () => {
  const out = applyTemplate("{company} · {phone} · {paymentLink}", vars);
  expect(out).toBe("Chancey Heating & Cooling · 555-0100 · https://pay.example.com/abc");
});

test("applyTemplate leaves unknown tokens intact", () => {
  expect(applyTemplate("Hi {customer}, ref {unknown}", vars)).toBe("Hi Acme Co, ref {unknown}");
});

test("applyTemplate replaces repeated tokens", () => {
  expect(applyTemplate("{customer} {customer}", vars)).toBe("Acme Co Acme Co");
});

test("every starter renders without leftover known tokens", () => {
  for (const t of DEFAULT_SMS_TEMPLATES) {
    const out = applyTemplate(t.body, vars);
    expect(out, t.id).not.toMatch(/\{(customer|invoice|balance|dueDate|company|phone|paymentLink)\}/);
    expect(out.length).toBeGreaterThan(0);
  }
});

test("there are four starter templates with unique ids", () => {
  expect(DEFAULT_SMS_TEMPLATES).toHaveLength(4);
  expect(new Set(DEFAULT_SMS_TEMPLATES.map((t) => t.id)).size).toBe(4);
});

test("no starter template body contains the old hardcoded company name", () => {
  for (const t of DEFAULT_SMS_TEMPLATES) {
    expect(t.body).not.toContain("Chancey");
  }
});
