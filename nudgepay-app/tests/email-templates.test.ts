import { describe, it, expect } from "vitest";
import { EMAIL_TEMPLATES, applyEmailTemplate } from "../app/lib/email-templates";

describe("email templates", () => {
  it("substitutes known tokens in subject and body", () => {
    const out = applyEmailTemplate("Hi {customer}, invoice {invoice} for {balance} due {dueDate}",
      { customer: "Acme", invoice: "1001", balance: "$50.00", dueDate: "Jun 1" });
    expect(out).toBe("Hi Acme, invoice 1001 for $50.00 due Jun 1");
  });
  it("leaves unknown tokens untouched", () => {
    expect(applyEmailTemplate("{customer} {unknown}", { customer: "A", invoice: "", balance: "", dueDate: "" }))
      .toBe("A {unknown}");
  });
  it("every starter template has a non-empty subject and body", () => {
    expect(EMAIL_TEMPLATES.length).toBeGreaterThanOrEqual(4);
    for (const t of EMAIL_TEMPLATES) {
      expect(t.subject.trim()).not.toBe("");
      expect(t.body.trim()).not.toBe("");
    }
  });
});
