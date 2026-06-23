import { expect, test } from "vitest";
import { SMS_TEMPLATES, applyTemplate, type TemplateVars } from "../app/lib/sms-templates";

const vars: TemplateVars = {
  customer: "Acme Co", invoice: "1042", balance: "$4,850.00", dueDate: "Mar 1, 2026",
};

test("applyTemplate substitutes all four variables", () => {
  const out = applyTemplate("{customer} owes {balance} on {invoice} (due {dueDate})", vars);
  expect(out).toBe("Acme Co owes $4,850.00 on 1042 (due Mar 1, 2026)");
});

test("applyTemplate leaves unknown tokens intact", () => {
  expect(applyTemplate("Hi {customer}, ref {unknown}", vars)).toBe("Hi Acme Co, ref {unknown}");
});

test("applyTemplate replaces repeated tokens", () => {
  expect(applyTemplate("{customer} {customer}", vars)).toBe("Acme Co Acme Co");
});

test("every starter renders without leftover known tokens", () => {
  for (const t of SMS_TEMPLATES) {
    const out = applyTemplate(t.body, vars);
    expect(out, t.id).not.toMatch(/\{(customer|invoice|balance|dueDate)\}/);
    expect(out.length).toBeGreaterThan(0);
  }
});

test("there are four starter templates with unique ids", () => {
  expect(SMS_TEMPLATES).toHaveLength(4);
  expect(new Set(SMS_TEMPLATES.map((t) => t.id)).size).toBe(4);
});
