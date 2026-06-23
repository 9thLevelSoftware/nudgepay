import { expect, test } from "vitest";
import { parseContactLogForm } from "../app/lib/contact-log";
import { fd } from "./fd";

test("parseContactLogForm requires caseId", () => {
  const r = parseContactLogForm(fd({ method: "call", outcome: "no-answer" }));
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error).toBe("missing-case");
});

test("parseContactLogForm accepts a case-level log with no invoice", () => {
  const r = parseContactLogForm(fd({ caseId: "case-1", method: "note", outcome: "other" }));
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect(r.fields.caseId).toBe("case-1");
    expect(r.fields.invoiceId).toBeNull();
  }
});

test("parseContactLogForm keeps an optional invoiceId when present", () => {
  const r = parseContactLogForm(fd({ caseId: "case-1", invoiceId: "i1", method: "call", outcome: "no-answer" }));
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.fields.invoiceId).toBe("i1");
});
