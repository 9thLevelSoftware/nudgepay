import { describe, it, expect } from "vitest";
import { DEFAULT_EMAIL_TEMPLATES, applyEmailTemplate } from "../app/lib/email-templates";
import type { TemplateVars } from "../app/lib/sms-templates";

const baseVars: TemplateVars = {
  customer: "Acme", invoice: "1001", balance: "$50.00", dueDate: "Jun 1",
  company: "Chancey Heating & Cooling", phone: "555-0100", paymentLink: "https://pay.example.com/abc",
};

describe("email templates", () => {
  it("substitutes known tokens in subject and body", () => {
    const out = applyEmailTemplate("Hi {customer}, invoice {invoice} for {balance} due {dueDate}", baseVars);
    expect(out).toBe("Hi Acme, invoice 1001 for $50.00 due Jun 1");
  });
  it("substitutes company, phone, and paymentLink", () => {
    const out = applyEmailTemplate("{company} · {phone} · {paymentLink}", baseVars);
    expect(out).toBe("Chancey Heating & Cooling · 555-0100 · https://pay.example.com/abc");
  });
  it("leaves unknown tokens untouched", () => {
    expect(applyEmailTemplate("{customer} {unknown}", { ...baseVars, invoice: "", balance: "", dueDate: "" }))
      .toBe("Acme {unknown}");
  });
  it("every starter template has a non-empty subject and body", () => {
    expect(DEFAULT_EMAIL_TEMPLATES.length).toBeGreaterThanOrEqual(4);
    for (const t of DEFAULT_EMAIL_TEMPLATES) {
      expect(t.subject.trim()).not.toBe("");
      expect(t.body.trim()).not.toBe("");
    }
  });
  it("no starter template contains the old hardcoded company name", () => {
    for (const t of DEFAULT_EMAIL_TEMPLATES) {
      expect(t.subject).not.toContain("Chancey");
      expect(t.body).not.toContain("Chancey");
    }
  });
  it("no starter template asks the customer to reply (NP-AUD-2026-032)", () => {
    for (const t of DEFAULT_EMAIL_TEMPLATES) {
      expect(t.subject, t.id).not.toMatch(/\breply\b/i);
      expect(t.body, t.id).not.toMatch(/\breply\b/i);
      expect(t.body, t.id).toContain("This mailbox is not monitored.");
    }
  });
  it("dunning starters direct customers to paymentLink and phone", () => {
    for (const t of DEFAULT_EMAIL_TEMPLATES) {
      if (t.id === "payment-received") continue;
      expect(t.body, t.id).toContain("{paymentLink}");
      expect(t.body, t.id).toContain("{phone}");
      const out = applyEmailTemplate(t.body, baseVars);
      expect(out).toContain(baseVars.paymentLink);
      expect(out).toContain(baseVars.phone);
      expect(out).not.toMatch(/\{(paymentLink|phone)\}/);
    }
  });
});
